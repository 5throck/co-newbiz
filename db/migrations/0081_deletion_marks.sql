-- 0081_deletion_marks.sql
-- @reversible: false
-- Deletion = tombstone marks, never row removal (deal-deletion-playbook).
-- Deleting a deal or a master-data row stamps deleted_at/deleted_by/delete_reason;
-- every list/read surface filters the mark, while the full original data stays
-- in place so a later audit can inspect exactly what was there (FR-SEC-07
-- audit + ADR-0056 retire convention). This also dissolves the FK problem:
-- rows persist, so synergy_analysis and company_profile_version references
-- remain valid without any cascade machinery.
--
-- deal_archive is the point-in-time manifest written when a deal is closed,
-- archived, or delete-marked: it records WHO acted, the members at that
-- moment (viewer allowlist), and WHICH market-sizing version the deal relied
-- on (shared, industry-keyed asset that keeps evolving — the manifest pins
-- the version so the archive shows the as-of version, not the latest).
-- Append-only at the DB level, same doctrine as audit_log (FR-SEC-07).

ALTER TABLE md_project ADD COLUMN deleted_at TEXT;
ALTER TABLE md_project ADD COLUMN deleted_by TEXT;
ALTER TABLE md_project ADD COLUMN delete_reason TEXT;

ALTER TABLE opportunity ADD COLUMN deleted_at TEXT;
ALTER TABLE opportunity ADD COLUMN deleted_by TEXT;
ALTER TABLE opportunity ADD COLUMN delete_reason TEXT;

ALTER TABLE company_group ADD COLUMN deleted_at TEXT;
ALTER TABLE company_group ADD COLUMN deleted_by TEXT;
ALTER TABLE company_group ADD COLUMN delete_reason TEXT;

ALTER TABLE company_group_member ADD COLUMN deleted_at TEXT;
ALTER TABLE company_group_member ADD COLUMN deleted_by TEXT;
ALTER TABLE company_group_member ADD COLUMN delete_reason TEXT;

ALTER TABLE synergy_analysis ADD COLUMN deleted_at TEXT;
ALTER TABLE synergy_analysis ADD COLUMN deleted_by TEXT;
ALTER TABLE synergy_analysis ADD COLUMN delete_reason TEXT;

CREATE TABLE deal_archive (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('archived', 'deleted')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'opportunity')),
  project_id TEXT,
  opportunity_id TEXT,
  project_no TEXT,
  project_name TEXT,
  track TEXT,
  status_at_archive TEXT,
  market_freeze_json TEXT,
  member_user_ids_json TEXT NOT NULL DEFAULT '[]',
  mnpi_flag INTEGER NOT NULL DEFAULT 0,
  acted_by TEXT NOT NULL,
  acted_at TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX idx_deal_archive_kind ON deal_archive(kind, acted_at DESC);

CREATE TRIGGER deal_archive_no_update
BEFORE UPDATE ON deal_archive
BEGIN
  SELECT RAISE(ABORT, 'deal_archive is append-only (FR-SEC-07)');
END;

CREATE TRIGGER deal_archive_no_delete
BEFORE DELETE ON deal_archive
BEGIN
  SELECT RAISE(ABORT, 'deal_archive is append-only (FR-SEC-07)');
END;
