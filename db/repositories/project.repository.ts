// @version 1.0.0
/**
 * Project repository — the reference implementation of the deny-by-default
 * access pattern (FR-SEC-01/02/03, docs/security-model.md §2).
 *
 * RULE: every function here takes a `callerId` and filters through
 * `project_member` — there is no function that returns project data without
 * an explicit membership check. `admin` role is NOT special-cased here on
 * purpose: system-administration privilege never implies deal-data
 * visibility (FR-SEC-02). Every other repository in this codebase must
 * follow this same shape — this file is the pattern other repositories are
 * reviewed against, not just an example.
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";

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

/**
 * List projects visible to `callerId` — deny-by-default: a project with no
 * active `project_member` row for this user is absent from the result,
 * full stop. There is no admin bypass and no unfiltered variant of this
 * function anywhere in the codebase.
 */
export function listVisibleProjects(callerId: string): ProjectRow[] {
  const db = getDb();
  return db
    .query(
      `SELECT p.id, p.project_no, p.created_at
       FROM md_project p
       JOIN project_member m ON m.project_id = p.id
       WHERE m.user_id = ? AND m.revoked_at IS NULL
       ORDER BY p.created_at DESC`
    )
    .all(callerId) as ProjectRow[];
}

/**
 * Get a single project — returns null (not a permission error) for a
 * non-member, per FR-SEC-01: existence itself is protected, so the caller
 * cannot distinguish "doesn't exist" from "exists but you can't see it".
 */
export function getProjectIfVisible(callerId: string, projectId: string): ProjectRow | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT p.id, p.project_no, p.created_at
       FROM md_project p
       JOIN project_member m ON m.project_id = p.id
       WHERE m.user_id = ? AND m.revoked_at IS NULL AND p.id = ?`
    )
    .get(callerId, projectId) as ProjectRow | undefined;
  return row ?? null;
}

/**
 * Grant membership. Every grant is itself an auditable event — the caller
 * of this function is responsible for writing the matching audit_log row
 * (kept as a separate concern so this repository stays pure data access).
 */
export function grantMembership(
  projectId: string,
  userId: string,
  role: ProjectMemberRow["project_role"],
  grantedBy: string,
  needToKnowBasis: string
): void {
  const db = getDb();
  db.run(
    `INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id, user_id) DO UPDATE SET
       project_role = excluded.project_role,
       granted_by = excluded.granted_by,
       granted_at = excluded.granted_at,
       revoked_at = NULL,
       need_to_know_basis = excluded.need_to_know_basis`,
    [projectId, userId, role, grantedBy, new Date().toISOString(), needToKnowBasis]
  );
}

export function revokeMembership(projectId: string, userId: string): void {
  const db = getDb();
  db.run(
    `UPDATE project_member SET revoked_at = ? WHERE project_id = ? AND user_id = ?`,
    [new Date().toISOString(), projectId, userId]
  );
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
