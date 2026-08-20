-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- Master data catalog — docs/db-schema.md §2.
-- Portability constraints (ADR-0002): TEXT PKs (ULIDs), no AUTOINCREMENT,
-- no implicit ROWID dependence, ISO-8601 TEXT dates, PRAGMA foreign_keys=ON
-- (set at connection time in db/client.ts, not per-migration).

CREATE TABLE md_industry (
  id TEXT PRIMARY KEY,
  ksic_code TEXT NOT NULL,
  naics_code TEXT,
  isic_code TEXT,
  name_ko TEXT NOT NULL,
  name_en TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_md_industry_ksic ON md_industry(ksic_code);

CREATE TABLE md_company (
  id TEXT PRIMARY KEY,
  dart_corp_code TEXT,
  biz_reg_no TEXT,
  lei TEXT,
  name_ko TEXT NOT NULL,
  name_en TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_md_company_dart ON md_company(dart_corp_code) WHERE dart_corp_code IS NOT NULL;

-- dimension is what forces cross-dimension conversions through proxy_link
-- rather than ad hoc math (FR-DATA-03, docs/db-schema.md §2).
CREATE TABLE md_unit (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  dimension TEXT NOT NULL,
  si_coefficient REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE md_currency (
  id TEXT PRIMARY KEY,
  iso_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE md_country (
  id TEXT PRIMARY KEY,
  iso_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE md_period (
  id TEXT PRIMARY KEY,
  period_type TEXT NOT NULL CHECK (period_type IN ('date', 'month', 'quarter', 'year')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_md_period_range ON md_period(start_date, end_date);

CREATE TABLE md_source (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  reliability_grade TEXT NOT NULL CHECK (reliability_grade IN ('A', 'B', 'C')),
  created_at TEXT NOT NULL
);

CREATE TABLE md_statute (
  id TEXT PRIMARY KEY,
  korea_statute_id TEXT,
  foreign_framework_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE md_account (
  id TEXT PRIMARY KEY,
  ifrs_code TEXT NOT NULL UNIQUE,
  name_ko TEXT NOT NULL,
  name_en TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE md_entity (
  id TEXT PRIMARY KEY,
  entity_code TEXT NOT NULL UNIQUE,
  name_ko TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE md_project (
  id TEXT PRIMARY KEY,
  project_no TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- Quarantine for unregistered master-data references (FR-DATA-04) — an
-- ingest failure lands here instead of being silently auto-created.
CREATE TABLE staging_unmapped (
  id TEXT PRIMARY KEY,
  raw_value TEXT NOT NULL,
  attempted_master_table TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);
CREATE INDEX idx_staging_unmapped_table ON staging_unmapped(attempted_master_table);
