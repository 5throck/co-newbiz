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
  const action = url.searchParams.get("action")?.trim() || null;   // 접두 매칭 (예: synergy_)
  const actor = url.searchParams.get("actor")?.trim() || null;      // 행위자 user_id
  const rows = getDb()
    .query(
      `SELECT id, actor_user_id, action, target, created_at FROM audit_log
       WHERE (? IS NULL OR created_at < ?)
         AND (? IS NULL OR action LIKE ? || '%')
         AND (? IS NULL OR actor_user_id = ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(before ?? null, before ?? null, action, action, actor, actor, limit);
  return ok(rows, 200, { limit });
}
