-- @reversible: true (additive-only — one nullable JSON column; manual rollback:
-- `ALTER TABLE opportunity DROP COLUMN capability_gap_json;` — SQLite supports
-- DROP COLUMN natively since 3.35, or restore from pre-migration backup,
-- ADR-0014.)
-- S3 역량 갭 분석 (flow.spec v2.4.0) — 시장 요구사항(S2 스케치 requiredCapabilities·
-- S1 요인에서 도출)을 그룹/계열사 보유 역량(company_profile_version strengths·
-- industryExposure)과 대조한 갭 레지스터. 내부(자사 단독) 역량 평가는 후속 보강
-- 사항이며, 이 레지스터는 그룹/계열사 근거만 기록한다. 해소 어휘(build/partner/
-- hire/invest)는 S5 capability_gaps_json(0056)과 동일 — 승계 가능.
ALTER TABLE opportunity ADD COLUMN capability_gap_json TEXT;
