-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- ADR-0127 — 비즈니스 모델 검토(구: 비즈니스 모델 스케치) 버전 이력. opportunity
-- 행의 sketch_json은 덮어쓰기 되므로 "이전에 검토한 내용"이 사라졌다. 이 테이블은
-- 생성/재생성 때마다 append-only로 버전을 쌓아 과거 검토를 다시 볼 수 있게 한다.

CREATE TABLE opportunity_sketch_version (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  version_no INTEGER NOT NULL,
  sketch_json TEXT NOT NULL,
  source TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (opportunity_id, version_no)
);
CREATE INDEX idx_opp_sketch_version ON opportunity_sketch_version(opportunity_id, version_no DESC);
