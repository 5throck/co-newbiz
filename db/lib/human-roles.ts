// @version 1.1.0
/**
 * Human-role grants — ADR-0186 D6 / design 3.6 and 3.14 (migration 0176).
 *
 * Maps an authenticated user to a human role key from
 * procedures/_human-roles.yaml. ADR-0038 deny-by-default: no row, or a
 * revoked row, means no authority. A grant gives authority ONLY on the
 * routes that call hasHumanRole (waiver approve, na confirm; later
 * countersign, condition clear, kill override); it changes nothing elsewhere.
 * Agents and MCP sessions hold none and exercise none (route layer rejects
 * non-cookie sessions). Rows are never deleted: revoke sets revoked_at.
 *
 * GRANTABLE_ROLE_KEYS is the subset of the YAML registry this table may
 * hold. A unit test pins every key here to a registry entry, so the code
 * list cannot drift from procedures/_human-roles.yaml.
 */
import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";

export const GRANTABLE_ROLE_KEYS = ["entity-ic-reviewer", "group-ic-reviewer"] as const;
export type HumanRoleKey = (typeof GRANTABLE_ROLE_KEYS)[number];

export interface HumanRoleGrant {
  id: string;
  user_id: string;
  role_key: string;
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

export class HumanRoleError extends Error {
  constructor(readonly code: "unknown_role" | "unknown_user" | "self_grant" | "agent_account" | "already_granted" | "not_found" | "already_revoked", message: string) {
    super(message);
  }
}

export function isGrantableRole(role: string): role is HumanRoleKey {
  return (GRANTABLE_ROLE_KEYS as readonly string[]).includes(role);
}

/** True when the user holds an ACTIVE (not revoked) grant of one of the roles. Read fresh each call (no cache). */
export function hasHumanRole(db: Database, userId: string, roles: readonly string[]): boolean {
  if (roles.length === 0) return false;
  const marks = roles.map(() => "?").join(",");
  return !!db
    .query(`SELECT 1 FROM app_user_human_role WHERE user_id = ? AND role_key IN (${marks}) AND revoked_at IS NULL LIMIT 1`)
    .get(userId, ...roles);
}

export function listHumanRoleGrants(db: Database, opts: { userId?: string; includeRevoked?: boolean } = {}): HumanRoleGrant[] {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.userId) { where.push("user_id = ?"); params.push(opts.userId); }
  if (!opts.includeRevoked) where.push("revoked_at IS NULL");
  return db
    .query(`SELECT * FROM app_user_human_role ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY granted_at DESC, id DESC`)
    .all(...params) as HumanRoleGrant[];
}

/**
 * Issue a grant. The caller (admin route) has already established that the
 * actor is an administrator. Refused here: an unknown role key, an unknown
 * user, an agent account, a self-grant (a user never grants themselves a
 * role), and a duplicate active grant.
 */
export function issueHumanRoleGrant(
  db: Database,
  opts: { userId: string; roleKey: string; grantedBy: string; now: string; agentKeys?: ReadonlySet<string> },
): string {
  if (!isGrantableRole(opts.roleKey)) {
    throw new HumanRoleError("unknown_role", `role_key must be one of ${GRANTABLE_ROLE_KEYS.join(" | ")}.`);
  }
  if (opts.userId === opts.grantedBy) {
    throw new HumanRoleError("self_grant", "A user cannot grant themselves a human role.");
  }
  if (opts.agentKeys?.has(opts.userId)) {
    throw new HumanRoleError("agent_account", "Agents hold no human-role grants (boundary 1).");
  }
  const user = db.query("SELECT user_id FROM app_user WHERE user_id = ?").get(opts.userId);
  if (!user) throw new HumanRoleError("unknown_user", `user ${opts.userId} does not exist.`);
  if (hasHumanRole(db, opts.userId, [opts.roleKey])) {
    throw new HumanRoleError("already_granted", `user ${opts.userId} already holds an active ${opts.roleKey} grant.`);
  }
  const id = ulid();
  db.run(
    "INSERT INTO app_user_human_role (id, user_id, role_key, granted_by, granted_at) VALUES (?,?,?,?,?)",
    [id, opts.userId, opts.roleKey, opts.grantedBy, opts.now],
  );
  return id;
}

export function revokeHumanRoleGrant(db: Database, opts: { id: string; revokedBy: string; now: string }): HumanRoleGrant {
  const row = db.query("SELECT * FROM app_user_human_role WHERE id = ?").get(opts.id) as HumanRoleGrant | undefined;
  if (!row) throw new HumanRoleError("not_found", `grant ${opts.id} not found.`);
  if (row.revoked_at) throw new HumanRoleError("already_revoked", `grant ${opts.id} is already revoked.`);
  db.run("UPDATE app_user_human_role SET revoked_at = ?, revoked_by = ? WHERE id = ?", [opts.now, opts.revokedBy, opts.id]);
  return db.query("SELECT * FROM app_user_human_role WHERE id = ?").get(opts.id) as HumanRoleGrant;
}

/**
 * ADR-0186 D6 / design 3.14 ("nobody can grant the checker role to the recorder of a decision that grant would
 * then countersign"). Minimal enforceable form: a grant of `entity-ic-reviewer` / `group-ic-reviewer` to a user
 * is in CONFLICT when that user recorded the LATEST (non-stale) GO of the matching gate (entity_ic / group_ic) of
 * some project and that GO is recorded under the maker/checker contract (after the legacy cutoff) but not yet decided by
 * a checker. The grant would otherwise place the maker in the checker seat of their own pending decision. Past,
 * already-countersigned or legacy decisions are out of scope here (the countersign engine refuses a same-person
 * countersign for every decision regardless of when the grant was issued, so this check only keeps the admin
 * from creating the conflicting seat in the first place).
 */
export function pendingCountersignConflicts(db: Database, userId: string, roleKey: string): Array<{ project_id: string; decision_id: string; gate: string }> {
  const gate = roleKey === "entity-ic-reviewer" ? "entity_ic" : roleKey === "group-ic-reviewer" ? "group_ic" : null;
  if (!gate) return [];
  return db
    .query(
      `SELECT g.entity_id AS project_id, g.id AS decision_id, g.gate FROM gate_decision g
       WHERE g.entity_type = 'project' AND g.gate = ? AND g.decision = 'go' AND g.decided_by = ?
         AND NOT EXISTS (SELECT 1 FROM gate_decision_stale s WHERE s.decision_id = g.id)
         AND g.id = (SELECT g2.id FROM gate_decision g2 WHERE g2.entity_type = 'project' AND g2.entity_id = g.entity_id AND g2.gate = g.gate
                       AND NOT EXISTS (SELECT 1 FROM gate_decision_stale s2 WHERE s2.decision_id = g2.id)
                     ORDER BY g2.decided_at DESC, g2.id DESC LIMIT 1)
         AND g.rowid > (SELECT c.max_decision_rowid FROM gate_integrity_cutoff c WHERE c.name = 'maker_checker')
         AND NOT EXISTS (SELECT 1 FROM approval_chain a WHERE a.gate_decision_id = g.id AND a.status IN ('approved','conditional','rejected','withdrawn_pending_resubmission'))
       ORDER BY g.decided_at DESC`,
    )
    .all(gate, userId) as Array<{ project_id: string; decision_id: string; gate: string }>;
}
