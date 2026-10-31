// Admin watch-rule PATCH / DELETE (design §13.6, P4).
// PATCH merges the partial body over the current row and re-validates the composite
// (a trigger change re-checks the threshold of the NEW trigger against the resulting
// threshold value). DELETE hard-deletes the rule row — watch_rule is configuration,
// not an append-only record (the FR-SEC-07 no-delete mandate is audit_log-specific);
// the write is audited per ADR-0012.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { validateWatchRuleFields, type WatchRuleValues } from "../../../../../lib/admin/watch-rules.ts";

interface RuleRow extends WatchRuleValues {
  id: string;
  watch_id: string;
}

function loadRule(db: ReturnType<typeof getDb>, id: string): RuleRow | undefined {
  return db
    .query("SELECT id, watch_id, trigger_type, threshold, cooldown_hours, channel, enabled, adr_ref FROM watch_rule WHERE id = ?")
    .get(id) as RuleRow | undefined;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as unknown;
  const db = getDb();
  const current = loadRule(db, id);
  if (!current) return notFound();

  const check = validateWatchRuleFields(db, body, { partial: true, current });
  if (!check.ok) {
    return fail(400, "validation_failed", "watch rule validation failed.", { fields: check.fields });
  }
  const v = check.value;
  db.run(
    "UPDATE watch_rule SET trigger_type = ?, threshold = ?, cooldown_hours = ?, channel = ?, enabled = ?, adr_ref = ? WHERE id = ?",
    [v.trigger_type, v.threshold, v.cooldown_hours, v.channel, v.enabled, v.adr_ref, id],
  );
  const changes: string[] = [];
  if (current.trigger_type !== v.trigger_type) changes.push(`trigger ${current.trigger_type}→${v.trigger_type}`);
  if (current.threshold !== v.threshold) changes.push(`threshold ${current.threshold}→${v.threshold === null ? "null" : v.threshold}`);
  if (current.cooldown_hours !== v.cooldown_hours) changes.push(`cooldown ${current.cooldown_hours}→${v.cooldown_hours}`);
  if (current.channel !== v.channel) changes.push(`channel ${current.channel}→${v.channel}`);
  if (current.enabled !== v.enabled) changes.push(`enabled ${current.enabled}→${v.enabled}`);
  if (current.adr_ref !== v.adr_ref) changes.push(`adr_ref ${current.adr_ref}→${v.adr_ref ?? "null"}`);
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "watch_rule_update",
    target: `${id}: ${changes.join("; ") || "no change"}`,
    now: new Date().toISOString(),
  });
  return ok(loadRule(db, id));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { id } = await params;
  const db = getDb();
  const current = loadRule(db, id);
  if (!current) return notFound();

  db.run("DELETE FROM watch_rule WHERE id = ?", [id]);
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "watch_rule_delete",
    target: `${id} (watch ${current.watch_id}, ${current.trigger_type})`,
    now: new Date().toISOString(),
  });
  return ok({ id, deleted: true });
}
