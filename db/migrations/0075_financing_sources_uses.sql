-- 0075_financing_sources_uses.sql
-- @reversible: true
-- flow.spec v2.2.0 S10 투자구조 설계 — the financing plan (sources & uses)
-- that financing-plan-review assembles and the S10 completion predicate
-- balances (조달 = 사용). Amounts in KRW 백만원, the unit convention used by
-- dd_finding.value_impact (ADR-0061) and the business-case lines.

CREATE TABLE IF NOT EXISTS "financing_sources_uses" (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  kind TEXT NOT NULL CHECK (kind IN ('source','use')),
  name TEXT NOT NULL,
  amount_krw_m REAL NOT NULL CHECK (amount_krw_m >= 0),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_financing_plan_project ON financing_sources_uses(project_id);
