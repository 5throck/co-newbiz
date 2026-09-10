-- 0082_business_target_standard.sql
-- 사업목표 기준 마스터데이터 (그룹/계열사 2단계) — fs 게이트 판정기준 입력.
--   md_business_target : 그룹 공통(member_id NULL) 또는 계열사 전용 기준 행.
--     지표별 1건만 활성(unique partial index, deleted_at IS NULL)이며,
--     계열사 전용 행이 그룹 공통 행보다 우선 적용된다(해석은 lib/business-targets.ts).
--   metric_key 프리셋(revenue|operating_margin|period|npv|irr)은 앱 계층에서
--     검증한다 — 프리셋 확장 시 마이그레이션 없이 custom 행으로 운영 가능.
--   금액 단위 컨벤션(ADR-0061): target_value의 매출/NPV는 KRW 백만 INTEGER.
--   삭제 = 툼스톤(0081 컨벤션) — 행은 남기고 deleted_at/deleted_by/delete_reason 기록.
-- Additive-only (ADR-0014). 배경: ADR-0114.
CREATE TABLE md_business_target (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES company_group(id),
  member_id TEXT REFERENCES company_group_member(id),
  metric_key TEXT NOT NULL,
  label TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('gte', 'lte')),
  target_value REAL NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  delete_reason TEXT
);
CREATE INDEX idx_bt_scope ON md_business_target(group_id, member_id, metric_key);
CREATE UNIQUE INDEX idx_bt_scope_metric_active ON md_business_target(
  group_id, COALESCE(member_id, ''), metric_key, COALESCE(label, '')
) WHERE deleted_at IS NULL;
