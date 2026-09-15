// 사용자 검색 — 프로젝트 팀원 배정용 최소 정보 조회 (analyst+, admin 전용
// /api/admin/users와는 별개). 활성 계정만, user_id/display_name/role만
// 반환한다(최소 노출 — 비밀번호·상태·잠금 이력 등은 admin 라우트에서만 다룬다).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { forbidden, ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "사용자 검색은 analyst 역할 이상이어야 합니다.");
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const db = getDb();
  const rows = q
    ? db
        .query(
          `SELECT user_id, display_name, role FROM app_user
           WHERE status = 'active' AND (user_id LIKE ? OR display_name LIKE ?)
           ORDER BY display_name, user_id LIMIT 50`,
        )
        .all(`%${q}%`, `%${q}%`)
    : db
        .query("SELECT user_id, display_name, role FROM app_user WHERE status = 'active' ORDER BY display_name, user_id LIMIT 50")
        .all();
  return ok({ users: rows }, 200, { count: (rows as unknown[]).length });
}
