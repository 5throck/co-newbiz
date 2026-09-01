-- 0056_greenfield_assessment.sql
-- S5 역량 평가·진출전략 (flow.spec v2.0.0 그린필드 경로, greenfield 전용).
--   capability_gaps_json  : 필요 역량 대비 보유 역량 격차 목록
--   {capability, required_level, current_level, gap, resolution(build/partner/hire/invest), note}
--   entry_strategy        : Build/Partner/Hire/Invest 결정 + 검토 대안
--   business_case_lines   : Business Case 라인(비용·수익) — S8 사업성 분석의 입력
-- Additive-only (ADR-0014).
CREATE TABLE greenfield_assessment (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  capability_gaps_json TEXT,
  entry_strategy TEXT,
  alternatives_considered TEXT,
  business_case_lines_json TEXT,
  rationale TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_gf_assess_opp ON greenfield_assessment(opportunity_id);
