-- 0068_fs_valuation_outputs.sql
-- @reversible: true (purely additive — one CREATE TABLE + one CREATE INDEX;
-- no existing table or row is touched. Manual rollback: DROP TABLE
-- valuation_simulation, or restore from a pre-migration backup —
-- scripts/co-newbiz/restore.ts.)
--
-- S8 feasibility outputs (ADR-0098 §1). One row per (scenario, percentile)
-- pair, persisting the output of the seeded Monte Carlo runner over the
-- value drivers (scripts/co-newbiz/simulate.ts's SimulationResult /
-- python/monte_carlo.py; ADR-0052 §D.4 — distributional valuation, never a
-- point estimate with a narrative footnote). `note` carries the seed and
-- driver assumptions so any persisted figure is reproducible.
CREATE TABLE valuation_simulation (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  model_id TEXT NOT NULL REFERENCES business_case_model(id),
  scenario TEXT NOT NULL CHECK (scenario IN ('base','upside','downside')),
  percentile TEXT NOT NULL,          -- e.g. 'p50', 'p95'
  npv_krw_m REAL NOT NULL,
  irr REAL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_val_sim_project ON valuation_simulation(project_id, model_id, scenario);
