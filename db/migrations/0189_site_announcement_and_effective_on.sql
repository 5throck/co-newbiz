-- @reversible: true (additive: one new table with two indexes, one nullable column on dimension_input, three evidence_var rows;
-- no backfill and no existing row changes. Rollback: the ROLLBACK-SQL block below, run after the pre-migration backup per
-- ADR-0014. Site announcements recorded and effective_on dates stored after this migration are lost on rollback.
-- ALTER TABLE ... DROP COLUMN needs SQLite 3.35 or later (dev engine is 3.54) and fails if the column is indexed; no index
-- is created on effective_on, and nothing else references it.)
-- ROLLBACK-SQL-BEGIN
--   DELETE FROM project_variable_snapshot WHERE var_key IN ('infra.site_announced_on', 'infra.plan_finalized_on', 'infra.plan_finalized_by_announcement');
--   DELETE FROM evidence_var WHERE var_key IN ('infra.site_announced_on', 'infra.plan_finalized_on', 'infra.plan_finalized_by_announcement');
--   DROP TABLE site_announcement;
--   ALTER TABLE dimension_input DROP COLUMN effective_on;
-- ROLLBACK-SQL-END
--
-- ADR-0194 item B (owner decision 2026-11-07, O-B1/O-B2/O-B3; risk-officer amendments B-1, B-2, C-1): kill criterion #5
-- (greenfield-screening:infrastructure_plan_not_finalized_at_site_announcement, re-evaluated at fs) tests the state of the
-- infrastructure plan ON the site-announcement date, not on the gate date (pilot 005 F-1, ADR-0193 C-6). That needs two
-- human-recorded dates, neither of which exists in the schema:
--
--   1. site_announcement: the project-scoped announcement event (announced_on + a closed announcement_kind + the evidence
--      reference of the announcement itself). Append-only with a superseded_by chain (ADR-0005 / FR-DATA-10). C-1: the live
--      unique index is per (project_id, announcement_kind), NOT per project, so several different events (board resolution,
--      then public announcement) coexist as live rows and the filler takes MIN(announced_on) - the first binding commitment is
--      what the criterion tests, and recording a later event must never move the reference date later. Supersession is only
--      for correcting the SAME event (same kind, with evidence); the repository enforces that. recorded_by is the md_user id
--      of the calling human taken from the session (never from the body, never an agent account - Boundary 1).
--   2. dimension_input.effective_on: the date on which the asserted fact became true in the world (for
--      infra.plan_finalized = 'yes', the date of the finalized plan document). It is distinct from observed_at (when the
--      assertion was recorded), which is a rejected proxy (ADR-0193 section 14.3). Nullable ISO date; SQLite cannot add a
--      GLOB CHECK through ADD COLUMN, so the format, the not-in-the-future rule (B-2) and the required-when-yes rule live in
--      the repository (db/repositories/dimension-input.repository.ts).
--
-- Three evidence_var rows register the snapshot vars the filler writes (project_variable_snapshot.var_key is an FK):
--   infra.site_announced_on                string date  computed   MIN(announced_on) over the project's live announcements
--   infra.plan_finalized_on                string date  asserted   dimension_input.effective_on of the live REVIEWED
--                                                                  infra.plan_finalized = 'yes' row
--   infra.plan_finalized_by_announcement   string yes|no computed  derived by the filler (B-1: missing, never 'yes', in every
--                                                                  unassessed case); #5's predicate reads this var only
--
-- No backfill: existing infra.plan_finalized assertions keep effective_on = NULL, so those projects read unassessed until a
-- human records the date; inferring it from observed_at is forbidden. Post hooks: PRAGMA foreign_key_check and the health check.

CREATE TABLE site_announcement (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  site_id TEXT REFERENCES site(id),
  announced_on TEXT NOT NULL CHECK (announced_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  announcement_kind TEXT NOT NULL CHECK (announcement_kind IN ('board_resolution','public_announcement','mou_signing','regulatory_filing')),
  evidence_ref TEXT NOT NULL CHECK (length(trim(evidence_ref)) > 0),
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES site_announcement(id)
);
CREATE UNIQUE INDEX idx_site_announcement_live ON site_announcement(project_id, announcement_kind)
  WHERE superseded_by IS NULL;
CREATE INDEX idx_site_announcement_project ON site_announcement(project_id, recorded_at DESC);

ALTER TABLE dimension_input ADD COLUMN effective_on TEXT;

INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('infra.site_announced_on', '입지 발표일(기록된 발표 중 가장 이른 날짜, ISO 날짜)', 'string', NULL, 'computed', 0, '2026-11-07T00:00:00Z'),
  ('infra.plan_finalized_on', '인프라 계획 확정 유효일(asserted, 확정된 계획 문서의 날짜)', 'string', NULL, 'asserted', 0, '2026-11-07T00:00:00Z'),
  ('infra.plan_finalized_by_announcement', '입지 발표일 이전(당일 포함)에 인프라 계획이 확정되었는지(yes|no, 판단 불가는 결측)', 'string', NULL, 'computed', 0, '2026-11-07T00:00:00Z');
