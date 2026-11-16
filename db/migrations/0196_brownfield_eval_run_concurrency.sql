-- @reversible: true (removes one partial unique index; rollback recreates it.
-- ROLLBACK-SQL-BEGIN
--   CREATE UNIQUE INDEX ux_bedr_active ON brownfield_eval_draft_run(opportunity_id)
--     WHERE status IN ('running', 'paused_budget', 'interrupted');
-- ROLLBACK-SQL-END
--   Rollback precondition: at most ONE active (running/paused_budget/interrupted) run per
--   opportunity must exist when the index is recreated, else the CREATE fails — finish or
--   cancel the surplus runs first.
--
-- 0196_brownfield_eval_run_concurrency.sql — ADR-0199 follow-up (spec
-- 2026-11-16-s6-bulk-ai-eval-versioning §5): per-candidate parallel evaluation engines.
-- 0194's partial unique index allowed only ONE active run per opportunity, which made
-- starting candidate B impossible while candidate A's engine was running. The concurrency
-- cap (MAX_CONCURRENT_EVAL_ENGINES, bulk-block rule, engine_active reason codes) is
-- enforced in code (lib/brownfield-eval-bulk.ts + the A1 route), not by the schema, so the
-- index is simply dropped; idx_bedr_opp_started already covers the "runs of an opportunity"
-- reads. No table or column changes.

DROP INDEX IF EXISTS ux_bedr_active;
