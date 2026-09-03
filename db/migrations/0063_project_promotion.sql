-- 0063_project_promotion.sql
-- @reversible: true (purely additive — three ALTER TABLE ADD COLUMN on md_project,
-- one on opportunity, two CREATE INDEX; all nullable, no rows touched, no table
-- rebuild. Manual rollback: drop the indexes and columns via a table rebuild of
-- md_project/opportunity, or restore from a pre-migration backup —
-- scripts/co-newbiz/restore.ts.)
--
-- Project promotion foundation (ADR-0095): the bookkeeping transition that turns
-- a reviewed opportunity (S1–S7 carrier, ADR-0094) into a project (S8–S11
-- carrier). opportunity.project_id has existed since 0042 and is reused here,
-- not re-created.
--
-- md_project additions:
--   origin — 0013 classification vocabulary ('internal'/'external'/'hybrid'/'joint').
--     SQLite ALTER TABLE ADD COLUMN cannot carry a CHECK constraint, so this is
--     a plain TEXT column; the enum is enforced at the application layer (the
--     definitive value is classified on project_classification after promotion —
--     the 0013 origin CHECK lives there).
--   source_opportunity_id — forward link to the opportunity this project was
--     promoted from; the 0042 comment "only selected ones are promoted to
--     projects" finally gets its mechanical realization, and
--     entity_establishment_step (0059, opportunity-keyed until Phase 5 backfills
--     project_id) joins to its project through this column.
--   track — greenfield/brownfield snapshot at promotion time. The authoritative
--     route decision lives on the opportunity (0043/0049), but S8–S11 surfaces
--     must not have to re-derive the track on every read.
--
-- opportunity.promoted_at — promotion timestamp (project_id already exists).

ALTER TABLE md_project ADD COLUMN origin TEXT;
ALTER TABLE md_project ADD COLUMN source_opportunity_id TEXT REFERENCES opportunity(id);
ALTER TABLE md_project ADD COLUMN track TEXT;
ALTER TABLE opportunity ADD COLUMN promoted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_md_project_source_opportunity ON md_project(source_opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_promoted ON opportunity(promoted_at);
