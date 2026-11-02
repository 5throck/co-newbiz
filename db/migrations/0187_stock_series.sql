-- @reversible: true (purely additive: one new table plus a bounded backfill INSERT sourced from existing
-- md_company/raw_payload/fact_market_observation rows; no existing table is altered. Rollback: the ROLLBACK-SQL
-- block below (DROP TABLE) after the pre-migration backup per ADR-0014. Registration rows that beta-series.ts
-- writes after this migration are lost with the table; rerunning a beta-series collection re-registers them.)
-- ROLLBACK-SQL-BEGIN
--   DROP TABLE stock_series;
-- ROLLBACK-SQL-END
--
-- stock_series (owner decision 2026-11-02, option 1): per-deal KRX stock series become first-class
-- nightly-collection targets. Until now a company's series (krx:stock:<md_company.id>:close) lived only in
-- the in-process KRX_DYNAMIC_SERIES registry (source-adapters.ts), registered per-process by the beta
-- regression flow (beta-series.ts) — so the nightly collect.krx job (design 2026-10-29-scheduled-jobs-design
-- section 3.1, row 3: "index closes, per-deal stock closes") collected only the two static index closes.
-- One row per company: a company's listing market is singular, enforced by the partial-free unique index
-- idx_stock_series_company(company_id); re-registration upserts (ON CONFLICT(company_id) DO UPDATE in
-- db/repositories/stock-series.repository.ts) instead of duplicating, and clears disabled_at (an explicit
-- re-registration is an affirmative act). disabled_at is the soft-disable lever: collection skips disabled
-- rows but their observation history stays. company_id is FK-by-convention to md_company (same convention
-- as every md_* reference — no FK constraint, matching the master-data tables).
--
-- Backfill: companies whose stock series ALREADY flow — a fact_market_observation row exists for
-- krx:stock:<company_id>:close — and whose resolved 단축코드 + listing market live in the raw_payload
-- stock-master record (id krx:stock-master:<company_id>, written by beta-series.ts since 2026-10-12; there
-- is no series-title table in SQLite, the descriptors live only in code). A stock-master record without
-- collected observations is NOT backfilled: registration follows data that actually flows. market is
-- lower-cased from the record's KOSPI/KOSDAQ spelling to satisfy the CHECK; KONEX is out of scope for beta
-- (source-adapters.ts krxServiceFor) and would violate the CHECK, so the WHERE excludes it. Deterministic
-- seed_ ids keep the statement re-runnable by inspection and give the rollback a precise predicate.
-- Verified against the live DB (2026-11-02): both runtime series backfill —
--   01M1MP84WFEHPHT3N57VCMCQFW 로보티즈 108490 KOSDAQ (246 observations)
--   01M1MP84VV12QG0H6HA8AZMQKV 레인보우로보틱스 277810 KOSDAQ (246 observations)

CREATE TABLE stock_series (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('kospi', 'kosdaq')),
  display_name TEXT NOT NULL,
  registered_by TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  disabled_at TEXT
);
CREATE UNIQUE INDEX idx_stock_series_company ON stock_series(company_id);

INSERT INTO stock_series (id, company_id, ticker, market, display_name, registered_by, registered_at)
SELECT
  'seed_sser_' || c.id,
  c.id,
  json_extract(r.payload, '$.short_code'),
  lower(json_extract(r.payload, '$.market')),
  c.name_ko,
  'migration-0187',
  '2026-11-02T00:00:00.000Z'
FROM md_company c
JOIN raw_payload r ON r.id = 'krx:stock-master:' || c.id
WHERE EXISTS (
    SELECT 1 FROM fact_market_observation f
    WHERE f.series_id = 'krx:stock:' || c.id || ':close'
  )
  AND lower(json_extract(r.payload, '$.market')) IN ('kospi', 'kosdaq');
