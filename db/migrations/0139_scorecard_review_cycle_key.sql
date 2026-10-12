-- 0139_scorecard_review_cycle_key.sql
-- @reversible: true (table rebuild that only WIDENS the uniqueness key:
-- UNIQUE (run_id, source_procedure, section, measure_key) becomes
-- UNIQUE (run_id, source_procedure, review_cycle, section, measure_key) —
-- every row, column, CHECK, FK and index is copied verbatim, zero data
-- change. Manual rollback = the reverse rebuild below, legal only while no
-- (run_id, source_procedure, section, measure_key) group holds rows from
-- more than one review_cycle (the guard aborts otherwise; such rows are
-- human-recorded monitoring history and are never deleted to make a
-- rollback pass). Rollback mechanism of record: pre-migration backup
-- restore (scripts/co-newbiz/restore.ts, ADR-0014). Code rollback: revert
-- the PR.)
--
-- Run the rollback statement by statement with a stop-on-error runner (e.g.
-- `sqlite3 -bail`), inside one transaction: bun:sqlite's multi-statement
-- Database.run() does not surface a constraint failure raised by a
-- non-final statement (ADR-0163), so the guard below only aborts when each
-- statement is checked.
-- ROLLBACK-SQL-BEGIN
--   CREATE TEMP TABLE _vsc_rollback_assert (ok INTEGER NOT NULL CHECK (ok = 1));
--   INSERT INTO _vsc_rollback_assert SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM venture_scorecard GROUP BY run_id, source_procedure, section, measure_key HAVING COUNT(DISTINCT review_cycle) > 1)) = 0 THEN 1 ELSE 0 END;
--   DROP TABLE _vsc_rollback_assert;
--   CREATE TABLE venture_scorecard_old (
--     id TEXT PRIMARY KEY NOT NULL,
--     run_id TEXT NOT NULL REFERENCES run(id),
--     project_id TEXT NOT NULL REFERENCES md_project(id),
--     source_procedure TEXT NOT NULL CHECK (source_procedure IN ('jv-lifecycle-governance','portfolio-venture-monitoring')),
--     review_cycle TEXT NOT NULL CHECK (review_cycle GLOB '????-Q[1-4]'),
--     venture_class TEXT NOT NULL CHECK (venture_class IN ('driving','enabling','emergent','passive','jv')),
--     section TEXT NOT NULL CHECK (section IN ('financial','strategic')),
--     measure_key TEXT NOT NULL CHECK (measure_key <> ''),
--     target_value TEXT,
--     actual_value TEXT,
--     status TEXT NOT NULL CHECK (status IN ('on_target','deviation','insufficient_evidence')),
--     evidence_ref TEXT NOT NULL,
--     observed_at TEXT NOT NULL,
--     created_at TEXT NOT NULL,
--     CHECK (target_value IS NOT NULL OR status = 'insufficient_evidence'),
--     UNIQUE (run_id, source_procedure, section, measure_key)
--   );
--   INSERT INTO venture_scorecard_old SELECT id, run_id, project_id, source_procedure, review_cycle, venture_class, section, measure_key, target_value, actual_value, status, evidence_ref, observed_at, created_at FROM venture_scorecard;
--   DROP TABLE venture_scorecard;
--   ALTER TABLE venture_scorecard_old RENAME TO venture_scorecard;
--   CREATE INDEX idx_venture_scorecard_project ON venture_scorecard(project_id, review_cycle);
--   CREATE INDEX idx_venture_scorecard_rollup ON venture_scorecard(review_cycle, section);
-- ROLLBACK-SQL-END
--
-- ADR-0164 (Proposed): the S12 limitation "repeat quarters need a new
-- analysis run" — under 0024's key the same measure could exist once per
-- run, so a greenfield project recording its next quarter on the same run
-- hit the UNIQUE abort and the route refused with run_required. A run is a
-- reproducible lineage snapshot (ADR-0005), not a one-cycle bucket; a
-- portfolio-venture-monitoring cadence is per review_cycle. The key gains
-- review_cycle so one run can hold every quarter the cadence records.
--
-- Dedup semantics: none required and none defined — collisions are
-- IMPOSSIBLE, not merely absent. 0024's key is a strict subset of the new
-- key, so any two rows that would collide under the new key already
-- violated the old UNIQUE and cannot exist. If a hand-corrupted backup ever
-- carried such a pair, the rebuild's own new UNIQUE aborts the INSERT...
-- SELECT inside this migration's transaction (fail-closed, ADR-0163
-- stop-on-error); per the append-only norm rows are never deleted to make a
-- migration pass — human review against the pre-migration backup is the
-- path.
--
-- 0033/0132/0137 pattern: create _new, copy verbatim, row-count assert,
-- drop, rename, recreate indexes, inside this migration's transaction.
-- Column set, order, CHECKs and FKs are byte-identical to the LIVE schema
-- (0024's body as rebuilt by 0033's PK-NOT-NULL sweep — id is
-- `TEXT PRIMARY KEY NOT NULL` there, not 0024's original `TEXT PRIMARY
-- KEY`); only the UNIQUE line gains review_cycle. No table references
-- venture_scorecard and it has no triggers; its only secondary indexes are
-- the two recreated below.

CREATE TABLE venture_scorecard_new (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  source_procedure TEXT NOT NULL CHECK (source_procedure IN ('jv-lifecycle-governance','portfolio-venture-monitoring')),
  review_cycle TEXT NOT NULL CHECK (review_cycle GLOB '????-Q[1-4]'),
  venture_class TEXT NOT NULL CHECK (venture_class IN ('driving','enabling','emergent','passive','jv')),
  section TEXT NOT NULL CHECK (section IN ('financial','strategic')),
  measure_key TEXT NOT NULL CHECK (measure_key <> ''),
  target_value TEXT,
  actual_value TEXT,
  status TEXT NOT NULL CHECK (status IN ('on_target','deviation','insufficient_evidence')),
  evidence_ref TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (target_value IS NOT NULL OR status = 'insufficient_evidence'),
  UNIQUE (run_id, source_procedure, review_cycle, section, measure_key)
);

INSERT INTO venture_scorecard_new
  (id, run_id, project_id, source_procedure, review_cycle, venture_class, section, measure_key, target_value, actual_value, status, evidence_ref, observed_at, created_at)
  SELECT id, run_id, project_id, source_procedure, review_cycle, venture_class, section, measure_key, target_value, actual_value, status, evidence_ref, observed_at, created_at
  FROM venture_scorecard;

-- Row-count assertion: aborts the whole migration transaction unless equal.
CREATE TEMP TABLE _vsc_rebuild_assert (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _vsc_rebuild_assert
  SELECT CASE WHEN (SELECT COUNT(*) FROM venture_scorecard) = (SELECT COUNT(*) FROM venture_scorecard_new) THEN 1 ELSE 0 END;
DROP TABLE _vsc_rebuild_assert;

DROP TABLE venture_scorecard;
ALTER TABLE venture_scorecard_new RENAME TO venture_scorecard;

CREATE INDEX idx_venture_scorecard_project ON venture_scorecard(project_id, review_cycle);
CREATE INDEX idx_venture_scorecard_rollup ON venture_scorecard(review_cycle, section);
