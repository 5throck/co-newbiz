-- 0113_s1_calibration.sql
-- @reversible: true (purely additive — two new tables, no existing rows or
-- tables touched. Manual rollback: DROP TABLE industry_driver_calibration;
-- DROP TABLE market_external_reference; or restore from a pre-migration
-- backup — scripts/co-newbiz/restore.ts.)
--
-- S1 growth-gap calibration loop (design
-- 2026-09-18-s1-growth-gap-calibration): a persisted, sourced external
-- reference per industry (so reruns stop re-rolling the LLM prior) and a
-- driver-attribution proposal store (LLM proposes numeric driver impacts, a
-- person accepts, accepted drivers are injected as constraints into the next
-- rerun so the measured gap converges).

CREATE TABLE market_external_reference (
  id TEXT PRIMARY KEY NOT NULL,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  version_no INTEGER NOT NULL,
  source_label TEXT NOT NULL,
  source_url TEXT,
  target_year INTEGER NOT NULL,
  external_cagr_pct REAL NOT NULL,
  external_size_b REAL,
  captured_from TEXT NOT NULL CHECK (captured_from IN ('user', 'web_research', 'llm_prior')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_market_external_reference_industry
  ON market_external_reference(industry_id, version_no DESC);

CREATE TABLE industry_driver_calibration (
  id TEXT PRIMARY KEY NOT NULL,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  version_id TEXT NOT NULL REFERENCES market_sizing_version(id),
  driver TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('upside', 'downside')),
  impact_pct REAL NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'dismissed')),
  proposed_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_industry_driver_calibration_industry
  ON industry_driver_calibration(industry_id, status, created_at DESC);
