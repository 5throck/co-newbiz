-- 0066_orchestration_linkage_and_dissent.sql
-- @reversible: true (purely additive — one ALTER TABLE ADD COLUMN on
-- gate_evaluation and one each on gate_decision / route_decision /
-- brownfield_target; all nullable, no rows touched, no table rebuild. Manual
-- rollback: drop the columns via table rebuilds, or restore from a
-- pre-migration backup — scripts/co-newbiz/restore.ts.)
--
-- Orchestration engine generalization, step 3/3 (ADR-0096 §3/§6):
--   gate_evaluation.dissent_json — veto-dissent positions preserved VERBATIM
--     (the summarizing/compressing of a veto dissent is a defect, not a style
--     choice); enforced in the synthesis code path, not left to the chair
--     model's discretion.
--   gate_decision / route_decision / brownfield_target .gate_evaluation_id —
--     nullable provenance FKs so a recorded proposal references the
--     deliberation that produced it (a human can click from a decision back to
--     the committee transcript). SQLite ALTER TABLE ADD COLUMN carries FK
--     references fine (0063/0049 precedent), so these are plain additive
--     columns — no rebuild. gate_decision's current columns are exactly the
--     0062 body, confirming additive-only.

ALTER TABLE gate_evaluation ADD COLUMN dissent_json TEXT;
ALTER TABLE gate_decision ADD COLUMN gate_evaluation_id TEXT REFERENCES gate_evaluation(id);
ALTER TABLE route_decision ADD COLUMN gate_evaluation_id TEXT REFERENCES gate_evaluation(id);
ALTER TABLE brownfield_target ADD COLUMN gate_evaluation_id TEXT REFERENCES gate_evaluation(id);
