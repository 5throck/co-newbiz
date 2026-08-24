-- 0030_chain_scenario_schema.sql
-- @version 1.0.0
-- @reversible: true (additive DDL — three new tables + four driver seed rows;
-- reversal is DROP TABLE in reverse dependency order plus DELETE of seeds,
-- backup-first per ADR-0014)
--
-- ADR-0066 — Phase B of the value-chain scenario-simulation design
-- (docs/designs/2026-08-24-value-chain-scenario-simulation-design_ko.md).
--
--   industry_driver            external-driver registry; v1 set is exactly
--                              the user-approved quartet (rate/fx/commodity/
--                              regulation). Extension = INSERT, never a
--                              migration-borne enum CHECK.
--   chain_node_sensitivity     per-(project, industry, driver) elasticity +
--                              lag, produced by market-intelligence-agent's
--                              six-axis analysis; UNIQUE per triple — one
--                              live sensitivity per question.
--   structure_simulation_result quantile output of python/structure_sim.py
--                              (Phase C writes it); scenario vocabulary is
--                              the preset trio plus 'custom'; metrics are
--                              the propagation outputs the design names.
--
-- Scenario INPUTS ride the existing run-versioning machinery as drv.*
-- assumption keys (drv.rate_bp / drv.fx_pct / drv.commodity_pct /
-- drv.regulation_severity) — no new input table; ADR-0005 immutability and
-- FR-DATA-07's assumed-requires-rationale rule apply unchanged.

CREATE TABLE industry_driver (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label_ko TEXT NOT NULL,
  description TEXT,
  source_series_id TEXT REFERENCES md_source(id),
  created_at TEXT NOT NULL
);

CREATE TABLE chain_node_sensitivity (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  driver_id TEXT NOT NULL REFERENCES industry_driver(id),
  sensitivity REAL NOT NULL CHECK (sensitivity >= -10 AND sensitivity <= 10),
  lag_months INTEGER NOT NULL DEFAULT 0 CHECK (lag_months >= 0),
  evidence_ref TEXT,
  assessed_by TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  UNIQUE (project_id, industry_id, driver_id)
);
CREATE INDEX idx_chain_node_sensitivity_project ON chain_node_sensitivity(project_id);

CREATE TABLE structure_simulation_result (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  scenario TEXT NOT NULL CHECK (scenario IN ('downside', 'base', 'upside', 'custom')),
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  metric TEXT NOT NULL CHECK (metric IN ('demand_delta_pct', 'margin_delta_pp', 'hhi_delta')),
  p05 REAL NOT NULL,
  p50 REAL NOT NULL,
  p95 REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, scenario, industry_id, metric)
);
CREATE INDEX idx_structure_sim_result_run ON structure_simulation_result(run_id);

-- Driver registry v1 — the approved quartet. source_series_id stays NULL
-- until a series is actually ingested (rate/fx/commodity gain one via the
-- market-data pipeline; regulation has no quantitative series in v1).
INSERT INTO industry_driver (id, code, label_ko, description, source_series_id, created_at) VALUES
  ('drv-rate', 'rate', '금리', '정책금리/시장금리 변화 — 수요(자본비용)와 할인율 경로', NULL, '2026-08-24T00:00:00Z'),
  ('drv-fx', 'fx', '환율', '원/달러 환율 변화 — 수출가격경쟁력과 원자재 수입원가 경로', NULL, '2026-08-24T00:00:00Z'),
  ('drv-commodity', 'commodity', '원자재 가격', '핵심 원자재 가격 변화 — 업스트림 원가 → pass-through 경로', NULL, '2026-08-24T00:00:00Z'),
  ('drv-regulation', 'regulation', '규제 강도', '규제 강화/완화 서브젝티브 스케일(0–3, rationale 필수)', NULL, '2026-08-24T00:00:00Z');
