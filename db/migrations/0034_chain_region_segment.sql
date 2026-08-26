-- 0034_chain_region_segment.sql
-- @version 1.0.0
-- @reversible: true (table rebuild dropping the two new nullable columns and
-- restoring the narrower UNIQUE constraints; backup-first per ADR-0014)
--
-- Adds nullable region_code/segment_code to chain_node_sensitivity and
-- structure_simulation_result so a driver/scenario result can be recorded
-- per region×segment, not just per industry — needed to ingest the
-- hydraulic-breaker region×segment×scenario matrix
-- (docs/research/hydraulic-breaker-market-2026-driver-analysis.md §4) as
-- real chain-sensitivity/structure-simulation rows instead of a standalone
-- markdown artifact.
--
-- Free-text TEXT, no CHECK enum and no FK — same precedent as
-- site_candidate.region_code / partner_candidate.region_code (both
-- free-text, no fixed region list). NULL means "not region/segment-
-- specific", preserving the existing coarse-grained (industry-only) usage.
--
-- Table rebuild (not a plain ALTER TABLE ADD COLUMN) because the UNIQUE
-- constraints must widen to include the new columns — otherwise two rows
-- for the same industry/driver (or run/scenario/industry/metric) but
-- different region/segment would collide.

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
  segment_code TEXT,
  UNIQUE (project_id, industry_id, driver_id, region_code, segment_code)
);
INSERT INTO chain_node_sensitivity_new
  (id, project_id, industry_id, driver_id, sensitivity, lag_months, evidence_ref, assessed_by, assessed_at, region_code, segment_code)
  SELECT id, project_id, industry_id, driver_id, sensitivity, lag_months, evidence_ref, assessed_by, assessed_at, NULL, NULL
  FROM chain_node_sensitivity;
DROP TABLE chain_node_sensitivity;
ALTER TABLE chain_node_sensitivity_new RENAME TO chain_node_sensitivity;
CREATE INDEX idx_chain_node_sensitivity_project ON chain_node_sensitivity(project_id);

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
  segment_code TEXT,
  UNIQUE (run_id, scenario, industry_id, metric, region_code, segment_code)
);
INSERT INTO structure_simulation_result_new
  (id, run_id, scenario, industry_id, metric, p05, p50, p95, created_at, region_code, segment_code)
  SELECT id, run_id, scenario, industry_id, metric, p05, p50, p95, created_at, NULL, NULL
  FROM structure_simulation_result;
DROP TABLE structure_simulation_result;
ALTER TABLE structure_simulation_result_new RENAME TO structure_simulation_result;
CREATE INDEX idx_structure_sim_result_run ON structure_simulation_result(run_id);
