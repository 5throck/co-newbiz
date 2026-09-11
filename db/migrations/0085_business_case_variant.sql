-- 0085: business_case_model.variant — ADR-0117 dual-perspective valuation.
-- Each S8 scenario case now exists in two variants computed from the same
-- seeded engine:
--   market_forward (default) — 시장 성장률 + 미래 변동성 프로파일. The FIRST
--     variant for gate/kill-criteria/RECOMMENDED judgment (backward
--     compatible: every pre-0085 row is a market_forward case).
--   historical — 대상 회사 과거 CAGR + 과거 매출 변동성 ("과거가 지속되면"
--     comparison evidence). Generated only when company facts exist.
-- @reversible: true (additive column with constant default)
ALTER TABLE business_case_model ADD COLUMN variant TEXT NOT NULL DEFAULT 'market_forward'
  CHECK (variant IN ('market_forward', 'historical'));
