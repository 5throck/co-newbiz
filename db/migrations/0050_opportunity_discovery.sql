-- 0050_opportunity_discovery.sql
-- S2 기회 발굴 (opportunity-discovery / business-model-sketch activities):
-- LLM(또는 결정론 폴백)이 생성한 비즈니스 모델 스케치를 기회 카드에 영속한다.
-- Additive-only (ADR-0014). sketch_source: 'llm' | 'synthesis' (provenance).
ALTER TABLE opportunity ADD COLUMN sketch_json TEXT;
ALTER TABLE opportunity ADD COLUMN sketch_source TEXT;
ALTER TABLE opportunity ADD COLUMN sketch_at TEXT;
