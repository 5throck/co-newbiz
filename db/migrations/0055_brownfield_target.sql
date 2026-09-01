-- 0055_brownfield_target.sql
-- S6 대상 후보 발굴 → S7 대상 스크리닝 (flow.spec v2.0.0 브라운필드 경로).
--   기회(opportunity) 단위 Target Universe 정의 + Long List 후보 + 체크리스트
--   기반 스크리닝 판정(screening_json) + Short List 승격/제외 상태.
-- project_company(role: candidate/target)는 딜(project) 단위로 유지하고,
-- 기회 단계(project 미생성)까지 커버하기 위해 opportunity_id 기준 테이블을 둔다.
-- Additive-only (ADR-0014).
CREATE TABLE brownfield_target (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  company_name TEXT NOT NULL,
  dart_corp_code TEXT,
  universe_note TEXT,          -- 후보별 Universe 근거·선정 사유 (S6)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'shortlisted', 'excluded')),
  rank INTEGER,                -- Short List 순위 (승격 시)
  exclusion_reason TEXT,       -- 제외 사유 (S7 Exclusion Reasons)
  screening_json TEXT,         -- chk-target-screening 판정 (t-01..t-09)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_bf_target_opp ON brownfield_target(opportunity_id, status);
