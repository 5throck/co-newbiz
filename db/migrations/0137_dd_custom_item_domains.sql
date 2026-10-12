-- 0137_dd_custom_item_domains.sql
-- @reversible: true (table rebuild that only WIDENS one CHECK constraint;
-- every row, column, index and FK is copied verbatim, zero data change.
-- Manual rollback = the reverse rebuild below, legal only while no row uses
-- one of the four new domains (the guard aborts otherwise; such rows are
-- human-reviewed records and are never deleted to make a rollback pass).
-- Rollback mechanism of record: pre-migration backup restore
-- (scripts/co-newbiz/restore.ts, ADR-0014). Code rollback: revert the PR.)
--
-- Run the rollback statement by statement with a stop-on-error runner (e.g.
-- `sqlite3 -bail`), inside one transaction: bun:sqlite's multi-statement
-- Database.run() does not surface a constraint failure raised by a non-final
-- statement, so the guard below only aborts when each statement is checked.
-- ROLLBACK-SQL-BEGIN
--   CREATE TEMP TABLE _pcic_rollback_assert (ok INTEGER NOT NULL CHECK (ok = 1));
--   INSERT INTO _pcic_rollback_assert SELECT CASE WHEN (SELECT COUNT(*) FROM project_checklist_item_custom WHERE domain NOT IN ('commercial', 'technical', 'legal')) = 0 THEN 1 ELSE 0 END;
--   DROP TABLE _pcic_rollback_assert;
--   CREATE TABLE project_checklist_item_custom_old (
--     id TEXT PRIMARY KEY NOT NULL,
--     project_id TEXT NOT NULL REFERENCES md_project(id),
--     domain TEXT NOT NULL CHECK (domain IN ('commercial', 'technical', 'legal')),
--     item_label TEXT NOT NULL,
--     rationale TEXT,
--     source_url TEXT,
--     source_reliability TEXT CHECK (source_reliability IS NULL OR source_reliability IN ('A', 'B', 'C')),
--     proposed_by_agent TEXT,
--     status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
--     approved_by TEXT,
--     approved_at TEXT,
--     created_at TEXT NOT NULL,
--     target_id TEXT REFERENCES brownfield_target(id)
--   );
--   INSERT INTO project_checklist_item_custom_old SELECT id, project_id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, approved_by, approved_at, created_at, target_id FROM project_checklist_item_custom;
--   DROP TABLE project_checklist_item_custom;
--   ALTER TABLE project_checklist_item_custom_old RENAME TO project_checklist_item_custom;
--   CREATE INDEX idx_pcic_project ON project_checklist_item_custom(project_id, domain, status);
-- ROLLBACK-SQL-END
--
-- ADR-0160 addendum (b) item 6 / ADR-0148: the S9 workspace has seven DD
-- domains, but project_checklist_item_custom.domain (0069) was CHECK-limited
-- to commercial/technical/legal, so tailored or human-proposed custom items
-- could not exist on financial/hr/market/financing. SQLite cannot ALTER a
-- CHECK, so the table is rebuilt (0033/0132 pattern: create _new, copy, row-
-- count assert, drop, rename, recreate indexes) inside this migration's
-- transaction. Column set and order are unchanged (target_id from 0132 kept
-- last). No table references project_checklist_item_custom and it has no
-- triggers; its only secondary index is idx_pcic_project.
--
-- Additive-only semantics: no existing row is changed or removed; the four new
-- domains are only newly ALLOWED. Projects created before 2026-10-01 stay
-- read-only on the four new domains at the application layer
-- (dd_domain_read_only 409, app/web-next/lib/dd-checklist-tailor.ts).

CREATE TABLE project_checklist_item_custom_new (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  domain TEXT NOT NULL CHECK (domain IN ('commercial', 'technical', 'legal', 'financial', 'hr', 'market', 'financing')),
  item_label TEXT NOT NULL,
  rationale TEXT,
  source_url TEXT,
  source_reliability TEXT CHECK (source_reliability IS NULL OR source_reliability IN ('A', 'B', 'C')),
  proposed_by_agent TEXT,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  target_id TEXT REFERENCES brownfield_target(id)
);

INSERT INTO project_checklist_item_custom_new
  (id, project_id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, approved_by, approved_at, created_at, target_id)
  SELECT id, project_id, domain, item_label, rationale, source_url, source_reliability, proposed_by_agent, status, approved_by, approved_at, created_at, target_id
  FROM project_checklist_item_custom;

-- Row-count assertion: aborts the whole migration transaction unless equal.
CREATE TEMP TABLE _pcic_rebuild_assert (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _pcic_rebuild_assert
  SELECT CASE WHEN (SELECT COUNT(*) FROM project_checklist_item_custom) = (SELECT COUNT(*) FROM project_checklist_item_custom_new) THEN 1 ELSE 0 END;
DROP TABLE _pcic_rebuild_assert;

DROP TABLE project_checklist_item_custom;
ALTER TABLE project_checklist_item_custom_new RENAME TO project_checklist_item_custom;

CREATE INDEX idx_pcic_project ON project_checklist_item_custom(project_id, domain, status);
