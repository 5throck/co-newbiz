-- @reversible: true (additive-only — new columns, defaults preserve existing
-- rows unchanged; manual rollback: DROP COLUMN each added column, SQLite
-- supports DROP COLUMN natively since 3.35, or restore from pre-migration
-- backup, ADR-0014.)
-- ADR-0132 — extends ADR-0131's "genuine LLM failure must not silently
-- overwrite prior good data" protection beyond S1 market-sizing to S2
-- opportunity fit screening and S3 synergy analysis.

-- S2 전략적 적합성(fit) 판정 — factors_source와 동일한 출처 추적 컬럼.
-- 기존에는 어떤 판정이 LLM 산출인지 결정론 폴백인지 구분할 방법이 없어
-- 재판정 시 이미 확정된 LLM 판정을 합성 폴백이 조용히 덮어쓸 수 있었다.
ALTER TABLE opportunity ADD COLUMN fit_source TEXT CHECK (fit_source IS NULL OR fit_source IN ('llm', 'synthesis'));

-- S3 시너지 분석 재분석 — market_sizing_analysis의 rerun_in_progress/
-- error_message와 동일한 패턴(0095). 재분석 중에도 이전 완료 버전의
-- status/completed_at을 그대로 유지하고, LLM 장애로 저하된 재분석은
-- 새 버전을 만들지 않는다.
ALTER TABLE synergy_analysis ADD COLUMN rerun_in_progress INTEGER NOT NULL DEFAULT 0 CHECK (rerun_in_progress IN (0, 1));
ALTER TABLE synergy_analysis ADD COLUMN error_message TEXT;
