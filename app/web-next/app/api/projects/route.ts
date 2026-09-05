// Project list — deny-by-default (FR-SEC-06 style): listVisibleProjects
// returns only projects with an active project_member row for the caller,
// no admin bypass (admins run the system, not deal content — role
// separation, see lib/project-visibility.ts header). Backs the /projects
// nav entry point added for the S8-S12 project-keyed screens (business-case,
// dd, ic-review, portfolio) which previously had no list-level entry point.
import { authenticate } from "../../../lib/auth.ts";
import { isAdminDealBlocked } from "../../../lib/project-visibility.ts";
import { listVisibleProjects } from "../../../../../db/repositories/project.repository.ts";
import { ok, forbidden } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (isAdminDealBlocked(ctx)) return forbidden("role_required", "관리자는 딜 내용에 접근할 수 없습니다.");
  const rows = listVisibleProjects(ctx.userId, { excludeMnpi: false });
  return ok(rows, 200, { count: rows.length });
}
