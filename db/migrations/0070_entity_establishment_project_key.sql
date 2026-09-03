-- 0070_entity_establishment_project_key.sql
-- @reversible: true (purely additive — one ALTER TABLE ADD COLUMN, one
-- backfill UPDATE, one CREATE INDEX; no table rebuild, no existing column or
-- row semantics change. Manual rollback: drop the index and the column via a
-- table rebuild of entity_establishment_step, or restore from a
-- pre-migration backup — scripts/co-newbiz/restore.ts. ADR-0014.)
--
-- S10 project-keyed establishment steps (ADR-0100 §1). entity_establishment_step
-- (0059, ADR-0085) was keyed opportunity_id only; ADR-0095's Consequences
-- explicitly deferred the project key to this phase. project_id is the
-- promoted-project projection of the SAME rows — the opportunity remains the
-- origin of record (opportunity_id stays NOT NULL), so the opportunity
-- establishment view and the project establishment view read one ledger.
--
-- Backfill: promoted opportunities carry md_project.id in
-- opportunity.project_id (0042 column, used by the promotion foundation
-- 0063), so every step row written through the opportunity route before this
-- migration is recoverable by join. Rows that cannot be joined (unpromoted
-- opportunity, or an opportunity without a project) keep project_id NULL and
-- remain reachable through the source_opportunity_id backlink fallback.
--
-- The CHECK-constraint note from 0063 applies: ALTER TABLE ADD COLUMN cannot
-- carry a CHECK, so no FK/CHECK is declared here beyond the REFERENCES;
-- referential behavior is exercised by the application layer.

ALTER TABLE entity_establishment_step ADD COLUMN project_id TEXT REFERENCES md_project(id);

UPDATE entity_establishment_step
  SET project_id = (SELECT project_id FROM opportunity WHERE id = opportunity_id)
  WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ees_project ON entity_establishment_step(project_id, step_no);
