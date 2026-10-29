-- @reversible: true (data-only and additive: INSERT OR IGNORE of standard reference rows; no DDL, no existing row is
-- changed. Manual rollback: the DELETE statements in ROLLBACK-SQL below - they remove only the seeded ids and fail
-- harmlessly (FK) for any row already referenced. Code rollback: revert the PR.)
-- ROLLBACK-SQL-BEGIN
--   DELETE FROM md_currency WHERE id LIKE 'seed_cur_%';
--   DELETE FROM md_country WHERE id LIKE 'seed_cty_%';
--   DELETE FROM md_source WHERE id LIKE 'seed_src_%';
-- ROLLBACK-SQL-END
--
-- Admin master-data redesign (owner request 2026-10-29): the currency and country code tables were empty and the
-- source table lacked rows the pipeline registers lazily. Seeds the ISO 4217 currencies, ISO 3166 countries/regions
-- the app uses (aligned with region-profiles KR, US, CN, JP, EU members, SEA) and the six data-source adapters with the
-- reliability grades the pipeline registers (scripts/co-newbiz/newbiz.ts GRADE map: law A, opendata B).
-- Idempotent: iso_code / code are UNIQUE, so INSERT OR IGNORE skips anything already present (including rows created
-- earlier under a ULID id). Display names (ko/en) are catalog labels, not columns - no schema change.

INSERT OR IGNORE INTO md_currency (id, iso_code, created_at) VALUES
  ('seed_cur_KRW', 'KRW', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_USD', 'USD', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_EUR', 'EUR', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_JPY', 'JPY', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_CNY', 'CNY', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_GBP', 'GBP', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_HKD', 'HKD', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_SGD', 'SGD', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_VND', 'VND', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_THB', 'THB', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_IDR', 'IDR', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_MYR', 'MYR', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_PHP', 'PHP', '2026-10-29T00:00:00.000Z'),
  ('seed_cur_INR', 'INR', '2026-10-29T00:00:00.000Z');

INSERT OR IGNORE INTO md_country (id, iso_code, created_at) VALUES
  ('seed_cty_KR', 'KR', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_US', 'US', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_CN', 'CN', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_JP', 'JP', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_GB', 'GB', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_HK', 'HK', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_TW', 'TW', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_IN', 'IN', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_DE', 'DE', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_FR', 'FR', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_IT', 'IT', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_ES', 'ES', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_NL', 'NL', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_BE', 'BE', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_AT', 'AT', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_IE', 'IE', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_SE', 'SE', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_PL', 'PL', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_SG', 'SG', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_VN', 'VN', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_TH', 'TH', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_ID', 'ID', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_MY', 'MY', '2026-10-29T00:00:00.000Z'),
  ('seed_cty_PH', 'PH', '2026-10-29T00:00:00.000Z');

INSERT OR IGNORE INTO md_source (id, code, reliability_grade, created_at) VALUES
  ('seed_src_dart', 'dart', 'A', '2026-10-29T00:00:00.000Z'),
  ('seed_src_ecos', 'ecos', 'A', '2026-10-29T00:00:00.000Z'),
  ('seed_src_krx', 'krx', 'A', '2026-10-29T00:00:00.000Z'),
  ('seed_src_kosis', 'kosis', 'A', '2026-10-29T00:00:00.000Z'),
  ('seed_src_law', 'law', 'A', '2026-10-29T00:00:00.000Z'),
  ('seed_src_opendata', 'opendata', 'B', '2026-10-29T00:00:00.000Z');
