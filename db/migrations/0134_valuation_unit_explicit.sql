-- 0134_valuation_unit_explicit.sql
-- @reversible: true (additive columns + backfill; rollback:
-- ALTER TABLE business_case_line DROP COLUMN unit;
-- ALTER TABLE valuation_simulation DROP COLUMN unit)
--
-- 금액 단위 계약의 명시적 저장 (사용자 요청, 2026-10-10). 시스템 전체 금액
-- 단위 SSOT — 이 마이그레이션은 아래 계약을 스키마에 새겨 넣는다:
--   fact_financial.value                     — 원 (KRW, DART 원문 그대로)
--   deriveFinancialAnalysis series 값        — 억원 (item unit "KRW" → /1e8 정규화)
--   opportunity.market_size_krw_m            — 백만 원 (KRW-M)
--   business_case_line.annual_amount_krw_m   — 백만 원 (KRW-M)
--   valuation_simulation.npv_krw_m           — 백만 원 (KRW-M)
-- 컬럼명 접미사 _krw_m가 유일한 계약이었으나, 2026-10-10 매출 앵커 구현 중
-- 억원→KRW-M 환산 오류(단위 혼동 결함)가 실제로 발생했다 — 접미사 관행만으로는
-- 결함을 막지 못한다. 이후 모든 금액 행은 unit 컬럼에 단위를 명시하고,
-- tests/unit/business-case-revenue-anchor.test.ts의 단위 사슬 점검이
-- 원(DART)→억원(분석)→KRW-M(라인·시뮬레이션) 전체 경로의 일관성을
-- 회귀 테스트로 지킨다. 기존 행은 전부 KRW-M 계약 아래 작성되었으므로
-- 백필한다.

ALTER TABLE business_case_line ADD COLUMN unit TEXT;
ALTER TABLE valuation_simulation ADD COLUMN unit TEXT;
UPDATE business_case_line SET unit = 'KRW_M' WHERE unit IS NULL;
UPDATE valuation_simulation SET unit = 'KRW_M' WHERE unit IS NULL;
