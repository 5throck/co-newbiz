// @version 1.0.0
/**
 * Access-control engine — FR-SEC-04/06/07 enforcement wrapper (Wave 5.5,
 * docs/security-model.md §5-6, ADR-0038/0040/0012).
 *
 * The repository layer (db/repositories/project.repository.ts) owns the
 * deny-by-default READ path; this engine owns the WRITE path around
 * membership and identity-sensitive events:
 *   - membership grant/revoke with a mandatory need-to-know basis,
 *   - insider_list auto-maintenance for mnpi_flag projects (FR-SEC-06),
 *   - the append-only audit writer every security event funnels through.
 *
 * Agents have no accounts of their own (FR-SEC-08): every actor string here
 * is a human user_id, inherited from whoever invoked the operation.
 */

import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";

export interface AuditEntry {
  actor: string;
  action: string;
  target: string;
  now: string;
}

/**
 * Append one audit_log row. There is deliberately no update or delete
 * counterpart — migration 0008's triggers abort any attempt at the DB level
 * (FR-SEC-07), so this function is the only write shape that can exist.
 */
export function appendAudit(db: Database, entry: AuditEntry): string {
  const id = ulid();
  db.run(
    "INSERT INTO audit_log (id, actor_user_id, action, target, created_at) VALUES (?,?,?,?,?)",
    [id, entry.actor, entry.action, entry.target, entry.now],
  );
  return id;
}

export interface DataAccessLogEntry {
  userId: string;
  tableKey: string;
  recordRef: string;
  projectId?: string | null;
  action: "read" | "write";
  at: string;
  ip?: string | null;
}

/**
 * Log a sensitive-table access — reads included, not just writes
 * (FR-SEC-06 / migration 0002's data_access_log).
 */
export function logDataAccess(db: Database, entry: DataAccessLogEntry): void {
  db.run(
    `INSERT INTO data_access_log (id, user_id, table_key, record_ref, project_id, action, at, ip)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), entry.userId, entry.tableKey, entry.recordRef, entry.projectId ?? null, entry.action, entry.at, entry.ip ?? null],
  );
}

export type ProjectRole = "lead" | "contributor" | "reviewer" | "observer";

export interface GrantMembershipOptions {
  projectId: string;
  userId: string;
  projectRole: ProjectRole;
  grantedBy: string;
  needToKnowBasis: string;
  now: string;
}

/**
 * Grant project membership. Two hard rules beyond the plain INSERT:
 *   1. needToKnowBasis is mandatory — a grant with no recorded basis is
 *      refused (design §4-9-1(a): membership IS the access decision, so the
 *      justification cannot be optional).
 *   2. The grantee must be an existing app_user. Agents have no accounts
 *      (FR-SEC-08) and phantom users must not accumulate memberships.
 * For an mnpi_flag project the grantee lands on the insider list in the same
 * transaction — there is no state where a member of an MNPI project is absent
 * from its insider roster (FR-SEC-06).
 */
export function grantProjectMembership(db: Database, opts: GrantMembershipOptions): void {
  if (!opts.needToKnowBasis || !opts.needToKnowBasis.trim()) {
    throw new Error("need_to_know_basis is mandatory for every membership grant (design §4-9-1(a)).");
  }
  const grantee = db
    .query("SELECT user_id FROM app_user WHERE user_id = ?")
    .get(opts.userId) as { user_id: string } | null;
  if (!grantee) {
    throw new Error(`Grantee '${opts.userId}' has no app_user account (FR-SEC-08: no phantom or agent accounts).`);
  }

  const classification = db
    .query("SELECT mnpi_flag FROM project_classification WHERE project_id = ?")
    .get(opts.projectId) as { mnpi_flag: number } | null;

  db.transaction(() => {
    db.run(
      `INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (project_id, user_id) DO UPDATE SET
         project_role = excluded.project_role,
         granted_by = excluded.granted_by,
         granted_at = excluded.granted_at,
         revoked_at = NULL,
         need_to_know_basis = excluded.need_to_know_basis`,
      [opts.projectId, opts.userId, opts.projectRole, opts.grantedBy, opts.now, opts.needToKnowBasis],
    );
    if (classification?.mnpi_flag === 1) {
      db.run(
        `INSERT INTO insider_list (project_id, user_id, added_at, reason)
         VALUES (?,?,?,?)
         ON CONFLICT (project_id, user_id) DO UPDATE SET
           removed_at = NULL, added_at = excluded.added_at, reason = excluded.reason`,
        [opts.projectId, opts.userId, opts.now, `membership granted by ${opts.grantedBy}: ${opts.needToKnowBasis}`],
      );
    }
    appendAudit(db, { actor: opts.grantedBy, action: "membership_grant", target: `${opts.projectId}:${opts.userId}`, now: opts.now });
    logDataAccess(db, { userId: opts.grantedBy, tableKey: "project_member", recordRef: `${opts.projectId}:${opts.userId}`, projectId: opts.projectId, action: "write", at: opts.now });
  })();
}

export interface RevokeMembershipOptions {
  projectId: string;
  userId: string;
  revokedBy: string;
  now: string;
}

/**
 * Revoke membership — and where the project is MNPI-flagged, close the
 * insider_list entry in the same transaction, so the roster never shows a
 * revoked member as a current insider.
 */
export function revokeProjectMembership(db: Database, opts: RevokeMembershipOptions): void {
  db.transaction(() => {
    db.run(
      "UPDATE project_member SET revoked_at = ? WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL",
      [opts.now, opts.projectId, opts.userId],
    );
    db.run(
      "UPDATE insider_list SET removed_at = ? WHERE project_id = ? AND user_id = ? AND removed_at IS NULL",
      [opts.now, opts.projectId, opts.userId],
    );
    appendAudit(db, { actor: opts.revokedBy, action: "membership_revoke", target: `${opts.projectId}:${opts.userId}`, now: opts.now });
  })();
}

export interface AcknowledgeInsiderOptions {
  projectId: string;
  userId: string;
  now: string;
}

/**
 * Record the user's acknowledgement of MNPI handling obligations for a
 * project they are on the insider list of (security-model §6: the access
 * banner is not decoration — acknowledging it is an auditable event).
 */
export function acknowledgeInsider(db: Database, opts: AcknowledgeInsiderOptions): void {
  const row = db
    .query("SELECT user_id FROM insider_list WHERE project_id = ? AND user_id = ? AND removed_at IS NULL")
    .get(opts.projectId, opts.userId) as { user_id: string } | null;
  if (!row) {
    throw new Error(`'${opts.userId}' is not on the active insider list for this project.`);
  }
  db.run(
    "UPDATE insider_list SET acknowledged_at = ? WHERE project_id = ? AND user_id = ?",
    [opts.now, opts.projectId, opts.userId],
  );
  appendAudit(db, { actor: opts.userId, action: "insider_acknowledge", target: opts.projectId, now: opts.now });
}
