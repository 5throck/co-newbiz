-- 0044_business_case_model.sql
-- S5 Business Case (docs/process-flow.md §3 S5). Business Case is the
-- umbrella domain concept; this phase implements the greenfield cost model
-- (Market → Revenue → HC → CAPEX → OPEX → EBITDA → FCF → NPV/IRR → BEP).
-- The other kinds (revenue / valuation / investment_return) share this
-- skeleton and are future extensions — valuation for the brownfield track
-- stays with the Commercial-DD-led flow until then.
CREATE TABLE business_case_model (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  kind TEXT NOT NULL CHECK (kind IN ('greenfield_cost', 'revenue', 'valuation', 'investment_return')),
  name TEXT NOT NULL,
  horizon_years INTEGER NOT NULL DEFAULT 5,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_bc_model_project ON business_case_model(project_id, kind);

CREATE TABLE business_case_line (
  id TEXT PRIMARY KEY NOT NULL,
  model_id TEXT NOT NULL REFERENCES business_case_model(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('labor', 'opex', 'capex', 'revenue')),
  name TEXT NOT NULL,
  annual_amount_krw_m REAL NOT NULL,
  headcount INTEGER,
  start_year INTEGER NOT NULL DEFAULT 1,
  growth_rate REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_bc_line_model ON business_case_line(model_id, category);
