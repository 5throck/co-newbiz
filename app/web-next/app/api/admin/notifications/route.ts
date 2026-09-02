// 관리자 — 전체 알림 조회 (사용자 필터 없음, 읽기 전용, ADR-0091).
// 기존 /api/notifications는 본인 수신함(user_id 필터)이므로 관리 화면과 분리한다.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? 200) || 200, 500);
  const notifications = getDb().query(
    "SELECT * FROM notification ORDER BY created_at DESC LIMIT ?",
  ).all(limit);
  return ok(notifications, 200, { count: notifications.length });
}
