// Port of app/server/admin.ts GET /api/admin/audit-log
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
  const before = url.searchParams.get("before");
  const rows = getDb()
    .query(
      `SELECT id, actor_user_id, action, target, created_at FROM audit_log
       WHERE (? IS NULL OR created_at < ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(before ?? null, before ?? null, limit);
  return ok(rows, 200, { limit });
}
