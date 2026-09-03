-- @notransaction (PRAGMA foreign_keys cannot run inside a transaction, and the
-- gate_decision CHECK rebuild below rewrites the table in place.)
-- @reversible: true (row-preserving table rebuild — all columns and rows are
-- reproduced verbatim; only the gate CHECK widens to accept 'target_screening'
-- per flow.spec v2.0.0 S7 (ADR-0074). Manual rollback: rebuild again with the
-- 0042 CHECK, or restore from a pre-migration backup — scripts/co-newbiz/restore.ts.)
--
-- Two changes for ADR-0094 (S4~S7 stage completion):
-- 1. gate_decision CHECK: the S7 gate 'target_screening' (flow.spec gates list)
--    was missing from the 0042 enum — SQLite cannot ALTER a CHECK, so the table
--    is rebuilt with the widened constraint (0019/0061 row-preserving pattern).
-- 2. opportunity.target_universe_json: the S6 Target Universe artifact
--    (universe definition, selection criteria, minimum long-list coverage) as an
--    additive nullable column — payload JSON per the ADR-0077 precedent.

PRAGMA foreign_keys = OFF;

CREATE TABLE gate_decision_rebuilt (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'project')),
  entity_id TEXT NOT NULL,
  gate TEXT NOT NULL CHECK (gate IN ('screening', 'pre_fs', 'target_screening', 'fs', 'dd', 'entity_ic', 'group_ic')),
  decision TEXT NOT NULL CHECK (decision IN ('go', 'hold', 'kill')),
  rationale TEXT NOT NULL,
  missing_artifacts_json TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
INSERT INTO gate_decision_rebuilt (id, entity_type, entity_id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at)
  SELECT id, entity_type, entity_id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at FROM gate_decision;
DROP TABLE gate_decision;
ALTER TABLE gate_decision_rebuilt RENAME TO gate_decision;
CREATE INDEX IF NOT EXISTS idx_gate_decision_entity ON gate_decision(entity_type, entity_id, gate, decided_at);

ALTER TABLE opportunity ADD COLUMN target_universe_json TEXT;

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
