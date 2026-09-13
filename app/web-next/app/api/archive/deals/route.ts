// GET /api/archive/deals — delete-marked deal manifests visible to the caller.
// Deny-by-default: only manifests whose member allowlist (members at mark
// time) includes the caller. Admins are blocked from deal content entirely
// (role separation, ADR-0091).
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { listDeletedDealArchives } from "../../../../../../db/repositories/deal-archive.repository.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { forbidden, ok } from "../../../../lib/envelope.ts";
import { isAdminDealBlocked } from "../../../../lib/project-visibility.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (isAdminDealBlocked(ctx)) return forbidden("role_required", "관리자는 검토/안건 내용에 접근할 수 없습니다.");
  const rows = listDeletedDealArchives(ctx.userId);
  appendAudit(getDb(), {
    actor: ctx.userId,
    action: "archive_list",
    target: `${rows.length} rows`,
    now: new Date().toISOString(),
  });
  return ok(rows, 200, { count: rows.length });
}
