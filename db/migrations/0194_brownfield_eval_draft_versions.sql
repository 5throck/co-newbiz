-- @reversible: true (additive: three new tables, two triggers, indexes, and one
-- nullable FK column on brownfield_target_eval_state; no existing row rewritten,
-- no backfill. Rollback: the ROLLBACK-SQL block below after the pre-migration
-- backup per ADR-0014. Draft versions, run history, and confirmed_from_version_id
-- links recorded after this migration are lost on rollback; human verdicts stay.)
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_bedv_no_update;
--   DROP TRIGGER trg_bedv_no_orphan_delete;
--   DROP TABLE brownfield_eval_draft_run_item;
--   (brownfield_target_eval_state.confirmed_from_version_id participates in a
--    FOREIGN KEY, so SQLite cannot DROP COLUMN it: rebuild the table without the
--    column (0104 create-copy-rename pattern) or restore the pre-migration backup;
--    only then:)
--   DROP TABLE brownfield_eval_draft_version;
--   DROP TABLE brownfield_eval_draft_run;
-- ROLLBACK-SQL-END
--
-- 0194_brownfield_eval_draft_versions.sql
-- ADR-0199 (spec 2026-11-16-s6-bulk-ai-eval-versioning §3.2): S6 bulk AI evaluation —
-- run header, per-candidate progress, immutable per-candidate/per-category draft
-- snapshots, and the human-verdict → draft-version attribution link.
-- Layer: fact (operational run header + progress are mutable; the version table is an
-- immutable snapshot, ADR-0005). No md_* change: categories and statuses are closed
-- CHECK enumerations (migrations 0103/0104 precedent). No monetary column (ADR-0061).
-- Portability (ADR-0002): partial indexes, ON DELETE CASCADE and CHECK enumerations are
-- portable; json_valid and the trigger syntax follow the 0150/0193 and ADR-0012 house
-- precedent and carry the same portability note.

CREATE TABLE brownfield_eval_draft_run (
  id TEXT PRIMARY KEY NOT NULL,                         -- ulid (db/lib/ulid.ts)
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  categories TEXT NOT NULL CHECK (categories IN ('financial', 'technical', 'both')),
  web_evidence INTEGER NOT NULL DEFAULT 0 CHECK (web_evidence IN (0, 1)),  -- per-run opt-in (Q1); resume reuses it
  force_refresh INTEGER NOT NULL DEFAULT 0 CHECK (force_refresh IN (0, 1)), -- ignore the DART freshness window (§6.2); resume reuses it
  status TEXT NOT NULL CHECK (status IN
    ('running', 'paused_budget', 'interrupted', 'completed', 'cancelled', 'failed')),
  total_targets INTEGER NOT NULL CHECK (total_targets >= 0),
  started_by TEXT NOT NULL,                             -- app_user.id of the caller (boundary #1)
  started_via TEXT NOT NULL,                            -- callPathOf(ctx): web | mcp | agent-delegated
  resumed_by TEXT,                                      -- last person/delegated caller who resumed
  started_at TEXT NOT NULL,                             -- ISO 8601
  heartbeat_at TEXT NOT NULL,                           -- bumped after every step; stale → interrupted
  finished_at TEXT,
  pause_reason TEXT,                                    -- e.g. 'dart_budget_reserve', 'dart_status_020'
  error_message TEXT
);
-- Pattern: "is a run active for this opportunity?" (start = reuse; one active run max).
CREATE UNIQUE INDEX ux_bedr_active ON brownfield_eval_draft_run(opportunity_id)
  WHERE status IN ('running', 'paused_budget', 'interrupted');
-- Pattern: "latest run for this opportunity" (S6 progress panel on load).
CREATE INDEX idx_bedr_opp_started ON brownfield_eval_draft_run(opportunity_id, started_at DESC);

CREATE TABLE brownfield_eval_draft_version (
  id TEXT PRIMARY KEY NOT NULL,
  brownfield_target_id TEXT NOT NULL REFERENCES brownfield_target(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('financial', 'technical')),
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  run_id TEXT REFERENCES brownfield_eval_draft_run(id),  -- NULL reserved for a future single-candidate S7 path (Q5)
  provisional_score INTEGER CHECK (provisional_score IS NULL OR provisional_score BETWEEN 0 AND 100),
  proposed_count INTEGER NOT NULL CHECK (proposed_count >= 0),
  unverified_count INTEGER NOT NULL CHECK (unverified_count >= 0),
  evidence_grade TEXT NOT NULL CHECK (evidence_grade IN ('A', 'B', 'C', 'U')),  -- ADR-0187 D1
  input_hash TEXT NOT NULL,                             -- sha256 of canonical inputs (ADR-0005)
  payload TEXT NOT NULL CHECK (json_valid(payload) = 1),
  created_by TEXT NOT NULL,                             -- the run's acting caller
  created_at TEXT NOT NULL,
  UNIQUE (brownfield_target_id, category, version_no)
);
-- The UNIQUE index above serves "latest version per target+category" (MAX(version_no))
-- and the per-candidate version list. Pattern: "versions produced by run R".
CREATE INDEX idx_bedv_run ON brownfield_eval_draft_version(run_id);

-- Created AFTER brownfield_eval_draft_version so the *_version_id FKs bind. Both this
-- row and the version rows cascade with a deleted candidate within one statement.
CREATE TABLE brownfield_eval_draft_run_item (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES brownfield_eval_draft_run(id) ON DELETE CASCADE,
  brownfield_target_id TEXT NOT NULL REFERENCES brownfield_target(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                                 -- processing order, stable across resume
  state TEXT NOT NULL CHECK (state IN
    ('pending', 'financial_sync', 'financial_draft', 'technical_draft',
     'done', 'failed', 'skipped_not_dart', 'skipped_no_company', 'skipped_llm_unconfigured')),
  financial_outcome TEXT CHECK (financial_outcome IS NULL OR financial_outcome IN
    ('versioned', 'unchanged', 'failed', 'skipped', 'nothing_pending')),
  technical_outcome TEXT CHECK (technical_outcome IS NULL OR technical_outcome IN
    ('versioned', 'unchanged', 'failed', 'skipped', 'nothing_pending')),
  -- The version written ('versioned') or re-confirmed as current ('unchanged', §3.3).
  financial_version_id TEXT REFERENCES brownfield_eval_draft_version(id),
  technical_version_id TEXT REFERENCES brownfield_eval_draft_version(id),
  dart_calls INTEGER NOT NULL DEFAULT 0 CHECK (dart_calls >= 0),  -- calls spent on this item (budget telemetry, §6.1)
  error_message TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, brownfield_target_id)
);
-- Pattern: resume scan "first non-terminal item of run R in seq order".
CREATE INDEX idx_bedri_run_state ON brownfield_eval_draft_run_item(run_id, state, seq);

-- Immutability (ADR-0005 snapshot rule, ADR-0012 trigger precedent): never UPDATE.
CREATE TRIGGER trg_bedv_no_update BEFORE UPDATE ON brownfield_eval_draft_version
BEGIN SELECT RAISE(ABORT, 'brownfield_eval_draft_version is immutable'); END;
-- DELETE only as the FK cascade of a deleted candidate (parent row already gone).
CREATE TRIGGER trg_bedv_no_orphan_delete BEFORE DELETE ON brownfield_eval_draft_version
WHEN EXISTS (SELECT 1 FROM brownfield_target WHERE id = OLD.brownfield_target_id)
BEGIN SELECT RAISE(ABORT, 'draft versions are deleted only with their candidate'); END;

ALTER TABLE brownfield_target_eval_state
  ADD COLUMN confirmed_from_version_id TEXT REFERENCES brownfield_eval_draft_version(id);
-- Pattern: "which verdicts rested on version V" (comparison table badge, audit lookup).
CREATE INDEX idx_bf_target_eval_state_from_version
  ON brownfield_target_eval_state(confirmed_from_version_id)
  WHERE confirmed_from_version_id IS NOT NULL;
