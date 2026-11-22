// Shared helper factored out of the per-file duplication in app/server's
// route files (projects.ts/governance.ts/analysis.ts/deal-review.ts/pmi.ts
// each define their own copy). Behavior is identical — reuses
// db/repositories/project.repository.ts unchanged (see lib/auth.ts header).
//
// v1.1.0 (review F-2, 2026-11-22): FR-SYS-02 / ADR-0040 MNPI MCP
// default-exclusion is wired HERE, by principal — every project read that
// arrives through the machine paths (in-process MCP port or a personal API
// token, which is what the stdio MCP server's REST client presents) defaults
// to excludeMnpi:true, so mnpi_flag projects are absent from every default
// MCP/AI-client response. Before this change every production call site
// passed excludeMnpi:false and the audited override hook
// (mnpiScopeOverrideBy) had no production caller — the exclusion existed
// only as repository plumbing, never as a live control. Web cookie sessions
// are unchanged: membership already gates those, and members see the MNPI
// banner instead (security-model §6).
import { getDb } from "../../../db/client.ts";
import {
  getProjectIfVisible,
  listVisibleProjects,
  type VisibilityOptions,
} from "../../../db/repositories/project.repository.ts";
import { callPathOf, type AuthContext } from "./auth.ts";

export interface MnpiExclusion {
  excludeMnpi: boolean;
  /** Set only on the audited override path — feeds mnpi_scope_override. */
  mnpiScopeOverrideBy?: string;
}

/**
 * FR-SYS-02 / ADR-0040 default-exclusion, derived from the calling principal:
 *   - machine principals — the in-process MCP port (callPathOf → "mcp") and
 *     any bearer-token REST caller (auth.via === "bearer"; the stdio MCP
 *     server presents exactly this) — get excludeMnpi:true by default;
 *   - web cookie sessions are unchanged (excludeMnpi:false — membership
 *     gating + the MNPI banner, security-model §6);
 *   - the override is explicit, per-call, and machine-only: when the caller
 *     passes mnpiScopeOverride:true, the flagged rows are served AND every
 *     one of them is audit-logged (mnpi_scope_override by the calling user,
 *     plus the FR-SEC-06 data_access_log read rows the repository already
 *     writes). There is no implicit override anywhere.
 */
export function mnpiExclusionFor(ctx: AuthContext, mnpiScopeOverride?: boolean): MnpiExclusion {
  const machinePrincipal = callPathOf(ctx) === "mcp" || ctx.via === "bearer";
  if (!machinePrincipal) return { excludeMnpi: false };
  if (mnpiScopeOverride === true) return { excludeMnpi: false, mnpiScopeOverrideBy: ctx.userId };
  return { excludeMnpi: true };
}

// Admin deal-block (role separation): admins run the system (users, master
// data, governance) and must not read deal content — even deals they are
// members of. visibleProject returns null for admins, so every deal route
// (which treats null as 404/"not visible") blocks them with no per-route
// change. Deal-list APIs use listVisibleProjectsFor + their own admin check.
export function visibleProject(
  ctx: AuthContext,
  projectId: string,
  opts: { allowAdmin?: boolean; includeClosed?: boolean; includeDeleted?: boolean; mnpiScopeOverride?: boolean } = {},
) {
  // allowAdmin is only for governance WRITE paths that admins legitimately
  // perform on deals (e.g. setting MNPI classification) — never content reads.
  if (ctx.role === "admin" && !opts.allowAdmin) return null;
  const mnpi = mnpiExclusionFor(ctx, opts.mnpiScopeOverride);
  return getProjectIfVisible(ctx.userId, projectId, {
    excludeMnpi: mnpi.excludeMnpi,
    mnpiScopeOverrideBy: mnpi.mnpiScopeOverrideBy,
    includeClosed: opts.includeClosed,
    includeDeleted: opts.includeDeleted,
  });
}

/**
 * Principal-aware variant of the repository's listVisibleProjects: the same
 * FR-SYS-02 default-exclusion as visibleProject, for the list surfaces. The
 * caller passes its AuthContext; opts are forwarded (includeClosed/status/
 * includeDeleted). An explicit opts.mnpiScopeOverride:true lifts the MNPI
 * filter for this ONE call and stamps every returned flagged project with
 * the audited mnpi_scope_override row (FR-SEC-06).
 */
export function listVisibleProjectsFor(
  ctx: AuthContext,
  opts: {
    includeClosed?: boolean;
    includeDeleted?: boolean;
    status?: VisibilityOptions["status"];
    mnpiScopeOverride?: boolean;
  } = {},
) {
  const mnpi = mnpiExclusionFor(ctx, opts.mnpiScopeOverride);
  return listVisibleProjects(ctx.userId, {
    excludeMnpi: mnpi.excludeMnpi,
    mnpiScopeOverrideBy: mnpi.mnpiScopeOverrideBy,
    includeClosed: opts.includeClosed,
    includeDeleted: opts.includeDeleted,
    status: opts.status,
  });
}

export function isLead(ctx: AuthContext, projectId: string): boolean {
  if (ctx.role === "admin") return false;
  const row = getDb()
    .query("SELECT project_role FROM project_member WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(projectId, ctx.userId) as { project_role: string } | null;
  return row?.project_role === "lead";
}
