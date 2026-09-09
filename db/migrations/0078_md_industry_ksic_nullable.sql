-- @notransaction (PRAGMA foreign_keys cannot run inside a transaction, and the
-- table rebuild below must DROP the parent table while child FKs
-- (market_sizing_analysis.industry_id, proxy_chain, opportunity, dd_finding,
-- ...) reference it.)
-- @reversible: true (table rebuild carries no data loss — all columns and rows
-- are reproduced verbatim; the only data change is ksic_code values matching
-- GLOB 'NEW-*' becoming NULL. Manual rollback: restore from the pre-migration
-- backup — scripts/co-newbiz/restore.ts, ADR-0014 — or rebuild with
-- ksic_code TEXT NOT NULL, refilling 'NEW-'||substr(id,-6) for NULL rows the
-- app created; the seeded HYD-BRK anchor must be kept verbatim.)
-- Makes md_industry.ksic_code nullable (ADR-0111) so an industry analysis
-- created without a KSIC code stores NULL ("미지정", rendered as "—")
-- instead of a fabricated 'NEW-<ulid-last-6>' placeholder that the /market
-- list then shows as if it were a real code. Existing NEW-* placeholder
-- values are nulled in the same pass; the HYD-BRK freeze sentinel is
-- untouched (insights bottom-up CAGR supplement and the /market frozen
-- banner depend on it). The UNIQUE index is recreated — SQLite unique
-- indexes treat NULLs as distinct, so any number of unspecified industries
-- may coexist.

PRAGMA foreign_keys = OFF;

CREATE TABLE md_industry_new (
  id TEXT PRIMARY KEY NOT NULL,
  ksic_code TEXT,
  naics_code TEXT,
  isic_code TEXT,
  name_ko TEXT NOT NULL,
  name_en TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO md_industry_new (id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at)
  SELECT id, ksic_code, naics_code, isic_code, name_ko, name_en, created_at FROM md_industry;
DROP TABLE md_industry;
ALTER TABLE md_industry_new RENAME TO md_industry;
UPDATE md_industry SET ksic_code = NULL WHERE ksic_code GLOB 'NEW-*';
CREATE UNIQUE INDEX idx_md_industry_ksic ON md_industry(ksic_code);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
