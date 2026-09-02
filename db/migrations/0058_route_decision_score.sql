-- 0058_route_decision_score.sql — S4 구조화 채점 (ADR-0084).
-- 2026-08-24 Class-C 결정 (d) / ADR-0052 open (d) 해소안: Stage 1 의도 분기 +
-- Stage 2 5criteria × 20% × 1–3점 채점을 route_decision에 구조적으로 기록한다.
-- flow.spec v2.0.0 S4 completionCriteria("Brownfield인 경우 5criteria 채점 결과와
-- 사전배제 점검이 기록되었다")의 데이터 근거가 된다. Additive-only (ADR-0014).

CREATE TABLE route_decision_score (
  id TEXT PRIMARY KEY NOT NULL,
  decision_id TEXT NOT NULL REFERENCES route_decision(id),
  intent TEXT NOT NULL CHECK (intent IN ('integration', 'capability_access')),
  criterion TEXT NOT NULL CHECK (criterion IN ('control_need', 'capability_criticality', 'market_uncertainty', 'integration_capacity', 'speed_to_capability')),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 3),
  evidence_note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_rds_decision ON route_decision_score(decision_id);

ALTER TABLE route_decision ADD COLUMN intent TEXT CHECK (intent IN ('integration', 'capability_access'));
ALTER TABLE route_decision ADD COLUMN override_flagged INTEGER NOT NULL DEFAULT 0; -- 사전배제(lexicographic) 규칙 발동 기록
ALTER TABLE route_decision ADD COLUMN staging_recommended TEXT;                    -- step-up(call option/ROFR) 권고 메모
ALTER TABLE route_decision ADD COLUMN total_score REAL;                            -- 서버 합산(각 기준 20%, 만점 3.0)
