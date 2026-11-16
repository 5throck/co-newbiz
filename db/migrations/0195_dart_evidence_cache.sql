-- @reversible: true (purely additive: three new tables, one trigger, indexes; no existing
-- table altered, no backfill. Rollback: the ROLLBACK-SQL block below after the
-- pre-migration backup per ADR-0014. Cached DART evidence is lost on rollback; it is
-- re-fetchable from DART, so no information is lost.)
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_dart_disclosure_immutable;
--   DROP TABLE dart_business_report_extract;
--   DROP TABLE dart_disclosure;
--   DROP TABLE dart_corp_sync_state;
-- ROLLBACK-SQL-END
--
-- 0195_dart_evidence_cache.sql
-- ADR-0199 (spec 2026-11-16-s6-bulk-ai-eval-versioning §3.5/§6): incremental DART
-- collection — disclosure rows by rcept_no, business-report section extracts by rcept_no,
-- and per-corp freshness state. Shared public DART evidence; no per-user or per-opportunity
-- data (no opportunity, user, candidate, or verdict column — §9, test T25).
-- Independent of 0194: no FK in either direction (versions copy their quotes and cite
-- rcept_no as text), so each migration rolls back on its own.

-- DART filing list rows, verbatim (raw layer). rcept_no is DART's immutable 14-digit
-- receipt number; a corrected filing ([기재정정] etc.) is a NEW rcept_no, never an update
-- of the old row.
CREATE TABLE dart_disclosure (
  rcept_no TEXT PRIMARY KEY NOT NULL CHECK (length(rcept_no) = 14),
  corp_code TEXT NOT NULL CHECK (length(corp_code) = 8),
  corp_name TEXT NOT NULL,
  report_nm TEXT NOT NULL,
  rcept_dt TEXT NOT NULL CHECK (length(rcept_dt) = 8),   -- YYYYMMDD as DART returns it
  flr_nm TEXT,
  rm TEXT,
  pblntf_ty TEXT,                                        -- DART disclosure type when known
  fetched_at TEXT NOT NULL                                -- ISO 8601, first time we saw the row
);
-- Pattern: incremental cursor (MAX(rcept_dt) per corp), "last 36 months for corp C",
-- and selectBusinessReport over the cached list.
CREATE INDEX idx_dart_disclosure_corp_dt ON dart_disclosure(corp_code, rcept_dt DESC);
CREATE TRIGGER trg_dart_disclosure_immutable BEFORE UPDATE ON dart_disclosure
BEGIN SELECT RAISE(ABORT, 'dart_disclosure rows are immutable (rcept_no identity)'); END;

-- Business-report section extract per rcept_no: verbatim excerpts, never the full document.
CREATE TABLE dart_business_report_extract (
  rcept_no TEXT NOT NULL REFERENCES dart_disclosure(rcept_no),
  extractor_version TEXT NOT NULL,                       -- bump → re-extract once (one fetch)
  status TEXT NOT NULL CHECK (status IN ('extracted', 'no_sections', 'not_zip')),
  sections_json TEXT CHECK (sections_json IS NULL OR json_valid(sections_json) = 1),
    -- {main_products|facilities|rnd|ip: {heading_raw, text, chars, truncated}}
  source_chars INTEGER NOT NULL CHECK (source_chars >= 0),  -- tag-stripped document length
  content_hash TEXT,                                     -- sha256 of sections_json
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (rcept_no, extractor_version)
);

-- Per-corp freshness. A timestamp advances only when that fetch kind finished successfully.
CREATE TABLE dart_corp_sync_state (
  corp_code TEXT PRIMARY KEY NOT NULL CHECK (length(corp_code) = 8),
  corp_code_checked_at TEXT,                             -- last successful validateCorpCode
  financial_checked_at TEXT,                             -- last fully successful financial fetch
  disclosures_checked_at TEXT,                           -- last fully successful list query
  disclosures_complete_through TEXT CHECK (disclosures_complete_through IS NULL
    OR length(disclosures_complete_through) = 8),        -- end_de (YYYYMMDD) of that query
  updated_at TEXT NOT NULL
);
