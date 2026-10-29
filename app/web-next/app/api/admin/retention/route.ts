// Port of app/server/admin.ts GET/POST /api/admin/retention
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { handlingToStoredAction, validateRetentionPolicy } from "../../../../../../db/lib/retention-registry.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const rows = getDb()
    .query("SELECT table_key, basis, retention_months, action, last_run_at FROM retention_policy ORDER BY table_key")
    .all();
  return ok(rows);
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const body = (await request.json().catch(() => null)) as
    | { table_key?: string; basis?: string; retention_months?: number; action?: string }
    | null;
  if (!body?.table_key?.trim() || !body?.basis?.trim() || !Number.isInteger(body?.retention_months) || body.retention_months! < 0) {
    return badRequest("invalid_request", "table_key, basis and a non-negative integer retention_months are required.");
  }
  // action is optional and derived from the registry; a conflicting client value is rejected (400 action_not_allowed).
  const v = validateRetentionPolicy(body.table_key.trim(), body.basis.trim(), body.action);
  if (!v.ok) return badRequest(v.code, v.message);
  const action = handlingToStoredAction(v.entry.handling);
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO retention_policy (table_key, basis, retention_months, action, last_run_at)
     VALUES (?,?,?,?,NULL)
     ON CONFLICT (table_key) DO UPDATE SET
       basis = excluded.basis,
       retention_months = excluded.retention_months,
       action = excluded.action`,
    [body.table_key.trim(), body.basis.trim(), body.retention_months!, action],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "retention_policy_set", target: `${body.table_key}:${action}:${body.retention_months}m`, now });
  return ok({ ok: true, table_key: body.table_key.trim() }, 201);
}
