// Watch-rule draft preview (design 2026-10-29-scheduled-jobs-design §13.6, P4).
// POST /api/admin/watch-rules/preview — body is a NOT-persisted rule draft
// {watch_id, trigger_type, threshold?, cooldown_hours?, channel?}; the watch supplies
// the project and the owner (a rule only ever exists under a watch, so the preview
// simulates exactly what the persisted rule would do).
//
// Zero writes: evaluation goes through watch-engine.previewWatchRule (pure SELECTs —
// no notification row, no watermark/last_checked advance, no rag_transition.notified
// flip; the dryRun flag threading on the engine's evaluation functions predates this
// route and covers the producer paths). Recipients/channels are resolved through
// db/lib/notify/policy.ts exactly as notify.deliver would for the fired row — a
// draft-fired notification is simulated as an owner-addressed row (user_id = watch
// owner, channel = draft channel, severity = deriveSeverityForTrigger), then
// resolveRecipients applies policy ∩ channel bound ∩ opt-outs. Email addresses are
// returned MASKED only (§13.8); the owner's in-app delivery is the row itself, so
// in_app_user_ids is [owner] when the draft's channel includes in-app.
import { getDb } from "../../../../../../../db/client.ts";
import { maskAddress } from "../../../../../../../db/lib/notify/email.ts";
import { resolveRecipients, type NotificationRowLike } from "../../../../../../../db/lib/notify/policy.ts";
import { deriveSeverityForTrigger, previewWatchRule } from "../../../../../../../db/lib/watch-engine.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { validateWatchRuleFields } from "../../../../../lib/admin/watch-rules.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "request body must be a JSON object.");
  }
  if (typeof body.watch_id !== "string" || body.watch_id.trim() === "") {
    return badRequest("invalid_request", "watch_id is required — a rule draft is previewed under the watch it would belong to.");
  }
  const db = getDb();
  const watch = db.query("SELECT id, project_id, user_id FROM watch WHERE id = ?").get(body.watch_id.trim()) as
    | { id: string; project_id: string; user_id: string }
    | undefined;
  if (!watch) return notFound();

  // Preview channel is optional and defaults to 'all' so the resolution shows every
  // channel the rule could reach; validation (incl. channel gating) is the same as create.
  // watch_id is consumed above — it is not a rule field and would fail the unknown-field check.
  const { watch_id: _consumed, ...draftFields } = body;
  const draftBody = { ...draftFields, channel: body.channel ?? "all" };
  const check = validateWatchRuleFields(db, draftBody, { partial: false });
  if (!check.ok) {
    return fail(400, "validation_failed", "watch rule draft validation failed.", { fields: check.fields });
  }
  const v = check.value;
  const nowIso = new Date().toISOString();

  const preview = previewWatchRule(db, {
    projectId: watch.project_id,
    triggerType: v.trigger_type,
    threshold: v.threshold,
    cooldownHours: v.cooldown_hours,
    channel: v.channel,
  }, nowIso);

  // Simulate the notification row the producer would write for this rule firing, then
  // resolve recipients the same way the deliver worker would (policy ∩ bound ∩ opt-outs).
  // Severity placeholder for non-bearing triggers is irrelevant: those return evaluated:false.
  const severity = deriveSeverityForTrigger(v.trigger_type) ?? "info";
  const rowLike: NotificationRowLike = {
    id: `preview:${watch.id}`,
    user_id: watch.user_id,
    project_id: watch.project_id,
    trigger_type: v.trigger_type,
    severity,
    channel: v.channel,
    bundle: "immediate",
    source_ref: null,
  };
  const resolution = resolveRecipients(db, rowLike);
  const includesInApp = v.channel === "in_app" || v.channel === "all";

  const project = db.query("SELECT project_no FROM md_project WHERE id = ?").get(watch.project_id) as
    | { project_no: string }
    | undefined;

  return ok({
    watch_id: watch.id,
    project: { id: watch.project_id, project_no: project?.project_no ?? null },
    trigger_type: v.trigger_type,
    threshold: v.threshold,
    cooldown_hours: v.cooldown_hours,
    channel: v.channel,
    evaluated: preview.evaluated,
    would_fire: preview.wouldFire,
    suppressed_by_cooldown: preview.suppressedByCooldown,
    reason: preview.reason,
    severity: preview.severity,
    // External-channel recipients (email/webhook), addresses MASKED (§13.8).
    recipients: resolution.recipients.map((r) => ({
      user_id: r.recipientUserId,
      email_masked: r.recipientAddress ? maskAddress(r.recipientAddress) : null,
      channels: r.channels,
    })),
    // In-app: an addressed row IS the owner's in-app delivery (§13.2 — no ledger rows).
    in_app_user_ids: includesInApp ? [watch.user_id] : [],
  });
}
