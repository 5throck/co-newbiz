-- 0140_establishment_step_assignee_reopen.sql
-- @reversible: true (purely additive — ADD COLUMN x3 + CREATE TABLE +
-- CREATE INDEX x2; no existing column or row semantics change. Manual
-- rollback: the statements below, run statement by statement inside one
-- transaction. The history table is dropped with its rows, so take a
-- backup first if the reopen reasons must be kept. Rollback mechanism of
-- record: pre-migration backup restore (scripts/co-newbiz/restore.ts,
-- ADR-0014). ADR-0165.)
-- ROLLBACK-SQL-BEGIN
--   DROP INDEX idx_ees_assignee;
--   DROP INDEX idx_eese_project;
--   DROP TABLE entity_establishment_step_event;
--   ALTER TABLE entity_establishment_step DROP COLUMN assigned_at;
--   ALTER TABLE entity_establishment_step DROP COLUMN assigned_by;
--   ALTER TABLE entity_establishment_step DROP COLUMN assignee_user_id;
-- ROLLBACK-SQL-END
--
-- S11 establishment steps (ADR-0165): per-step assignee distinct from the last
-- recorder (owner), and an append-only transition history that carries the
-- mandatory reopen reason (audit_log has no detail column).

ALTER TABLE entity_establishment_step ADD COLUMN assignee_user_id TEXT;
-- NULL = unassigned. Membership is validated in the application layer at
-- write time (project_member has a composite PK; a revoked member keeps the
-- value for history and is flagged on read). owner keeps its 0059 meaning in
-- practice: the last human/agent who recorded the row.
ALTER TABLE entity_establishment_step ADD COLUMN assigned_by TEXT;
ALTER TABLE entity_establishment_step ADD COLUMN assigned_at TEXT;

CREATE TABLE entity_establishment_step_event (
  id TEXT PRIMARY KEY NOT NULL,
  step_id TEXT NOT NULL REFERENCES entity_establishment_step(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  step_no INTEGER NOT NULL CHECK (step_no BETWEEN 1 AND 5),
  kind TEXT NOT NULL CHECK (kind IN ('status_change', 'assign', 'reopen')),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('pending','in_progress','done','halted','escalated')),
  to_status TEXT CHECK (to_status IS NULL OR to_status IN ('pending','in_progress','done','halted','escalated')),
  from_assignee TEXT,
  to_assignee TEXT,
  reason TEXT,
  evidence_url TEXT,
  actor_user_id TEXT NOT NULL,
  audit_id TEXT,
  created_at TEXT NOT NULL,
  CHECK (kind <> 'reopen' OR (reason IS NOT NULL AND length(trim(reason)) >= 10)),
  CHECK (kind <> 'reopen' OR (from_status = 'done' AND to_status = 'in_progress'))
);
CREATE INDEX idx_eese_project ON entity_establishment_step_event(project_id, step_no, created_at);
CREATE INDEX idx_ees_assignee ON entity_establishment_step(assignee_user_id);
