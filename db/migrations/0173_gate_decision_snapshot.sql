-- @reversible: true (additive: two new tables with their indexes and append-only triggers plus three
-- nullable columns on gate_decision; no existing column or row changes. Manual rollback: the
-- statements in ROLLBACK-SQL below (ALTER TABLE ... DROP COLUMN needs SQLite 3.35+; otherwise
-- restore the pre-migration backup, scripts/co-newbiz/restore.ts, ADR-0014). Code rollback: revert
-- the PR or set the CO_NEWBIZ_GATE_INTEGRITY_SNAPSHOT_ACK / _KILL_BINDING / _DIVERGENCE flags to off.
-- ADR-0186 D1 / D9, design 3.1, 3.9, 3.12.)
-- NOTE: rolling back drops this schema only. Already-written gate_integrity_eval runs, kill_criteria_evaluation
-- ledger rows and project_variable_snapshot rows (and audit rows) remain; they are append-only evidence.
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_gate_decision_snapshot_no_delete;
--   DROP TRIGGER trg_gate_decision_snapshot_no_update;
--   DROP TABLE gate_decision_snapshot;
--   (gate_brief_record can be dropped only after gate_decision.ai_brief_id is cleared or the backup restored)
--   DROP TRIGGER trg_gate_brief_record_no_delete;
--   DROP TRIGGER trg_gate_brief_record_no_update;
--   DROP INDEX idx_gate_brief_record_entity;
--   DROP TABLE gate_brief_record;
--   ALTER TABLE gate_decision DROP COLUMN divergence_reason;
--   ALTER TABLE gate_decision DROP COLUMN ai_recommended_decision;
--   (ai_brief_id carries a foreign key, so SQLite cannot DROP COLUMN it: leave the nullable column or restore the backup)
-- ROLLBACK-SQL-END
--
-- ADR-0186 (gate integrity, wave W2, phase P2). The acknowledged-GO snapshot: what the server knew at
-- the moment a gate decision was recorded (kill-criteria outcomes, RAG with its data-confidence cap,
-- validator completeness, WACC state, open non-waivable items, waivers, ladder, AI recommendation) and
-- what the recorder acknowledged, stored beside the decision, immutable. One snapshot per decision, for
-- every decision (GO, HOLD and KILL). Rows exist only for decisions recorded under the new contract; a
-- decision without a snapshot row is "legacy" (derived, never rewritten - ADR-0161 precedent).
--   * append-only: a trigger rejects UPDATE and DELETE (design 3.14); there is no code path either.
--   * snapshot_hash is the canonical hash of the recomputed state (sorted keys, fixed number format,
--     volatile ids and timestamps excluded); submitted_hash is what the recorder's client sent (NULL when
--     the family ran in off/shadow mode and none was sent).
--   * eval_run_id links the decision to the kill-criteria evaluation it used (project gates: the
--     `gate_integrity_eval` run whose kill_criteria_evaluation rows were written in the same transaction;
--     opportunity gates: NULL, the outcomes live in snapshot_json only - design 3.12).
CREATE TABLE gate_decision_snapshot (
  decision_id TEXT PRIMARY KEY NOT NULL REFERENCES gate_decision(id),
  schema_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  submitted_hash TEXT,
  acknowledgements_json TEXT NOT NULL DEFAULT '[]',
  computed_at TEXT NOT NULL,
  engine_versions_json TEXT NOT NULL,
  eval_run_id TEXT REFERENCES run(id),
  brief_id TEXT REFERENCES gate_brief_record(id)
);
CREATE TRIGGER trg_gate_decision_snapshot_no_update BEFORE UPDATE ON gate_decision_snapshot
BEGIN
  SELECT RAISE(ABORT, 'gate_decision_snapshot is append-only (ADR-0186): UPDATE is not allowed');
END;
CREATE TRIGGER trg_gate_decision_snapshot_no_delete BEFORE DELETE ON gate_decision_snapshot
BEGIN
  SELECT RAISE(ABORT, 'gate_decision_snapshot is append-only (ADR-0186): DELETE is not allowed');
END;

-- The AI gate brief's recommendation, persisted so a later human decision can be compared with it (D9).
-- The brief itself stays on-demand text; only the recommendation, its confidence and provenance are kept.
CREATE TABLE gate_brief_record (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'project')),
  entity_id TEXT NOT NULL,
  gate TEXT NOT NULL,
  recommended TEXT CHECK (recommended IS NULL OR recommended IN ('go', 'hold', 'kill')),
  confidence TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
  source TEXT NOT NULL DEFAULT 'synthesis' CHECK (source IN ('llm', 'synthesis')),
  rationale_draft_hash TEXT,
  llm_call_ref TEXT,
  eval_run_id TEXT REFERENCES run(id),
  generated_by TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
CREATE INDEX idx_gate_brief_record_entity ON gate_brief_record(entity_type, entity_id, gate, generated_by, generated_at DESC);
CREATE TRIGGER trg_gate_brief_record_no_update BEFORE UPDATE ON gate_brief_record
BEGIN
  SELECT RAISE(ABORT, 'gate_brief_record is append-only (ADR-0186): UPDATE is not allowed');
END;
CREATE TRIGGER trg_gate_brief_record_no_delete BEFORE DELETE ON gate_brief_record
BEGIN
  SELECT RAISE(ABORT, 'gate_brief_record is append-only (ADR-0186): DELETE is not allowed');
END;

-- The recommendation and the human's reason for diverging from it, on the decision row itself (D9).
-- NULL on every decision recorded before this migration and whenever no brief existed.
ALTER TABLE gate_decision ADD COLUMN ai_recommended_decision TEXT;
ALTER TABLE gate_decision ADD COLUMN ai_brief_id TEXT REFERENCES gate_brief_record(id);
ALTER TABLE gate_decision ADD COLUMN divergence_reason TEXT;
