-- @reversible: true (additive-only — two nullable columns; manual rollback:
-- `ALTER TABLE opportunity DROP COLUMN synergy_score_confirmed_at;
--  ALTER TABLE opportunity DROP COLUMN synergy_score_confirmed_by;` — SQLite
-- supports DROP COLUMN natively since 3.35, or restore from pre-migration
-- backup, ADR-0014.)
-- S3 시너지 점수 사람 확정 (경계 #2) — 시너지 파이프라인이 완료 시 기록하는
-- opportunity.synergy_score는 권고값(ADR-0090)이며, 사람이 검토해 확정하면
-- 누가·언제 확정했는지 기록한다. NULL = 미확정 권고 상태. 재분석이 점수를
-- 다른 값으로 다시 기록하면 확정은 무효화된다(synergy-pipeline).
ALTER TABLE opportunity ADD COLUMN synergy_score_confirmed_at TEXT;
ALTER TABLE opportunity ADD COLUMN synergy_score_confirmed_by TEXT;
