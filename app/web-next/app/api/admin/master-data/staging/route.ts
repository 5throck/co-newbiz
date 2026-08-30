// staging_unmapped queue — read + resolve. A staging row that failed to match
// a master-data code can be resolved by mapping (admin adds the code via
// POST /api/admin/master-data) and then dismissing the row, or rejected.
// Both actions delete the queue row and are audited — the queue never
// accumulates silently.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const rows = getDb()
    .query(
      "SELECT id, raw_value, attempted_master_table, first_seen_at FROM staging_unmapped ORDER BY first_seen_at DESC, attempted_master_table",
    )
    .all();
  return ok(rows, 200, { count: (rows as unknown[]).length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const ctx = auth.auth;
  const body = (await request.json().catch(() => null)) as {
    id?: string; action?: "map" | "reject";
  } | null;
  if (!body?.id || !body?.action) {
    return badRequest("invalid_request", "id and action (map|reject) are required.");
  }
  const db = getDb();
  const row = db
    .query("SELECT id, raw_value, attempted_master_table FROM staging_unmapped WHERE id = ?")
    .get(body.id) as { id: string; raw_value: string; attempted_master_table: string } | null;
  if (!row) return badRequest("unknown_row", "No such staging_unmapped row.");
  db.run("DELETE FROM staging_unmapped WHERE id = ?", [body.id]);
  appendAudit(db, {
    actor: ctx.userId,
    action: body.action === "map" ? "staging_mapped" : "staging_rejected",
    target: `${row.attempted_master_table}:${row.raw_value}`,
    now: new Date().toISOString(),
  });
  return ok({ id: body.id, action: body.action });
}
