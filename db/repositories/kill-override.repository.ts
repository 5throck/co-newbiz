// @version 1.0.0
/**
 * Group IC kill-criteria override - issuance and revocation (ADR-0186 D1 / D6, owner decision O-7, design 3.6;
 * table: migration 0174). The READER used by the gate-decision write lives in gate-snapshot.repository.ts
 * (listActiveKillOverrides); this module is the writer. Plain persistence: the route authorizes (cookie
 * session, group-ic-reviewer grant) and validates the criterion before calling.
 *
 * Rows are never deleted: a revocation sets revoked_at / revoked_by so the who-when-why history stays, and at
 * most ONE active override exists per (entity, procedure, criterion) (partial unique index).
 */
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";

export interface KillOverrideFull {
  id: string;
  entity_type: "opportunity" | "project";
  entity_id: string;
  procedure_key: string;
  criterion_id: string;
  reason: string;
  issued_by: string;
  issued_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

export class KillOverrideError extends Error {
  constructor(readonly code: "already_active" | "not_found" | "already_revoked", message: string) {
    super(message);
  }
}

export function insertKillOverride(
  db: Database,
  input: { entityType: "opportunity" | "project"; entityId: string; procedureKey: string; criterionId: string; reason: string; issuedBy: string; now: string },
): string {
  const active = db
    .query("SELECT id FROM kill_criteria_override WHERE entity_type = ? AND entity_id = ? AND procedure_key = ? AND criterion_id = ? AND revoked_at IS NULL")
    .get(input.entityType, input.entityId, input.procedureKey, input.criterionId);
  if (active) throw new KillOverrideError("already_active", "An active override already exists for this criterion; revoke it before issuing a new one.");
  const id = ulid();
  db.run(
    "INSERT INTO kill_criteria_override (id, entity_type, entity_id, procedure_key, criterion_id, reason, issued_by, issued_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, input.entityType, input.entityId, input.procedureKey, input.criterionId, input.reason, input.issuedBy, input.now],
  );
  return id;
}

export function revokeKillOverride(
  db: Database,
  input: { entityType: "opportunity" | "project"; entityId: string; id: string; revokedBy: string; now: string },
): KillOverrideFull {
  const row = db.query("SELECT * FROM kill_criteria_override WHERE id = ? AND entity_type = ? AND entity_id = ?").get(input.id, input.entityType, input.entityId) as KillOverrideFull | null;
  if (!row) throw new KillOverrideError("not_found", `override ${input.id} not found on this entity.`);
  if (row.revoked_at) throw new KillOverrideError("already_revoked", `override ${input.id} is already revoked.`);
  db.run("UPDATE kill_criteria_override SET revoked_at = ?, revoked_by = ? WHERE id = ?", [input.now, input.revokedBy, input.id]);
  return db.query("SELECT * FROM kill_criteria_override WHERE id = ?").get(input.id) as KillOverrideFull;
}

export function listKillOverrides(entityType: "opportunity" | "project", entityId: string, opts: { includeRevoked?: boolean; db?: Database } = {}): KillOverrideFull[] {
  const db = opts.db ?? getDb();
  return db
    .query(`SELECT * FROM kill_criteria_override WHERE entity_type = ? AND entity_id = ? ${opts.includeRevoked ? "" : "AND revoked_at IS NULL"} ORDER BY issued_at DESC, id DESC`)
    .all(entityType, entityId) as KillOverrideFull[];
}
