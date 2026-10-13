-- 0142_establishment_mode.sql
-- @reversible: true (purely additive — ADD COLUMN x5, CREATE TABLE, CREATE
-- INDEX x2, one evidence_var seed row, one backfill UPDATE; no existing column
-- or row semantics change. Manual rollback: the statements below, run
-- statement by statement inside one transaction. The mode-change history table
-- is dropped with its rows, so take a backup first if the change reasons must
-- be kept. Rollback mechanism of record: pre-migration backup restore
-- (scripts/co-newbiz/restore.ts, ADR-0014). Code rollback: revert the PR; the
-- procedure applies_when predicates that read project.establishment_mode are
-- reverted in the same PR (procedures/_validate.ts rejects unseeded vars).
-- ADR-0167.)
-- ROLLBACK-SQL-BEGIN
--   DROP INDEX idx_eseme_project;
--   DROP INDEX idx_ees_project_mode;
--   DROP TABLE establishment_mode_event;
--   ALTER TABLE entity_establishment_step_event DROP COLUMN mode;
--   ALTER TABLE entity_establishment_step DROP COLUMN mode;
--   ALTER TABLE md_project DROP COLUMN establishment_mode_suggested;
--   ALTER TABLE md_project DROP COLUMN establishment_mode;
--   DELETE FROM evidence_var WHERE var_key = 'project.establishment_mode';
-- ROLLBACK-SQL-END
--
-- Green Field establishment mode (ADR-0167, decided in chat 2026-10-14; formal
-- acceptance pending). A Green Field project may run the new business as a new
-- business unit inside the existing legal entity instead of forming a new
-- entity.
--
--  md_project.establishment_mode            'new_entity' | 'business_unit' |
--      NULL. NULL = not chosen (new Green Field projects must choose it at S10,
--      by a human; there is NO default) or not applicable (origin external,
--      Brown Field). business_unit is allowed only with origin = 'internal'
--      (D2) — enforced here as a CHECK and again in the application layer.
--  md_project.establishment_mode_suggested  non-binding hint (S5 promotion or an
--      agent proposal); never read by any predicate.
--  entity_establishment_step.mode / entity_establishment_step_event.mode
--      which step set a row belongs to. Existing rows default to 'new_entity',
--      so behaviour for every current project is byte-identical. After an
--      audited mode change the rows of the old mode stay as read-only history.
--  establishment_mode_event  append-only history of mode decisions/changes
--      (reason mandatory, >= 10 chars, on a change).
--
-- Backfill (D4): every existing project with origin internal/joint becomes
-- 'new_entity' (the only behaviour that existed until now). Projects with other
-- or NULL origin stay NULL.
--
-- Routing var project.establishment_mode (source_kind 'column') so the two
-- establishment procedures are machine applies_when predicates
-- (db/lib/applies-when.ts). created_at is a fixed literal (ADR-0002).

ALTER TABLE md_project ADD COLUMN establishment_mode TEXT
  CHECK (establishment_mode IS NULL OR establishment_mode IN ('new_entity', 'business_unit'))
  CHECK (establishment_mode IS NULL OR establishment_mode <> 'business_unit' OR origin = 'internal');
ALTER TABLE md_project ADD COLUMN establishment_mode_suggested TEXT
  CHECK (establishment_mode_suggested IS NULL OR establishment_mode_suggested IN ('new_entity', 'business_unit'));

UPDATE md_project SET establishment_mode = 'new_entity' WHERE origin IN ('internal', 'joint');

ALTER TABLE entity_establishment_step ADD COLUMN mode TEXT NOT NULL DEFAULT 'new_entity'
  CHECK (mode IN ('new_entity', 'business_unit'));
ALTER TABLE entity_establishment_step_event ADD COLUMN mode TEXT NOT NULL DEFAULT 'new_entity'
  CHECK (mode IN ('new_entity', 'business_unit'));
CREATE INDEX idx_ees_project_mode ON entity_establishment_step(project_id, mode, step_no);

CREATE TABLE establishment_mode_event (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  kind TEXT NOT NULL CHECK (kind IN ('set', 'change')),
  from_mode TEXT CHECK (from_mode IS NULL OR from_mode IN ('new_entity', 'business_unit')),
  to_mode TEXT NOT NULL CHECK (to_mode IN ('new_entity', 'business_unit')),
  reason TEXT,
  actor_user_id TEXT NOT NULL,
  audit_id TEXT,
  via TEXT NOT NULL DEFAULT 'unknown' CHECK (via IN ('ui', 'api', 'mcp', 'unknown')),
  created_at TEXT NOT NULL,
  CHECK (kind <> 'change' OR (from_mode IS NOT NULL AND from_mode <> to_mode)),
  CHECK (kind <> 'change' OR (reason IS NOT NULL AND length(trim(reason)) >= 10))
);
CREATE INDEX idx_eseme_project ON establishment_mode_event(project_id, created_at);

INSERT INTO evidence_var (var_key, label_ko, value_type, source_kind, requires_evidence_ref, created_at) VALUES
  ('project.establishment_mode', '설립 방식', 'string', 'column', 0, '2026-10-14T00:00:00Z');
