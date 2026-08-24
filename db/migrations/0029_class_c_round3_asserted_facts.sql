-- 0029_class_c_round3_asserted_facts.sql
-- @version 1.0.0
-- @reversible: true (pure data migration — 2 INSERTs against seed-only
-- evidence_var; reversal is DELETE by var_key, backup-first per ADR-0014)
--
-- ADR-0065 — kill-criteria extension round 3: two ASSERTED completeness
-- facts (the #17 dimension-input pattern verbatim — no DDL, no computed
-- logic), unblocking entries #18/#25:
--
--   legal.ip_assignment_chain_complete  'complete'|'incomplete'
--     → #18 halts on 'incomplete' at establishment (title integrity is a
--       completeness fact, never a judgment call — ef-07 precedent).
--   infra.plan_finalized                'yes'|'no'
--     → #25 escalates on 'no' at site announcement (pilot-005 F-1).
--
-- Both fill only from LIVE + REVIEWED dimension_input assertions — an
-- unreviewed assertion fills nothing, so both criteria stay UNASSESSED until
-- a second pair of eyes signs the fact (Family C contract).

INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('legal.ip_assignment_chain_complete', 'IP 양수도 체인 완결 여부(asserted)', 'string', NULL, 'asserted', 0, '2026-08-24T00:00:00Z'),
  ('infra.plan_finalized', '인프라 계획 확정 여부(asserted)', 'string', NULL, 'asserted', 0, '2026-08-24T00:00:00Z');
