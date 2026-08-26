-- 0035_chain_region_segment_null_collapse_fix.sql
-- @version 1.0.0
-- @reversible: true (table rebuild restoring the original UNIQUE(...) column
-- constraints without the COALESCE-based index; backup-first per ADR-0014)
--
-- Fixes a regression introduced by 0034: SQLite treats NULL as distinct in
-- a UNIQUE column-list constraint, so
-- UNIQUE(project_id, industry_id, driver_id, region_code, segment_code)
-- silently stopped rejecting duplicate (project_id, industry_id, driver_id)
-- rows whenever region_code/segment_code were both NULL — breaking the
-- pre-existing "one live sensitivity per (project, industry, driver)"
-- invariant asserted by tests/unit/migration-0030.test.ts (same problem on
-- structure_simulation_result's run/scenario/industry/metric invariant).
--
-- Fix: keep the columns, but enforce uniqueness via a UNIQUE INDEX over
-- COALESCE(region_code, '') / COALESCE(segment_code, '') instead of a
-- column-list UNIQUE constraint — COALESCE collapses NULL to '' so two
-- "unspecified region/segment" rows for the same industry/driver (or
-- run/scenario/industry/metric) collide exactly as before 0034, while
-- distinct region/segment values still get independent rows.

-- ── chain_node_sensitivity ──────────────────────────────────────
CREATE TABLE chain_node_sensitivity_new (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  driver_id TEXT NOT NULL REFERENCES industry_driver(id),
  sensitivity REAL NOT NULL CHECK (sensitivity >= -10 AND sensitivity <= 10),
  lag_months INTEGER NOT NULL DEFAULT 0 CHECK (lag_months >= 0),
  evidence_ref TEXT,
  assessed_by TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  region_code TEXT,
  segment_code TEXT
);
INSERT INTO chain_node_sensitivity_new SELECT * FROM chain_node_sensitivity;
DROP TABLE chain_node_sensitivity;
ALTER TABLE chain_node_sensitivity_new RENAME TO chain_node_sensitivity;
CREATE INDEX idx_chain_node_sensitivity_project ON chain_node_sensitivity(project_id);
CREATE UNIQUE INDEX idx_chain_node_sensitivity_unique
  ON chain_node_sensitivity(project_id, industry_id, driver_id, COALESCE(region_code, ''), COALESCE(segment_code, ''));

-- ── structure_simulation_result ─────────────────────────────────
CREATE TABLE structure_simulation_result_new (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES run(id),
  scenario TEXT NOT NULL CHECK (scenario IN ('downside', 'base', 'upside', 'custom')),
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  metric TEXT NOT NULL CHECK (metric IN ('demand_delta_pct', 'margin_delta_pp', 'hhi_delta')),
  p05 REAL NOT NULL,
  p50 REAL NOT NULL,
  p95 REAL NOT NULL,
  created_at TEXT NOT NULL,
  region_code TEXT,
  segment_code TEXT
);
INSERT INTO structure_simulation_result_new SELECT * FROM structure_simulation_result;
DROP TABLE structure_simulation_result;
ALTER TABLE structure_simulation_result_new RENAME TO structure_simulation_result;
CREATE INDEX idx_structure_sim_result_run ON structure_simulation_result(run_id);
CREATE UNIQUE INDEX idx_structure_sim_result_unique
  ON structure_simulation_result(run_id, scenario, industry_id, metric, COALESCE(region_code, ''), COALESCE(segment_code, ''));
