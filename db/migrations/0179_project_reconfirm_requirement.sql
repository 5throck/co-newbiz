-- @reversible: true (additive: one new table with its index and guard triggers; no existing column or row changes.
-- Manual rollback: the statements in ROLLBACK-SQL below, after a backup per ADR-0014. Code rollback: revert the PR; with
-- no table the reconfirmation check is skipped. ADR-0186 owner decision O-6.)
-- ROLLBACK-SQL-BEGIN
--   DROP TRIGGER trg_project_reconfirm_closed_immutable;
--   DROP TRIGGER trg_project_reconfirm_no_delete;
--   DROP INDEX uq_project_reconfirm_open;
--   DROP TABLE project_reconfirm_requirement;
-- ROLLBACK-SQL-END
--
-- ADR-0186 O-6. A project recorded under the legacy gate rules (single-user GO ladder, unconfirmed discount rate,
-- unreviewed `na` rows) must be re-confirmed by people before it is used for anything new. This table is the
-- project-specific marker: an administrator opens a requirement naming the items still needed (wacc_confirmed,
-- ic_countersign, na_review); while it is open, a new gate decision and a business-case adoption on that project are
-- refused (409 reconfirmation_required) and viewing, gate-brief generation and IC-package generation carry a warning.
-- The items are DERIVED live from the data for display; the requirement itself is cleared only by a person holding an
-- IC reviewer grant, with an audited reason. Rows are never deleted; a cleared row is immutable. At most one open
-- requirement per project.
CREATE TABLE project_reconfirm_requirement (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  items_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cleared_by TEXT,
  cleared_at TEXT,
  clear_reason TEXT
);
CREATE UNIQUE INDEX uq_project_reconfirm_open ON project_reconfirm_requirement(project_id) WHERE cleared_at IS NULL;
CREATE TRIGGER trg_project_reconfirm_no_delete BEFORE DELETE ON project_reconfirm_requirement
BEGIN
  SELECT RAISE(ABORT, 'project_reconfirm_requirement rows are never deleted (ADR-0186): clear instead');
END;
CREATE TRIGGER trg_project_reconfirm_closed_immutable BEFORE UPDATE ON project_reconfirm_requirement
WHEN OLD.cleared_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.items_json IS NOT OLD.items_json
  OR NEW.reason IS NOT OLD.reason OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'a cleared project_reconfirm_requirement is immutable, and an open one changes only its clear columns (ADR-0186)');
END;
