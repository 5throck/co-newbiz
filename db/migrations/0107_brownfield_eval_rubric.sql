-- @reversible: true (ADD COLUMN — rollback은 pre-migration backup 복원,
-- scripts/co-newbiz/restore.ts)
-- S7 재무 평가 자동 초안(ADR-0140): 재무 빌트인 평가 항목에 결정론적 판정
-- 루브릭(임계값) JSON을 단다. NULL이면 코드 기본값을 쓴다. 루브릭은 "초안
-- 제안" 계산에만 쓰이고 판정 저장은 항상 사람이 확정한다(ADR-0139 경계 유지).
ALTER TABLE brownfield_eval_criterion ADD COLUMN rubric_json TEXT;
