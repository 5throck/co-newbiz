// Project list — deny-by-default (FR-SEC-06 style): listVisibleProjects
// returns only projects with an active project_member row for the caller,
// no admin bypass (admins run the system, not deal content — role
// separation, see lib/project-visibility.ts header). Backs the /projects
// nav entry point added for the S8-S12 project-keyed screens (business-case,
// dd, ic-review, portfolio) which previously had no list-level entry point.
import { authenticate, requireBusinessActor } from "../../../lib/auth.ts";
import { listVisibleProjects } from "../../../../../db/repositories/project.repository.ts";
import { getDb } from "../../../../../db/client.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "read");
  if (denied) return denied;
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam === "open" || statusParam === "closed" || statusParam === "archived" ? statusParam : undefined;
  const includeClosed = statusParam === "all" || status !== undefined;
  const rows = listVisibleProjects(ctx.userId, {
    excludeMnpi: false,
    includeClosed,
    status,
    // 삭제 표시 검토/안건은 이 목록에 나오지 않는다 — 아카이브 화면(/api/archive/deals) 전용.
  });
  // is_lead — 마감/보관(close)은 project_member.project_role='lead' 전용이므로
  // 목록 단계에서 함께 알려준다(UI가 버튼 노출을 결정). repository는 그대로 둔다.
  const leadIds = new Set(
    (
      getDb()
        .query("SELECT project_id FROM project_member WHERE user_id = ? AND project_role = 'lead' AND revoked_at IS NULL")
        .all(ctx.userId) as Array<{ project_id: string }>
    ).map((r) => r.project_id),
  );
  return ok(
    rows.map((r) => ({ ...r, is_lead: leadIds.has(r.id) })),
    200,
    { count: rows.length },
  );
}
