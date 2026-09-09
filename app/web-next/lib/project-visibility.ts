// Shared helper factored out of the per-file duplication in app/server's
// route files (projects.ts/governance.ts/analysis.ts/deal-review.ts/pmi.ts
// each define their own copy). Behavior is identical — reuses
// db/repositories/project.repository.ts unchanged (see lib/auth.ts header).
import { getDb } from "../../../db/client.ts";
import { getProjectIfVisible } from "../../../db/repositories/project.repository.ts";
import type { AuthContext } from "./auth.ts";

// Admin deal-block (role separation): admins run the system (users, master
// data, governance) and must not read deal content — even deals they are
// members of. visibleProject returns null for admins, so every deal route
// (which treats null as 404/"not visible") blocks them with no per-route
// change. Deal-list APIs use listVisibleProjects + their own admin check.
export function visibleProject(
  ctx: AuthContext,
  projectId: string,
  opts: { allowAdmin?: boolean; includeClosed?: boolean } = {},
) {
  // allowAdmin is only for governance WRITE paths that admins legitimately
  // perform on deals (e.g. setting MNPI classification) — never content reads.
  if (ctx.role === "admin" && !opts.allowAdmin) return null;
  return getProjectIfVisible(ctx.userId, projectId, { excludeMnpi: false, includeClosed: opts.includeClosed });
}

/** Admins are blocked from the deal flow entirely (role separation). */
export function isAdminDealBlocked(ctx: AuthContext): boolean {
  return ctx.role === "admin";
}

export function isLead(ctx: AuthContext, projectId: string): boolean {
  if (ctx.role === "admin") return false;
  const row = getDb()
    .query("SELECT project_role FROM project_member WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(projectId, ctx.userId) as { project_role: string } | null;
  return row?.project_role === "lead";
}
