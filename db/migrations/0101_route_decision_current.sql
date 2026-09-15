-- @reversible: true (additive-only columns + one partial unique index; manual
--  rollback: `DROP INDEX idx_route_decision_current;`
--            `ALTER TABLE route_decision DROP COLUMN superseded_by;`
--            `ALTER TABLE route_decision DROP COLUMN is_current;`
--  — SQLite supports DROP COLUMN natively since 3.35, ADR-0014.)
-- ADR-0135 — 진출방식(트랙) 재결정의 권위 행을 스키마로 못박는다.
--
-- 0043/0088까지 route_decision에는 "지금 유효한 결정"을 나타내는 컬럼이 없었다.
-- status는 draft|final뿐이고 기회당 1건으로 강제되는 것은 draft뿐이라,
-- Greenfield→Brownfield 재결정처럼 트랙이 바뀌면 final 행이 계속 쌓인다.
-- 어느 행이 권위인지는 각 호출부의 `ORDER BY decided_at DESC, id DESC LIMIT 1`
-- 관행에 의존했고(project-charter.ts 등), 그 관행을 따르지 않는 질의는
-- 조용히 낡은 결정을 읽을 수 있었다.
--
-- 이 프로젝트의 기존 supersession 패턴(project_industry / project_policy_pin /
-- dimension_input — 0021/0033)과 동일하게 self-FK superseded_by + 부분 유니크
-- 인덱스를 쓰되, 판정을 읽기 쉽게 하기 위해 명시적 is_current 플래그를 둔다.
-- 이전 결정은 삭제되지 않고 superseded(이력 보존) — 결정 이력 탭은 그대로 모든
-- final 행을 보여주고, 게이트/스테이지 로직만 is_current=1 행을 권위로 읽는다.
--
-- ALTER TABLE ADD COLUMN ... REFERENCES는 SQLite에서 기본값 NULL일 때만
-- 허용되므로 superseded_by는 nullable이다(설계상으로도 현재 행은 NULL).
ALTER TABLE route_decision ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1));
ALTER TABLE route_decision ADD COLUMN superseded_by TEXT REFERENCES route_decision(id);

-- 백필 ①: 기회별 최신 final 1건이 현재 결정이다(기존 호출부의 사실상 규칙과
-- 동일한 정렬: decided_at DESC, id DESC — ULID라 동시각에도 결정적이다).
UPDATE route_decision SET is_current = 1
WHERE status = 'final'
  AND id = (
    SELECT r.id FROM route_decision r
    WHERE r.opportunity_id = route_decision.opportunity_id AND r.status = 'final'
    ORDER BY r.decided_at DESC, r.id DESC LIMIT 1
  );

-- 백필 ②: 나머지 final 행은 "바로 다음으로 새로운 final"에 의해 대체된 것으로
-- 기록한다(체인 보존 — 전부 최신 행 하나를 가리키게 뭉개지 않는다).
UPDATE route_decision SET superseded_by = (
  SELECT r.id FROM route_decision r
  WHERE r.opportunity_id = route_decision.opportunity_id
    AND r.status = 'final'
    AND (r.decided_at > route_decision.decided_at
         OR (r.decided_at = route_decision.decided_at AND r.id > route_decision.id))
  ORDER BY r.decided_at ASC, r.id ASC LIMIT 1
)
WHERE status = 'final' AND is_current = 0;

-- 기회당 현재 결정은 정확히 1건까지 — draft는 is_current=0이므로 이 인덱스에
-- 걸리지 않고, 0088의 draft 유니크 인덱스와 서로 간섭하지 않는다.
CREATE UNIQUE INDEX idx_route_decision_current ON route_decision(opportunity_id) WHERE is_current = 1;
