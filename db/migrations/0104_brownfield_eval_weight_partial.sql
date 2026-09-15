-- @reversible: true (table-rebuild for CHECK change — SQLite can't ALTER a CHECK
-- constraint, 0049/0102 방식(테이블 재생성)을 따른다; rollback은 pre-migration
-- backup 복원, scripts/co-newbiz/restore.ts)
-- S7 재무·기술 평가(ADR-0139)에 가중치·부분충족을 추가한다(사용자 요청,
-- 2026-09-15): 항목별 weight(기본 10, 상대 가중치)를 카탈로그에 붙이고,
-- 판정 상태에 'partial'(부분충족)을 추가해 met/partial/unmet 3단계 + 예외
-- (na/waived, 점수 계산에서 제외)로 100점 만점 가중 점수를 낼 수 있게 한다.
ALTER TABLE brownfield_eval_criterion ADD COLUMN weight INTEGER NOT NULL DEFAULT 10;

CREATE TABLE brownfield_target_eval_state_new (
  id TEXT PRIMARY KEY NOT NULL,
  brownfield_target_id TEXT NOT NULL REFERENCES brownfield_target(id),
  criterion_id TEXT NOT NULL REFERENCES brownfield_eval_criterion(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pass', 'partial', 'fail', 'na', 'waived')),
  note TEXT,
  evidence_ref TEXT,
  assessed_by TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  UNIQUE(brownfield_target_id, criterion_id)
);
INSERT INTO brownfield_target_eval_state_new SELECT id, brownfield_target_id, criterion_id, status, note, evidence_ref, assessed_by, assessed_at FROM brownfield_target_eval_state;
DROP TABLE brownfield_target_eval_state;
ALTER TABLE brownfield_target_eval_state_new RENAME TO brownfield_target_eval_state;
CREATE INDEX idx_bf_target_eval_state ON brownfield_target_eval_state(brownfield_target_id, criterion_id);
