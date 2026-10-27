-- @reversible: true (purely additive: one new table with its indexes and a delete-guard trigger; no
-- existing table or row changes. Manual rollback: the statements in ROLLBACK-SQL below, or restore the
-- pre-migration backup, scripts/co-newbiz/restore.ts, ADR-0014. Code rollback: revert the PR or set
-- CO_NEWBIZ_GATE_INTEGRITY_KILL_BINDING=off. ADR-0186 D1 / D6, design 3.6.)
-- NOTE: rolling back drops this schema only. Already-written gate_integrity_eval runs, kill_criteria_evaluation
-- ledger rows and project_variable_snapshot rows (and audit rows) remain; they are append-only evidence.
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_kill_criteria_override_no_delete;
--   DROP INDEX uq_kill_criteria_override_active;
--   DROP INDEX idx_kill_criteria_override_entity;
--   DROP TABLE kill_criteria_override;
-- ROLLBACK-SQL-END
--
-- ADR-0186 (gate integrity, wave W2, phase P2 schema; P3 owns the issuance flow). The recorded Group IC
-- override of a binding (action `halt`) kill criterion, per entity and criterion (neb-policy 2.5, owner
-- decision O-7: may precede the formal group_ic sitting). The gate-decision write reads it: a triggered
-- halt criterion without an active override is refused (409 kill_binding_unoverridden). Issuance (a person
-- holding `group-ic-reviewer`, who is not the recorder of the decision it unblocks, audited as
-- kill_override.issue) lands in P3; this migration is the schema and the repository reader only.
-- Rows are never deleted: revoking sets revoked_at / revoked_by so the who-when-why history stays, and
-- at most one ACTIVE override exists per (entity, procedure, criterion).
CREATE TABLE kill_criteria_override (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'project')),
  entity_id TEXT NOT NULL,
  procedure_key TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX idx_kill_criteria_override_entity ON kill_criteria_override(entity_type, entity_id, revoked_at);
CREATE UNIQUE INDEX uq_kill_criteria_override_active ON kill_criteria_override(entity_type, entity_id, procedure_key, criterion_id) WHERE revoked_at IS NULL;
CREATE TRIGGER trg_kill_criteria_override_no_delete BEFORE DELETE ON kill_criteria_override
BEGIN
  SELECT RAISE(ABORT, 'kill_criteria_override rows are never deleted (ADR-0186): revoke instead');
END;
