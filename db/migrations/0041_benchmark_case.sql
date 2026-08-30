-- 0041_benchmark_case.sql
-- External benchmarking case library (외부 벤치마킹 사례). Comparable public
-- deals (M&A, greenfield, license-in, JV) curated manually and seeded with
-- public examples; browsable by all users, managed by admins.
CREATE TABLE benchmark_case (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  industry TEXT,
  region TEXT,
  deal_type TEXT NOT NULL CHECK (deal_type IN ('greenfield', 'brownfield', 'license-in', 'jv', 'partnership')),
  deal_year INTEGER,
  deal_size_krw_m INTEGER,
  summary_ko TEXT NOT NULL,
  key_metrics_json TEXT,
  source_ref TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_benchmark_case_type ON benchmark_case(deal_type, deal_year);
