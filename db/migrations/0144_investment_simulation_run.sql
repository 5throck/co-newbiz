-- 0144_investment_simulation_run.sql
-- @reversible: true (purely additive - one new table and two indexes; no existing column or row
-- changes. Manual rollback: the statements in ROLLBACK-SQL below. The table is dropped with its
-- rows, so take a backup first if the stored runs must be kept. Rollback mechanism of record:
-- pre-migration backup restore (scripts/co-newbiz/restore.ts, ADR-0014). Code rollback: revert the PR.
-- ADR-0176 slice 2.)
-- ROLLBACK-SQL-BEGIN
--   DROP INDEX idx_isr_opp;
--   DROP INDEX idx_isr_current;
--   DROP TABLE investment_simulation_run;
-- ROLLBACK-SQL-END
--
-- ADR-0176 slice 2 - S5 investment simulation run storage (opportunity-keyed; S5 is pre-promotion).
-- One row per saved run of the seeded Monte Carlo over the S5 investment plan. Per-draw vectors are
-- NOT stored: they are recomputed deterministically from (seed, plan, ranges). input_hash covers the
-- plan vectors, effective ranges, seed and draw count (not the envelope), so a changed plan is
-- detectable against a stored run. A new run supersedes the previous current one (history kept,
-- never deleted): at most one status='current' row per opportunity (partial unique index).
-- superseded_by is DEFERRABLE so the old row can be marked in the same transaction that inserts
-- its successor. Results are decision support only - nothing reads this table to block a gate or
-- change a grade.

CREATE TABLE investment_simulation_run (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  input_hash TEXT NOT NULL,
  seed INTEGER NOT NULL,
  draw_count INTEGER NOT NULL CHECK (draw_count BETWEEN 100 AND 5000),
  horizon_years INTEGER NOT NULL CHECK (horizon_years >= 1),
  envelope_krw_m REAL CHECK (envelope_krw_m IS NULL OR envelope_krw_m > 0),
  assumptions_json TEXT NOT NULL CHECK (json_valid(assumptions_json)),
  results_json TEXT NOT NULL CHECK (json_valid(results_json)),
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'superseded')),
  superseded_by TEXT REFERENCES investment_simulation_run(id) DEFERRABLE INITIALLY DEFERRED,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  audit_id TEXT,
  CHECK ((status = 'superseded') = (superseded_by IS NOT NULL))
);
CREATE UNIQUE INDEX idx_isr_current ON investment_simulation_run(opportunity_id) WHERE status = 'current';
CREATE INDEX idx_isr_opp ON investment_simulation_run(opportunity_id, created_at DESC);
