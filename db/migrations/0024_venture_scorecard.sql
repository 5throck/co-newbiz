-- @reversible: true (purely additive — one CREATE TABLE + two CREATE INDEX on
-- a table with zero rows at birth; rollback mechanism is pre-migration backup
-- restore, see scripts/co-newbiz/restore.ts — ADR-0014.)
-- ADR-0059 — the venture/JV scorecard storage the E.4 chain deferred at
-- design time (ADR-0052 open question (e)). Since PR-12c/12e the two
-- producing procedures emit recurring scorecard outputs as procedure
-- artifacts only — jv-lifecycle-governance#2 (jv_health_scorecard, seven
-- dimensions) and portfolio-venture-monitoring#1 (portfolio_scorecard_rollup,
-- bifurcated financial/strategic) — with no table to store them, so the
-- monitoring script and portfolio view were blocked. This migration is that
-- first link; the rollup CLI (scripts/co-newbiz/scorecard-rollup.ts, the
-- `scorecard:rollup` command) and the PR-3 portfolio view follow.
--
-- Design (ADR-0059 §2):
--   * Run-scoped + review-cycle time-series — every rollup is reproducible
--     per run (ADR-0005 lineage) and the governance use is trend-and-trigger
--     across cycles, never latest-value-only. The '????-Q[1-4]' GLOB CHECK
--     pins the review_cycle shape, which is what makes the repository's
--     lexicographic MAX(review_cycle) latest-cycle resolution safe.
--   * The UNIQUE writer is db/repositories/venture-scorecard.repository.ts —
--     no other write path exists (raw SQL in tests is not a write path).
--   * venture_class — the CVC four-type taxonomy (driving / enabling /
--     emergent / passive) plus jv; rollups report by class, flattening is a
--     reporting choice, never forced by storage.
--   * Per-measure target REQUIRED (CHECK-constrained, single
--     insufficient_evidence escape) — balanced-scorecard discipline. The ~20
--     measure-set cap is a repository/procedure practice
--     (SCORECARD_MEASURE_CAP), NOT a schema constant.
--   * Weights NEVER a column — JV scorecard weights and review cadence are
--     ADR-0052 open question (b); when decided they enter via the
--     governance-doc reference pattern (like rag_rule.policy_id), never a
--     column with silent defaults.
--   * The JV monitor's seven dimensions map into the financial/strategic
--     sections at the PRODUCING step; measure_key preserves dimension
--     identity, so the shared rollup surface never flattens what the JV
--     procedure measured.
--   * UNIQUE (run_id, source_procedure, section, measure_key) — one row per
--     measure per section per procedure per run; the repository additionally
--     enforces one record per (project_id, source_procedure, review_cycle).
--   * Decisions excluded — venture_transition_decision and tranche releases
--     are approval-chain records (two-tier-approval-chain / group-level-review
--     lineage); this table stores evidence rows only.
CREATE TABLE venture_scorecard (
  id TEXT PRIMARY KEY,
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
  UNIQUE (run_id, source_procedure, section, measure_key)
);
CREATE INDEX idx_venture_scorecard_project ON venture_scorecard(project_id, review_cycle);
CREATE INDEX idx_venture_scorecard_rollup ON venture_scorecard(review_cycle, section);
