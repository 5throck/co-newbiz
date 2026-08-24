-- 0027_class_c_evidence_extension_2.sql
-- @version 1.0.0
-- @reversible: true (pure data migration — 6 INSERTs against seed-only
-- evidence_var; reversal is DELETE by var_key, backup-first per ADR-0014)
--
-- ADR-0064 — kill-criteria extension round 2: six computed/asserted vars over
-- EXISTING tables (no DDL), unblocking entries #5/#6/#7/#8/#9/#10/#17/#19.
-- Threshold halves are decided by the criteria' own wording (ADR-0060 rows)
-- with anchors gd-0024-class-c-decisions where a Class C decision supplies
-- the discipline, else the ADR-0060 wording itself.

INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('fin.wacc_source_status', 'WACC/할출 기준 출처 상태(sourced|assumed)', 'string', NULL, 'computed', 0, '2026-08-24T00:00:00Z'),
  ('cert.load_bearing_unconfirmed', 'COC 시 이전 불확인 부담 인증 수', 'number', 'count', 'computed', 0, '2026-08-24T00:00:00Z'),
  ('cert.transferability_inferred_count', '추론으로 분류된 이전가능성 행 수', 'number', 'count', 'computed', 0, '2026-08-24T00:00:00Z'),
  ('validators.applicable_missing', '미충족 적용 검증자 수(6대 완결성)', 'number', 'count', 'computed', 0, '2026-08-24T00:00:00Z'),
  ('legal.employment_transfer_consent_regime_determined', '고용승계 동의 레짐 확정 여부(asserted)', 'string', NULL, 'asserted', 0, '2026-08-24T00:00:00Z'),
  ('classification.origin_live_missing', '라이브 origin 분류 부재 수', 'number', 'count', 'computed', 0, '2026-08-24T00:00:00Z');
