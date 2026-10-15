-- 0145_brownfield_target_capability_judgement.sql
-- @reversible: true (purely additive — one CREATE TABLE, one CREATE INDEX, two
-- ADD COLUMN on brownfield_eval_criterion; no existing column or row semantics
-- change. Manual rollback: the statements below, run statement by statement
-- inside one transaction. Dropping the table discards the per-target judgement
-- rows, so take a backup first if they must be kept. Rollback mechanism of
-- record: pre-migration backup restore (scripts/co-newbiz/restore.ts, ADR-0014).
-- Code rollback: revert the PR (the S7 routes and UI read these objects.)
-- ROLLBACK-SQL-BEGIN
--   DROP INDEX idx_bf_target_cap_judgement_target;
--   DROP TABLE brownfield_target_capability_judgement;
--   ALTER TABLE brownfield_eval_criterion DROP COLUMN retired_reason;
--   ALTER TABLE brownfield_eval_criterion DROP COLUMN retired_at;
-- ROLLBACK-SQL-END
-- ADR-0171 slice 2 — Brown Field S7 per-target required-capability judgements.
-- Numbering note: 0144 is reserved by the parallel ADR-0176 change; the runner
-- applies every unapplied file in filename order and these objects are
-- independent of it, so the gap and either landing order are safe.
--
-- brownfield_target_capability_judgement: one row per (target, S3 register row),
-- storing the ADR-0170 judgement shape (resolution + attainability incl. basisHash,
-- s3Snapshot, staleSince, history) as JSON. eval_basis_hash is the second half of
-- the staleness basis (ADR-0171 D5): a hash of the target's evaluation state for
-- the seeded criterion; only that target's judgement goes stale when it changes.
-- capability_row_id is the S3 row id (an id inside opportunity.capability_gap_json,
-- so it has no FK); criterion_id points at the seeded criterion when one exists.
-- Judgements are kept (history preserved) when an S3 row disappears; nothing here
-- is ever deleted by reconcile.
CREATE TABLE brownfield_target_capability_judgement (
  id TEXT PRIMARY KEY NOT NULL,
  brownfield_target_id TEXT NOT NULL REFERENCES brownfield_target(id),
  capability_row_id TEXT NOT NULL,
  criterion_id TEXT REFERENCES brownfield_eval_criterion(id),
  judgement_json TEXT NOT NULL,
  eval_basis_hash TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (brownfield_target_id, capability_row_id)
);
CREATE INDEX idx_bf_target_cap_judgement_target ON brownfield_target_capability_judgement(brownfield_target_id);

-- ADR-0171 D6: criteria seeding becomes an idempotent reconcile. A criterion whose
-- S3 row was removed is retired with a marker, never deleted; its evaluation
-- records stay. Retired criteria are excluded from the catalog and the scores.
ALTER TABLE brownfield_eval_criterion ADD COLUMN retired_at TEXT;
ALTER TABLE brownfield_eval_criterion ADD COLUMN retired_reason TEXT;
