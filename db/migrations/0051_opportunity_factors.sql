-- 0051_opportunity_factors.sql
-- S2 평가 요인 저장 — 기회별 기회/위험 요인을 자동 도출(insight-synthesis) 또는
-- 수동 등록하여 매력도 평가의 근거로 사용한다. Additive-only (ADR-0014).
-- factors_source: 'llm' | 'synthesis' | 'manual(+llm 등 혼합)'
ALTER TABLE opportunity ADD COLUMN factors_json TEXT;
ALTER TABLE opportunity ADD COLUMN factors_source TEXT;
ALTER TABLE opportunity ADD COLUMN factors_at TEXT;
