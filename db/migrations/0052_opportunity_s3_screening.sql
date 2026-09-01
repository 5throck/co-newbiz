-- 0052_opportunity_s3_screening.sql
-- S3 시너지·전략적 적합성 — 기회별 산출물 영속.
--   synergy_rationale : 시너지 평가 근거 (requiredArtifacts "시너지 평가")
--   fit_verdict       : 전략적 적합성 권고 (Go/Hold/Kill — requiredArtifacts "전략적 적합성 판단")
--   fit_rationale     : 적합성 판단 근거
-- Additive-only (ADR-0014).
ALTER TABLE opportunity ADD COLUMN synergy_rationale TEXT;
ALTER TABLE opportunity ADD COLUMN fit_verdict TEXT CHECK (fit_verdict IN ('Go', 'Hold', 'Kill'));
ALTER TABLE opportunity ADD COLUMN fit_rationale TEXT;
