// Shared helper factored out of the per-file duplication in app/server's
// route files (projects.ts/governance.ts/analysis.ts/deal-review.ts/pmi.ts
// each define their own copy). Behavior is identical — reuses
// db/repositories/project.repository.ts unchanged (see lib/auth.ts header).
import { getDb } from "../../../db/client.ts";
import { getProjectIfVisible } from "../../../db/repositories/project.repository.ts";
import type { AuthContext } from "./auth.ts";

export function visibleProject(ctx: AuthContext, projectId: string) {
  return getProjectIfVisible(ctx.userId, projectId, { excludeMnpi: false });
}

export function isLead(ctx: AuthContext, projectId: string): boolean {
  const row = getDb()
    .query("SELECT project_role FROM project_member WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(projectId, ctx.userId) as { project_role: string } | null;
  return row?.project_role === "lead";
}
