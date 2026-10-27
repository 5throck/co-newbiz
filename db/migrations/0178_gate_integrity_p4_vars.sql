-- @reversible: true (pure data migration - two INSERTs against the seed-only evidence_var; no DDL, no existing row
-- changes. Manual rollback: the statements in ROLLBACK-SQL below, after deleting any project_variable_snapshot rows
-- for the two vars; backup-first per ADR-0014. Code rollback: set CO_NEWBIZ_GATE_INTEGRITY_WACC=off and disable the two
-- registry entries. ADR-0186 D3 / D8, design section 8 P4.)
-- ROLLBACK-SQL-BEGIN
--   DELETE FROM project_variable_snapshot WHERE var_key IN ('fin.dd_value_impact_unbridged', 'fin.targets_meeting_hurdle');
--   DELETE FROM evidence_var WHERE var_key IN ('fin.dd_value_impact_unbridged', 'fin.targets_meeting_hurdle');
-- ROLLBACK-SQL-END
--
-- Two computed snapshot vars over EXISTING tables that activate the previously inert kill criteria
-- greenfield-dd `dd_finding_with_value_impact_not_in_valuation_bridge` and brownfield-fs-comparative
-- `no_target_meets_base_scenario_hurdle` (the predicates live in procedures/_kill-criteria/*.json).
INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('fin.dd_value_impact_unbridged', '키가 있으나 채택 사례에 반영되지 않은 DD 가치영향 발견 수', 'number', 'count', 'computed', 0, '2026-10-27T00:00:00Z'),
  ('fin.targets_meeting_hurdle', '확정 허들 IRR에 도달하는 Short List 대상 수(기본 시나리오 점추정 IRR)', 'number', 'count', 'computed', 0, '2026-10-27T00:00:00Z');
