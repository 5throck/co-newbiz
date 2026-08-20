-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- Simulation and contingent-liability tables — docs/db-schema.md §4/§7, ADR-0026.
-- simulation_draw is the raw-iteration table archived by retention_policy
-- after N months; simulation_result's quantile summary is retained
-- permanently (docs/db-schema.md §4) — this migration creates both, the
-- archival job itself lands in the ops-automation wave (5.4), not here.

CREATE TABLE contingent_liability (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  category TEXT NOT NULL,
  description TEXT,
  probability REAL NOT NULL CHECK (probability >= 0 AND probability <= 1),
  amount_low REAL NOT NULL,
  amount_expected REAL NOT NULL,
  amount_high REAL NOT NULL,
  distribution TEXT NOT NULL DEFAULT 'triangular' CHECK (distribution IN ('triangular')),
  expected_timing_year INTEGER NOT NULL DEFAULT 0,
  evidence_ref TEXT,
  value_impact REAL,
  CHECK (amount_low <= amount_expected AND amount_expected <= amount_high)
);
CREATE INDEX idx_contingent_liability_project ON contingent_liability(project_id);

CREATE TABLE simulation (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  seed INTEGER NOT NULL,
  iterations INTEGER NOT NULL,
  discount_rate REAL NOT NULL,
  created_at TEXT NOT NULL
);

-- Quantile summary — retained permanently.
CREATE TABLE simulation_result (
  simulation_id TEXT NOT NULL REFERENCES simulation(id),
  metric TEXT NOT NULL,
  p05 REAL NOT NULL,
  p50 REAL NOT NULL,
  p95 REAL NOT NULL,
  mean REAL NOT NULL,
  std REAL NOT NULL,
  PRIMARY KEY (simulation_id, metric)
);

-- Raw per-iteration draws — archived after N months (retention_policy),
-- only quantiles in simulation_result survive archival.
CREATE TABLE simulation_draw (
  simulation_id TEXT NOT NULL REFERENCES simulation(id),
  iteration_no INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (simulation_id, iteration_no, metric)
);
-- 10,000-iteration x multi-metric read pattern — without this index, quantile
-- computation collapses (docs/db-schema.md §11).
CREATE INDEX idx_sim_draw ON simulation_draw(simulation_id, metric);

CREATE TABLE retention_policy (
  table_key TEXT PRIMARY KEY,
  basis TEXT NOT NULL,
  retention_months INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('archive', 'delete')),
  last_run_at TEXT
);
