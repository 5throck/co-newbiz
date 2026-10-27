// @version 1.0.1
/**
 * Gate-integrity persistence - ADR-0186 P2 (migrations 0173, 0174). Plain
 * persistence for the acknowledged-GO snapshot, the AI brief record, the
 * dedicated kill-evaluation run and the Group IC kill override reader. No
 * policy lives here: the contract (hash, acknowledgements, blocks) is in
 * app/web-next/lib/gate-snapshot.ts and lib/gate-decision-contract.ts; the
 * routes authorize before calling.
 *
 *   gate_decision_snapshot : append-only (a trigger rejects UPDATE/DELETE) - one row per decision
 *   gate_brief_record      : append-only - the AI recommendation beside a later human decision (D9)
 *   run (gate_integrity_eval): one run per evaluation event so kill_criteria_evaluation's
 *                            UNIQUE(run_id, procedure_key, criterion_id) never collides (design 3.12)
 *   kill_criteria_override : read side only (issuance and revocation: kill-override.repository.ts, P3)
 */
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";

/** The dedicated run kind: carried in run.label (the run table has no kind column). */
export const GATE_INTEGRITY_EVAL_KIND = "gate_integrity_eval";
export const GATE_SNAPSHOT_SCHEMA_VERSION = 1;

export type EvalEvent = "brief" | "decision" | "snapshot";

/**
 * Open the run that carries ONE kill-criteria evaluation event of a project gate. The run is marked
 * superseded by itself so the consumers that pick "the latest live run of a project" (S12 scorecard,
 * greenfield sub-track) skip it; versioning.createRun skips it by label.
 */
export function createGateEvalRun(db: Database, input: { projectId: string; gate: string; event: EvalEvent; actor: string; now: string }): string {
  const id = ulid();
  db.run(
    "INSERT INTO run (id, project_id, label, input_hash, created_by, created_at, superseded_by) VALUES (?,?,?,?,?,?,?)",
    [id, input.projectId, `${GATE_INTEGRITY_EVAL_KIND}:${input.event}:${input.gate}`, GATE_INTEGRITY_EVAL_KIND, input.actor, input.now, id],
  );
  return id;
}

export interface Acknowledgement {
  key: string;
  kind: string;
  reason: string;
}

export interface InsertSnapshotInput {
  decisionId: string;
  schemaVersion: number;
  snapshotJson: string;
  snapshotHash: string;
  submittedHash: string | null;
  acknowledgements: Acknowledgement[];
  computedAt: string;
  engineVersionsJson: string;
  evalRunId: string | null;
  briefId: string | null;
}

export function insertGateSnapshot(db: Database, input: InsertSnapshotInput): void {
  if (!db.query("SELECT id FROM gate_decision WHERE id = ?").get(input.decisionId)) {
    throw new Error(`gate_snapshot_rejected: decision '${input.decisionId}' does not exist - a snapshot belongs to exactly one recorded decision.`);
  }
  db.run(
    `INSERT INTO gate_decision_snapshot
       (decision_id, schema_version, snapshot_json, snapshot_hash, submitted_hash, acknowledgements_json, computed_at, engine_versions_json, eval_run_id, brief_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      input.decisionId, input.schemaVersion, input.snapshotJson, input.snapshotHash, input.submittedHash,
      JSON.stringify(input.acknowledgements), input.computedAt, input.engineVersionsJson, input.evalRunId, input.briefId,
    ],
  );
}

export interface StoredGateSnapshot {
  decision_id: string;
  schema_version: number;
  snapshot: unknown;
  snapshot_hash: string;
  submitted_hash: string | null;
  acknowledgements: Acknowledgement[];
  computed_at: string;
  eval_run_id: string | null;
  brief_id: string | null;
}

export function getGateSnapshot(decisionId: string, db: Database = getDb()): StoredGateSnapshot | null {
  const row = db.query("SELECT * FROM gate_decision_snapshot WHERE decision_id = ?").get(decisionId) as
    | { decision_id: string; schema_version: number; snapshot_json: string; snapshot_hash: string; submitted_hash: string | null; acknowledgements_json: string; computed_at: string; eval_run_id: string | null; brief_id: string | null }
    | null;
  if (!row) return null;
  return {
    decision_id: row.decision_id, schema_version: row.schema_version, snapshot: JSON.parse(row.snapshot_json), snapshot_hash: row.snapshot_hash,
    submitted_hash: row.submitted_hash, acknowledgements: JSON.parse(row.acknowledgements_json) as Acknowledgement[], computed_at: row.computed_at,
    eval_run_id: row.eval_run_id, brief_id: row.brief_id,
  };
}

// ── AI brief record (D9) ─────────────────────────────────────────────────────

export interface BriefRecord {
  id: string;
  entity_type: "opportunity" | "project";
  entity_id: string;
  gate: string;
  recommended: "go" | "hold" | "kill" | null;
  confidence: "high" | "medium" | "low" | null;
  source: "llm" | "synthesis";
  rationale_draft_hash: string | null;
  llm_call_ref: string | null;
  eval_run_id: string | null;
  generated_by: string;
  generated_at: string;
}

export function insertBriefRecord(db: Database, input: Omit<BriefRecord, "id"> & { id?: string }): string {
  const id = input.id ?? ulid();
  db.run(
    `INSERT INTO gate_brief_record (id, entity_type, entity_id, gate, recommended, confidence, source, rationale_draft_hash, llm_call_ref, eval_run_id, generated_by, generated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.entity_type, input.entity_id, input.gate, input.recommended, input.confidence, input.source, input.rationale_draft_hash, input.llm_call_ref, input.eval_run_id, input.generated_by, input.generated_at],
  );
  return id;
}

export function getBriefRecord(db: Database, id: string): BriefRecord | null {
  return (db.query("SELECT * FROM gate_brief_record WHERE id = ?").get(id) as BriefRecord | null) ?? null;
}

/** The default brief for a decision: the caller's most recent brief for the same gate within `withinHours` (D9). */
export function latestBriefRecord(
  db: Database,
  input: { entityType: "opportunity" | "project"; entityId: string; gate: string; userId: string; now: string; withinHours?: number },
): BriefRecord | null {
  const since = new Date(new Date(input.now).getTime() - (input.withinHours ?? 24) * 3_600_000).toISOString();
  return (
    (db
      .query(
        `SELECT * FROM gate_brief_record WHERE entity_type = ? AND entity_id = ? AND gate = ? AND generated_by = ? AND generated_at >= ?
         ORDER BY generated_at DESC, id DESC LIMIT 1`,
      )
      .get(input.entityType, input.entityId, input.gate, input.userId, since) as BriefRecord | null) ?? null
  );
}

// ── Group IC kill-criteria override (read side; D1, design 3.6) ──────────────

export interface KillOverrideRow {
  id: string;
  entity_type: "opportunity" | "project";
  entity_id: string;
  procedure_key: string;
  criterion_id: string;
  reason: string;
  issued_by: string;
  issued_at: string;
}

/** Active (not revoked) overrides of one entity. */
export function listActiveKillOverrides(db: Database, entityType: "opportunity" | "project", entityId: string): KillOverrideRow[] {
  return db
    .query("SELECT id, entity_type, entity_id, procedure_key, criterion_id, reason, issued_by, issued_at FROM kill_criteria_override WHERE entity_type = ? AND entity_id = ? AND revoked_at IS NULL ORDER BY procedure_key, criterion_id")
    .all(entityType, entityId) as KillOverrideRow[];
}
