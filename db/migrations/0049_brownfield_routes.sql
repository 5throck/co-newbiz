-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- Brownfield Route 유형 확장 (ADR: Brownfield ≠ M&A — M&A는 Brownfield의
-- 하나의 Route). sub_track을 brownfield 라우트에도 사용하도록 CHECK를
-- 재정의한다: m_and_a | jv | strategic_investment | minority_investment |
-- partnership | rbd | corporate_venture (기존 greenfield 값은 유지).

CREATE TABLE route_decision_new (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  project_id TEXT REFERENCES md_project(id),
  track TEXT NOT NULL CHECK (track IN ('greenfield', 'brownfield')),
  sub_track TEXT CHECK (sub_track IN ('existing_business_rbd', 'intra_venture', 'm_and_a', 'jv', 'strategic_investment', 'minority_investment', 'partnership', 'rbd', 'corporate_venture')),
  rationale TEXT NOT NULL,
  alternatives_considered TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
INSERT INTO route_decision_new SELECT id, opportunity_id, project_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at FROM route_decision;
DROP TABLE route_decision;
ALTER TABLE route_decision_new RENAME TO route_decision;
CREATE INDEX idx_route_decision_opp ON route_decision(opportunity_id);
CREATE INDEX idx_route_decision_proj ON route_decision(project_id);
