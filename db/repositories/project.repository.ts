// @version 1.1.0
/**
 * Project repository — the reference implementation of the deny-by-default
 * access pattern (FR-SEC-01/02/03/04/06, docs/security-model.md §2).
 *
 * RULE: every read here takes a `callerId` and filters through
 * `project_member` — there is no function that returns project data without
 * an explicit membership check. `admin` role is NOT special-cased here on
 * purpose: system-administration privilege never implies deal-data
 * visibility (FR-SEC-02). Every other repository in this codebase must
 * follow this same shape — this file is the pattern other repositories are
 * reviewed against, not just an example.
 *
 * v1.1.0 (Wave 5.5) adds two enforcements at this same layer:
 *   - wall_group exclusion (FR-SEC-04): a user whose app_user.wall_group
 *     equals a project's classification wall_group is walled off from it,
 *     membership row or not — an information wall overrides membership;
 *   - MNPI read logging (FR-SEC-06): every read that returns an
 *     mnpi_flag=1 project writes data_access_log, so "every access logged"
 *     holds because the enforcement layer itself logs, not because every
 *     caller remembers to.
 *
 * Membership WRITE operations live in db/lib/access-control.ts (grant /
 * revoke with mandatory need-to-know basis, insider-list maintenance, and
 * audit) — deliberately NOT here, so there is exactly one write path and it
 * cannot skip the basis check.
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess } from "../lib/access-control.ts";

export interface ProjectRow {
  id: string;
  project_no: string;
  created_at: string;
}

export interface ProjectMemberRow {
  project_id: string;
  user_id: string;
  project_role: "lead" | "contributor" | "reviewer" | "observer";
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  need_to_know_basis: string;
}

export interface VisibilityOptions {
  /**
   * Exclude mnpi_flag=1 projects from the result. The MCP layer passes
   * `true` by default (FR-SYS-02); web/API calls for authenticated members
   * leave it false — membership already gates those, and members see the
   * MNPI banner instead (security-model §6).
   */
  excludeMnpi?: boolean;
  /**
   * Set when this call IS the audited scoped-token override of the MCP
   * default exclusion (FR-SEC-06: the override itself is an audit event).
   * Every MNPI project returned under this flag is audit-logged.
   */
  mnpiScopeOverrideBy?: string;
}

interface VisibleProjectRow extends ProjectRow {
  mnpi_flag: number;
}

function logMnpiReads(rows: VisibleProjectRow[], callerId: string, opts: VisibilityOptions): void {
  const mnpiRows = rows.filter((r) => r.mnpi_flag === 1);
  if (mnpiRows.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  for (const r of mnpiRows) {
    logDataAccess(db, {
      userId: callerId, tableKey: "project", recordRef: r.id, projectId: r.id,
      action: "read", at: now,
    });
    if (opts.mnpiScopeOverrideBy) {
      appendAudit(db, {
        actor: opts.mnpiScopeOverrideBy, action: "mnpi_scope_override", target: r.id, now,
      });
    }
  }
}

/**
 * List projects visible to `callerId` — deny-by-default: a project with no
 * active `project_member` row for this user is absent from the result,
 * full stop. There is no admin bypass and no unfiltered variant of this
 * function anywhere in the codebase.
 */
export function listVisibleProjects(callerId: string, opts: VisibilityOptions = {}): ProjectRow[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT p.id, p.project_no, p.created_at, COALESCE(c.mnpi_flag, 0) AS mnpi_flag
       FROM md_project p
       JOIN project_member m ON m.project_id = p.id
       LEFT JOIN project_classification c ON c.project_id = p.id
       LEFT JOIN app_user u ON u.user_id = m.user_id
       WHERE m.user_id = ? AND m.revoked_at IS NULL
         AND (c.wall_group IS NULL OR u.wall_group IS NULL OR c.wall_group != u.wall_group)
         AND (? = 0 OR COALESCE(c.mnpi_flag, 0) = 0)
       ORDER BY p.created_at DESC`
    )
    .all(callerId, opts.excludeMnpi ? 1 : 0) as VisibleProjectRow[];
  logMnpiReads(rows, callerId, opts);
  return rows.map(({ mnpi_flag: _mnpi, ...rest }) => rest);
}

/**
 * Get a single project — returns null (not a permission error) for a
 * non-member, per FR-SEC-01: existence itself is protected, so the caller
 * cannot distinguish "doesn't exist" from "exists but you can't see it".
 */
export function getProjectIfVisible(
  callerId: string,
  projectId: string,
  opts: VisibilityOptions = {}
): ProjectRow | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT p.id, p.project_no, p.created_at, COALESCE(c.mnpi_flag, 0) AS mnpi_flag
       FROM md_project p
       JOIN project_member m ON m.project_id = p.id
       LEFT JOIN project_classification c ON c.project_id = p.id
       LEFT JOIN app_user u ON u.user_id = m.user_id
       WHERE m.user_id = ? AND m.revoked_at IS NULL AND p.id = ?
         AND (c.wall_group IS NULL OR u.wall_group IS NULL OR c.wall_group != u.wall_group)
         AND (? = 0 OR COALESCE(c.mnpi_flag, 0) = 0)`
    )
    .get(callerId, projectId, opts.excludeMnpi ? 1 : 0) as VisibleProjectRow | undefined;
  if (!row) return null;
  logMnpiReads([row], callerId, opts);
  const { mnpi_flag: _mnpi, ...rest } = row;
  return rest;
}

export function createProject(projectNo: string): ProjectRow {
  const db = getDb();
  const row: ProjectRow = { id: ulid(), project_no: projectNo, created_at: new Date().toISOString() };
  db.run(`INSERT INTO md_project (id, project_no, created_at) VALUES (?, ?, ?)`, [
    row.id,
    row.project_no,
    row.created_at,
  ]);
  return row;
}
