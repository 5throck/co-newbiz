-- @reversible: true (additive: three nullable columns on permit and on incentive plus one index each; no existing row
-- changes. Manual rollback: the statements in ROLLBACK-SQL below, after a backup per ADR-0014 (SQLite >= 3.35 for DROP
-- COLUMN). Code rollback: revert the PR; the columns are then ignored.)
-- ROLLBACK-SQL-BEGIN
--   DROP INDEX idx_permit_stage_captured;
--   DROP INDEX idx_incentive_stage_captured;
--   ALTER TABLE permit DROP COLUMN captured_at;
--   ALTER TABLE permit DROP COLUMN captured_by;
--   ALTER TABLE permit DROP COLUMN stage_captured;
--   ALTER TABLE incentive DROP COLUMN captured_at;
--   ALTER TABLE incentive DROP COLUMN captured_by;
--   ALTER TABLE incentive DROP COLUMN stage_captured;
-- ROLLBACK-SQL-END
--
-- ADR-0187 D4 (owner, 2026-10-27: option (c) - new rows reusing the S11 schema with stage_captured, linked at S11;
-- captured at S8, S5 optional; finding H11). Pre-IC permit and incentive candidates are ordinary permit / incentive rows
-- (the same tables the S11 execution baseline reads), tagged with the stage that captured them and the person who did.
-- The S11 baseline adopts them by reference (permit_milestones[].permit_id, incentive_obligations[].incentive_id), so
-- nothing is re-entered. Permits and certifications stay separate (non-negotiable boundary 5): certification is not
-- touched here.
--
-- stage_captured NULL = a row recorded before this migration or through the generic register (stage not recorded);
-- such rows are never relabelled. An incentive candidate carries its clawback terms (clawback_rule), enforced by the
-- capture API.

ALTER TABLE permit ADD COLUMN stage_captured TEXT CHECK (stage_captured IS NULL OR stage_captured IN ('S5', 'S8', 'S11'));
ALTER TABLE permit ADD COLUMN captured_by TEXT;
ALTER TABLE permit ADD COLUMN captured_at TEXT;
ALTER TABLE incentive ADD COLUMN stage_captured TEXT CHECK (stage_captured IS NULL OR stage_captured IN ('S5', 'S8', 'S11'));
ALTER TABLE incentive ADD COLUMN captured_by TEXT;
ALTER TABLE incentive ADD COLUMN captured_at TEXT;
CREATE INDEX idx_permit_stage_captured ON permit(project_id, stage_captured);
CREATE INDEX idx_incentive_stage_captured ON incentive(project_id, stage_captured);
