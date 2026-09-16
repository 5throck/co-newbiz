-- @reversible: true (ADD COLUMN — rollback은 pre-migration backup 복원,
-- scripts/co-newbiz/restore.ts)
-- S7 사전 검토(chk-target-screening) 위원회 추천 검토(2026-09-16)에서 수집한
-- 항목별 판정 근거(사유·출처·근거 구분)를 후보별로 보존한다. screening_json이
-- "항목 → 확정 판정"만 담는 것과 달리, 이 컬럼은 LLM 제안 단계의 근거(사유,
-- 출처 URL, 기확보/웹검색 구분)를 담는다 — 사람이 저장으로 확정해도 근거는
-- 남아 후보 상세 화면에서 나중에 참고할 수 있다(사용자 결정, 2026-09-16).
-- NULL = 수집된 근거가 아직 없음.
ALTER TABLE brownfield_target ADD COLUMN screening_evidence_json TEXT;
