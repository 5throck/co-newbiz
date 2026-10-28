-- @reversible: true (additive: one new table with its index and guard trigger, plus four nullable columns on
-- benchmark_case; no existing row changes. Manual rollback: the statements in ROLLBACK-SQL below, after a backup per
-- ADR-0014 (SQLite >= 3.35 for DROP COLUMN). Code rollback: revert the PR; with no table the base-rate lookup returns
-- not_available.)
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_base_rate_supersede_only;
--   DROP TRIGGER trg_base_rate_no_delete;
--   DROP INDEX uq_base_rate_class_metric_source;
--   DROP TABLE base_rate;
--   ALTER TABLE benchmark_case DROP COLUMN evidence_kind;
--   ALTER TABLE benchmark_case DROP COLUMN maintainer;
--   ALTER TABLE benchmark_case DROP COLUMN verified_on;
--   ALTER TABLE benchmark_case DROP COLUMN reference_class_key;
-- ROLLBACK-SQL-END
--
-- ADR-0187 D2 (owner, 2026-10-27: internal post-mortems + sourced public studies, every row with provenance; design
-- 4.1 / 7). base_rate holds reference-class distributions (p10/p50/p90 of one metric for one reference class) that
-- assumption-audit (S3), the S8 valuation sanity check and the risk-officer red-team read. Provenance is mandatory on
-- EVERY row and enforced in the database, not only in the importer: source, verified_on (YYYY-MM-DD), maintainer and
-- evidence_kind are NOT NULL and non-blank. No row is seeded: the repository holds no sourced base-rate data, and an
-- invented row would be exactly the defaulted evidence H7 removes. Rows enter through
-- scripts/co-newbiz/import-base-rates.ts only. Superseded rows are kept (superseded_by), never deleted; a row is immutable except that superseded_by may go
-- once from NULL to the id of the newer row (trigger), and verified_on must be a real calendar date (date(verified_on) round-trips).
--
-- benchmark_case (migration 0041) gains the same provenance columns, nullable so the existing seeded cases keep their
-- source_ref and read as provenance-incomplete until a maintainer verifies them; scripts/co-newbiz/import-benchmark-cases.ts
-- refuses any new row without all four.

CREATE TABLE base_rate (
  id TEXT PRIMARY KEY NOT NULL,
  reference_class_key TEXT NOT NULL CHECK (length(trim(reference_class_key)) > 0),
  metric TEXT NOT NULL CHECK (length(trim(metric)) > 0),
  unit TEXT,
  sample_size INTEGER CHECK (sample_size IS NULL OR sample_size > 0),
  p10 REAL,
  p50 REAL NOT NULL,
  p90 REAL,
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  verified_on TEXT NOT NULL CHECK (verified_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' AND date(verified_on) IS verified_on),
  maintainer TEXT NOT NULL CHECK (length(trim(maintainer)) > 0),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('internal_post_mortem', 'public_study', 'regulatory_statistic', 'industry_dataset')),
  note TEXT,
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES base_rate(id),
  CHECK (p10 IS NULL OR p10 <= p50),
  CHECK (p90 IS NULL OR p50 <= p90)
);
CREATE UNIQUE INDEX uq_base_rate_class_metric_source ON base_rate(reference_class_key, metric, source, verified_on);
CREATE TRIGGER trg_base_rate_no_delete BEFORE DELETE ON base_rate
BEGIN
  SELECT RAISE(ABORT, 'base_rate rows are never deleted (ADR-0187 D2): supersede instead');
END;
CREATE TRIGGER trg_base_rate_supersede_only BEFORE UPDATE ON base_rate
WHEN OLD.superseded_by IS NOT NULL OR NEW.superseded_by IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.reference_class_key IS NOT OLD.reference_class_key OR NEW.metric IS NOT OLD.metric
  OR NEW.unit IS NOT OLD.unit OR NEW.sample_size IS NOT OLD.sample_size OR NEW.p10 IS NOT OLD.p10 OR NEW.p50 IS NOT OLD.p50
  OR NEW.p90 IS NOT OLD.p90 OR NEW.source IS NOT OLD.source OR NEW.verified_on IS NOT OLD.verified_on
  OR NEW.maintainer IS NOT OLD.maintainer OR NEW.evidence_kind IS NOT OLD.evidence_kind OR NEW.note IS NOT OLD.note
  OR NEW.imported_by IS NOT OLD.imported_by OR NEW.imported_at IS NOT OLD.imported_at
BEGIN
  SELECT RAISE(ABORT, 'base_rate rows are immutable except superseded_by NULL -> a newer row id (ADR-0187 D2)');
END;

ALTER TABLE benchmark_case ADD COLUMN reference_class_key TEXT;
ALTER TABLE benchmark_case ADD COLUMN verified_on TEXT;
ALTER TABLE benchmark_case ADD COLUMN maintainer TEXT;
ALTER TABLE benchmark_case ADD COLUMN evidence_kind TEXT
  CHECK (evidence_kind IS NULL OR evidence_kind IN ('internal_post_mortem', 'public_study', 'regulatory_statistic', 'industry_dataset'));
