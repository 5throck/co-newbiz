-- @notransaction (PRAGMA foreign_keys cannot run inside a transaction, and the
-- pipeline_run CHECK widening below is a table rebuild.)
-- @reversible: true (closure_record and md_project.closure_type are additive.
-- The pipeline_run rebuild is row-preserving 1:1 — only the status CHECK widens
-- to accept 'withdrawn'. Manual rollback: DROP TABLE closure_record; ALTER
-- TABLE md_project DROP COLUMN closure_type (SQLite >=3.35); rebuild
-- pipeline_run again with the 0072 CHECK after moving any 'withdrawn' rows to
-- 'failed'; or restore from a pre-migration backup — scripts/co-newbiz/restore.ts
-- — ADR-0014.)
--
-- ADR-0152 — typed, precondition-enforced closure (Wave F, PR F-1).
--
-- (a) closure_record: one ACTIVE closure per entity (partial unique index on
--     reopened_at IS NULL). Reopening deletes nothing: it stamps reopened_at /
--     reopened_by and a new row is then allowed. basis_table/basis_id point at
--     the human-recorded deciding record (gate_decision or
--     venture_transition_decision); 'none' is used by withdrawn/dropped, which
--     have no basis record by design (the escape path).
-- (b) md_project.closure_type: denormalized for list filtering, written in the
--     same transaction as the closure_record row. NULL on legacy rows
--     ("legacy (untyped)" — no backfill, ADR-0151 grandfathering precedent).
-- (c) pipeline_run.status: 0072 already allows 'killed'; this adds 'withdrawn'
--     (SQLite cannot ALTER a CHECK — 0033/0062 rebuild pattern).
--
-- Migration date for grandfathering: 2026-10-08.

PRAGMA foreign_keys = OFF;

CREATE TABLE closure_record (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project','opportunity')),
  entity_id TEXT NOT NULL,
  closure_type TEXT NOT NULL CHECK (closure_type IN
    ('killed_at_gate','withdrawn','graduated_to_core','divested','killed_with_learning','dropped')),
  basis_table TEXT NOT NULL CHECK (basis_table IN ('gate_decision','venture_transition_decision','none')),
  basis_id TEXT,
  closure_reason TEXT NOT NULL,
  learning_capture TEXT,
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  policy_pin TEXT,
  reopened_at TEXT,
  reopened_by TEXT
);
CREATE UNIQUE INDEX idx_closure_record_active ON closure_record(entity_type, entity_id) WHERE reopened_at IS NULL;

ALTER TABLE md_project ADD COLUMN closure_type TEXT;

CREATE TABLE pipeline_run_rebuilt (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity','project')),
  entity_id TEXT NOT NULL,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  initiating_company_id TEXT NOT NULL REFERENCES md_company(id),
  status TEXT NOT NULL CHECK (status IN
    ('running','paused_for_human','completed','failed','killed','withdrawn')),
  current_stage TEXT,
  paused_reason TEXT,
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO pipeline_run_rebuilt (id, entity_type, entity_id, industry_id, initiating_company_id, status, current_stage, paused_reason, started_by, started_at, updated_at)
  SELECT id, entity_type, entity_id, industry_id, initiating_company_id, status, current_stage, paused_reason, started_by, started_at, updated_at FROM pipeline_run;
DROP TABLE pipeline_run;
ALTER TABLE pipeline_run_rebuilt RENAME TO pipeline_run;
CREATE INDEX idx_pipeline_run_entity ON pipeline_run(entity_type, entity_id);
CREATE INDEX idx_pipeline_run_status ON pipeline_run(status);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
