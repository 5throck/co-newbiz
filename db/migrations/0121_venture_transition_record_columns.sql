-- 0121_venture_transition_record_columns.sql
-- @reversible: true (purely additive — three nullable columns on an existing
-- table, no table rebuild, no existing rows touched. Manual rollback:
-- ALTER TABLE venture_transition_decision DROP COLUMN tranche_condition;
-- DROP COLUMN core_handoff; DROP COLUMN divest_plan (SQLite >=3.35), or
-- restore from a pre-migration backup — scripts/co-newbiz/restore.ts —
-- ADR-0014.)
--
-- ADR-0151 — dedicated transition-record columns for the ADR-0150 S12
-- criteria 3-5 on the ADR-0101 ledger (0071). Each row uses AT MOST ONE of
-- the three columns:
--   tranche_condition — criterion 3 (next_tranche_released / held_evidence_incomplete)
--   core_handoff      — criterion 4 (graduate_to_core)
--   divest_plan       — criterion 5 (reduce_or_divest)
-- The kill path (criterion 6, learning_capture) already exists on 0071 and is
-- unchanged. Option B (a single decision_record JSON column) was rejected —
-- audit-ledger records must be queryable and DB-enforceable.
--
-- NOTE: ADR-0151 / the batch design named this file 0080 ("next after 0079"),
-- but 0080..0120 were taken by intervening migrations; this carries the next
-- free number per the runner's filename-order convention. Migration date for
-- the grandfathering rule is 2026-10-02 (the ADR acceptance date), unchanged.
--
-- NO migration-level CHECK constraints: the transition-conditional
-- requirement (e.g. decision IN ('next_tranche_released',
-- 'held_evidence_incomplete') => tranche_condition non-empty) is not
-- expressible in SQLite CHECK DDL — enforcement lives in the route
-- (POST /api/projects/[id]/transition-decision) + the S12 predicate
-- (PROJECT_STAGE_COMPLETION.S12 in app/web-next/lib/process-flow.ts),
-- mirroring how learning_capture is route-required for kills today. NO
-- backfill: historical rationale-only rows stay as-is and are grandfathered
-- by decided_at < 2026-10-02 (predicate rule).

ALTER TABLE venture_transition_decision ADD COLUMN tranche_condition TEXT;
ALTER TABLE venture_transition_decision ADD COLUMN core_handoff TEXT;
ALTER TABLE venture_transition_decision ADD COLUMN divest_plan TEXT;
