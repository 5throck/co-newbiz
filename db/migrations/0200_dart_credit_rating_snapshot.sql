-- @reversible: true (purely additive: one new table, one trigger, one index; no existing table altered, no
-- backfill. Rollback: the ROLLBACK-SQL block below after the pre-migration backup per ADR-0014. The cached
-- credit-rating evidence is lost on rollback; it is re-fetchable from DART, so no information is lost.)
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_dart_credit_rating_snapshot_immutable;
--   DROP INDEX idx_dart_credit_rating_snapshot_corp;
--   DROP TABLE dart_credit_rating_snapshot;
-- ROLLBACK-SQL-END
--
-- 0200_dart_credit_rating_snapshot.sql
-- ADR-0208 (design 2026-11-26-wacc-credit-rating-spread section 8.2, slice 2): the disclosed credit rating of a
-- company, parsed from one DART filing and kept as an immutable snapshot. One row per (source filing, parser
-- version): a new parser_version re-parses a filing once, an rcept_no itself is immutable (a corrected filing is a
-- NEW rcept_no). Shared public DART evidence: no user, project, opportunity or verdict column.
--
-- Why a separate table and not new keys in dart_business_report_extract (0195): that table's section keys feed the
-- brownfield AI-evaluation windows (ADR-0199) and an extractor-version bump re-fetches every cached report for the
-- S6 flow. Credit data has a different consumer and cadence. No FK to dart_disclosure either: a debt-securities
-- registration (bdRs.json) filing need not be in the disclosure cache, and 0195 / 0200 must roll back independently.
--
-- status vocabulary (a parse that finds nothing is a RECORDED status, never "unrated"):
--   parsed                         at least one domestic corporate-bond rating row was found
--   section_present_no_bond_rating the rating section exists but holds no domestic corporate-bond rating
--                                  (for example commercial-paper only)
--   not_disclosed                  the section exists and states that nothing applies (the filer has no rating)
--   section_absent                 the heading of the rating section was not found in the document
--   parse_failed                   the section exists with content but no row could be read (layout drift): NOT "unrated"
--   not_zip                        the document is not a ZIP (HWP binary and the like); deterministic negative

CREATE TABLE dart_credit_rating_snapshot (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),                 -- ULID
  corp_code TEXT NOT NULL CHECK (length(corp_code) = 8),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('business_report', 'debt_securities_filing')),
  source_rcept_no TEXT NOT NULL CHECK (length(source_rcept_no) = 14),   -- DART receipt number; first 8 digits = filing date
  parser_version TEXT NOT NULL CHECK (length(parser_version) > 0),
  status TEXT NOT NULL CHECK (status IN
    ('parsed', 'section_present_no_bond_rating', 'not_disclosed', 'section_absent', 'parse_failed', 'not_zip')),
  ratings_json TEXT NOT NULL CHECK (json_valid(ratings_json) = 1),      -- array of rating rows (agency, instrument, grade, outlook, rated_on, raw)
  issues_json TEXT CHECK (issues_json IS NULL OR json_valid(issues_json) = 1),
    -- array of bond-issue rows (issue date, amount in INTEGER KRW millions per ADR-0061, coupon in percent points,
    -- rating raw, maturity, outstanding flag); NULL = the issuance table was not available (never "no issues")
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),     -- the document text hit the fetch character cap
  content_hash TEXT NOT NULL,                                           -- sha256 of ratings_json + issues_json
  fetched_at TEXT NOT NULL,                                             -- ISO 8601
  UNIQUE (source_rcept_no, parser_version)
);
-- Pattern: all snapshots of one company, newest filing first.
CREATE INDEX idx_dart_credit_rating_snapshot_corp ON dart_credit_rating_snapshot(corp_code, source_rcept_no DESC);
CREATE TRIGGER trg_dart_credit_rating_snapshot_immutable BEFORE UPDATE ON dart_credit_rating_snapshot
BEGIN SELECT RAISE(ABORT, 'dart_credit_rating_snapshot rows are immutable (source_rcept_no + parser_version identity)'); END;
