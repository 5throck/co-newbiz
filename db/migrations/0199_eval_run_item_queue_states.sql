-- @notransaction
-- 0199_eval_run_item_queue_states.sql
-- @version 1.0.0
-- @reversible: true (table rebuild to widen the run-item state CHECK with 'skipped_active' and 'cancelled'; every existing row is
-- copied verbatim, so row counts match before and after. In-place rollback (ADR-0014) is valid ONLY after the new states are mapped
-- back and no run is active. The drain precondition is MANUAL: nothing in the rollback enforces it, so the operator must run the
-- GUARD query below and abort unless it returns 0 (drain or cancel the active runs first). If it is skipped, the mapping step turns
-- 'cancelled' items into 'pending' inside runs that are already terminal or paused, leaving pending items no engine will ever take,
-- and active runs would be rewritten under a live engine. The rollback rebuilds the table with the 0194 state CHECK plus the 0197
-- apply_summary column (it is not a return to the bare 0194 table). Otherwise restore the pre-migration backup
-- (scripts/co-newbiz/restore.ts). Code and migration roll back together: pre-0199 code does not know the two states.)
-- ROLLBACK-SQL-BEGIN
--   PRAGMA foreign_keys = OFF;
--   -- GUARD (must be 0, else drain or cancel the active runs first): SELECT COUNT(*) FROM brownfield_eval_draft_run WHERE status IN ('running', 'paused_budget', 'interrupted');
--   UPDATE brownfield_eval_draft_run_item SET state = 'pending' WHERE state = 'cancelled';
--   UPDATE brownfield_eval_draft_run_item SET state = 'failed', error_message = 'skipped_active' WHERE state = 'skipped_active';
--   DROP INDEX idx_bedri_target_state;
--   DROP INDEX idx_bedri_run_state;
--   CREATE TABLE brownfield_eval_draft_run_item_old (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES brownfield_eval_draft_run(id) ON DELETE CASCADE, brownfield_target_id TEXT NOT NULL REFERENCES brownfield_target(id) ON DELETE CASCADE, seq INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending', 'financial_sync', 'financial_draft', 'technical_draft', 'done', 'failed', 'skipped_not_dart', 'skipped_no_company', 'skipped_llm_unconfigured')), financial_outcome TEXT CHECK (financial_outcome IS NULL OR financial_outcome IN ('versioned', 'unchanged', 'failed', 'skipped', 'nothing_pending')), technical_outcome TEXT CHECK (technical_outcome IS NULL OR technical_outcome IN ('versioned', 'unchanged', 'failed', 'skipped', 'nothing_pending')), financial_version_id TEXT REFERENCES brownfield_eval_draft_version(id), technical_version_id TEXT REFERENCES brownfield_eval_draft_version(id), dart_calls INTEGER NOT NULL DEFAULT 0 CHECK (dart_calls >= 0), error_message TEXT, updated_at TEXT NOT NULL, apply_summary TEXT CHECK (apply_summary IS NULL OR json_valid(apply_summary) = 1), UNIQUE (run_id, brownfield_target_id));
--   INSERT INTO brownfield_eval_draft_run_item_old SELECT id, run_id, brownfield_target_id, seq, state, financial_outcome, technical_outcome, financial_version_id, technical_version_id, dart_calls, error_message, updated_at, apply_summary FROM brownfield_eval_draft_run_item;
--   DROP TABLE brownfield_eval_draft_run_item;
--   ALTER TABLE brownfield_eval_draft_run_item_old RENAME TO brownfield_eval_draft_run_item;
--   CREATE INDEX idx_bedri_run_state ON brownfield_eval_draft_run_item(run_id, state, seq);
--   PRAGMA foreign_keys = ON;
-- ROLLBACK-SQL-END
--
-- ADR-0200 decision 8 (design 2026-11-17-s6-direct-ai-verdict section 10.7): bulk evaluation becomes a queue of per-candidate items.
-- Two item states are added: 'skipped_active' (the candidate is already being evaluated elsewhere, or was taken over by a single
-- start) and 'cancelled' (a queued item cancelled by a person). SQLite cannot alter a CHECK in place, so the table is rebuilt
-- (create, copy, drop, rename). The 0197 apply_summary column and its json_valid CHECK are kept. A second index serves the start-time
-- dedupe query "is candidate T non-terminal in any active run?". No other table references this one.
-- Review points for data-architect/dba: row-count parity, PRAGMA foreign_key_check after the rename, both indexes, the new CHECK
-- accepts every legacy row, drain precondition and the rollback rehearsal.
--
-- @notransaction: PRAGMA foreign_keys = OFF is a no-op inside a transaction (same reason as 0033 and 0198); a pre-migration backup is
-- the recovery path if the rebuild fails partway.

PRAGMA foreign_keys = OFF;

CREATE TABLE brownfield_eval_draft_run_item_new (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES brownfield_eval_draft_run(id) ON DELETE CASCADE,
  brownfield_target_id TEXT NOT NULL REFERENCES brownfield_target(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN
    ('pending', 'financial_sync', 'financial_draft', 'technical_draft',
     'done', 'failed', 'skipped_not_dart', 'skipped_no_company', 'skipped_llm_unconfigured',
     'skipped_active', 'cancelled')),
  financial_outcome TEXT CHECK (financial_outcome IS NULL OR financial_outcome IN
    ('versioned', 'unchanged', 'failed', 'skipped', 'nothing_pending')),
  technical_outcome TEXT CHECK (technical_outcome IS NULL OR technical_outcome IN
    ('versioned', 'unchanged', 'failed', 'skipped', 'nothing_pending')),
  financial_version_id TEXT REFERENCES brownfield_eval_draft_version(id),
  technical_version_id TEXT REFERENCES brownfield_eval_draft_version(id),
  dart_calls INTEGER NOT NULL DEFAULT 0 CHECK (dart_calls >= 0),
  error_message TEXT,
  updated_at TEXT NOT NULL,
  apply_summary TEXT CHECK (apply_summary IS NULL OR json_valid(apply_summary) = 1),
  UNIQUE (run_id, brownfield_target_id)
);

INSERT INTO brownfield_eval_draft_run_item_new
  (id, run_id, brownfield_target_id, seq, state, financial_outcome, technical_outcome, financial_version_id,
   technical_version_id, dart_calls, error_message, updated_at, apply_summary)
SELECT id, run_id, brownfield_target_id, seq, state, financial_outcome, technical_outcome, financial_version_id,
       technical_version_id, dart_calls, error_message, updated_at, apply_summary
FROM brownfield_eval_draft_run_item;

DROP TABLE brownfield_eval_draft_run_item;
ALTER TABLE brownfield_eval_draft_run_item_new RENAME TO brownfield_eval_draft_run_item;

-- Pattern: resume scan "first non-terminal item of run R in seq order".
CREATE INDEX idx_bedri_run_state ON brownfield_eval_draft_run_item(run_id, state, seq);
-- Pattern: start-time dedupe "is candidate T non-terminal in any active run?".
CREATE INDEX idx_bedri_target_state ON brownfield_eval_draft_run_item(brownfield_target_id, state);

PRAGMA foreign_keys = ON;
