-- 0073_retire_dead_screening_tables.sql
-- @reversible: false
-- Retire the pre-v2 screening surfaces that have had no live writers since
-- the ADR-0094/0095 rebuild:
--   * project_company          (0048) — superseded by brownfield_target (0055)
--   * screening_longlist       (0055) — superseded by brownfield_target
--       screening/checklist judgments
-- (route_decision.decision_factors_json from 0043 was already removed by the
-- 0049 table rebuild, which omitted it from route_decision_new — nothing to
-- do for it here.)
-- The only reader of screening_longlist (db/lib/snapshot-filler.ts
-- fillViableTargetsVar) was repointed to brownfield_target in the same
-- change. Dropping is safe: both tables are permanently empty on every
-- database created after migration 0055, and legacy rows carry no lifecycle
-- meaning (S6/S7 live entirely in brownfield_target).

DROP TABLE IF EXISTS screening_longlist;
DROP TABLE IF EXISTS project_company;
