// Admin watch rules — list and create under one watch (design §13.6, P4).
// POST validates against the watch_rule CHECK's real shape (0007/0033 + 0036 adr_ref):
// trigger_type from the 7-value WATCH_RULE_TRIGGER_TYPES set (NOT the notification
// table's 11 — see app/web-next/lib/admin/watch-rules.ts), threshold required/>0 only
// for threshold_breach | staleness and rejected otherwise, cooldown_hours 1–720,
// channel gated on server configuration, enabled defaults true, optional adr_ref.
// Validation errors are 400 with per-field messages in error.details.fields.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { addWatchRule } from "../../../../../../../../db/lib/watch-engine.ts";
import { authenticate, requireAdmin } from "../../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../lib/envelope.ts";
import { validateWatchRuleFields } from "../../../../../../lib/admin/watch-rules.ts";

function loadWatch(db: ReturnType<typeof getDb>, id: string): { id: string; project_id: string; user_id: string } | undefined {
  return db.query("SELECT id, project_id, user_id FROM watch WHERE id = ?").get(id) as
    | { id: string; project_id: string; user_id: string }
    | undefined;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { id } = await params;
  const db = getDb();
  if (!loadWatch(db, id)) return notFound();
  const rules = db
    .query(
      `SELECT id, watch_id, trigger_type, threshold, cooldown_hours, channel, enabled, adr_ref
       FROM watch_rule WHERE watch_id = ? ORDER BY id`,
    )
    .all(id);
  return ok({ rows: rules });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as unknown;
  const db = getDb();
  const watch = loadWatch(db, id);
  if (!watch) return notFound();

  const check = validateWatchRuleFields(db, body, { partial: false });
  if (!check.ok) {
    return fail(400, "validation_failed", "watch rule validation failed.", { fields: check.fields });
  }
  const v = check.value;
  const ruleId = addWatchRule(db, {
    watchId: id,
    triggerType: v.trigger_type,
    threshold: v.threshold,
    cooldownHours: v.cooldown_hours,
    channel: v.channel,
    adrRef: v.adr_ref,
  });
  // addWatchRule hardcodes enabled=1 (engine default); honor the validated value.
  if (v.enabled !== 1) {
    db.run("UPDATE watch_rule SET enabled = ? WHERE id = ?", [v.enabled, ruleId]);
  }
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "watch_rule_create",
    target: `${ruleId} (watch ${id}, ${v.trigger_type}, threshold=${v.threshold === null ? "null" : v.threshold}, cooldown=${v.cooldown_hours}h, channel=${v.channel})`,
    now: new Date().toISOString(),
  });
  const row = db
    .query(
      "SELECT id, watch_id, trigger_type, threshold, cooldown_hours, channel, enabled, adr_ref FROM watch_rule WHERE id = ?",
    )
    .get(ruleId);
  return ok(row, 201);
}
