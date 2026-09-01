-- 0053_synergy_source_ref.sql
-- S3 회사 등록 출처 추적 — 비상장 회사의 신용평가자료 파일명·외부 검색 사용 기록.
-- Additive-only (ADR-0014).
ALTER TABLE synergy_analysis ADD COLUMN source_ref TEXT;
