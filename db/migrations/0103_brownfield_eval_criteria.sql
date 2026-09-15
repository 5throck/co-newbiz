-- @reversible: true (additive-only — two CREATE TABLE + two CREATE INDEX)
-- ADR-0139 — S7 재무·기술 평가 레이어. chk-target-screening(t-01~t-09,
-- 워크스페이스 공통 지배문서)은 그대로 두고, 오퍼튜니티별로 확장 가능한
-- 평가 항목 카탈로그(brownfield_eval_criterion)와 후보별 판정
-- (brownfield_target_eval_state)을 관계형으로 추가한다 — screening_json
-- 블롭 방식(0055)이 아니라 project_checklist_item_custom/state(0069/0039)
-- 패턴을 오퍼튜니티 단계로 축소 적용한 것.
CREATE TABLE brownfield_eval_criterion (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  category TEXT NOT NULL CHECK (category IN ('financial', 'technical')),
  -- builtin: 재무 평가 고정 항목(코드 내장, 삭제 불가).
  -- seeded: S3 역량 갭 레지스터에서 항목별로 자동 생성(기술 평가, 삭제 불가).
  -- custom: 사람이 추가(삭제 가능, 단 판정 기록이 있으면 API가 거부).
  source TEXT NOT NULL CHECK (source IN ('builtin', 'seeded', 'custom')),
  label TEXT NOT NULL,
  description TEXT,
  data_ref TEXT,
  seed_ref TEXT,
  is_mandatory INTEGER NOT NULL DEFAULT 0 CHECK (is_mandatory IN (0, 1)),
  is_deletable INTEGER NOT NULL DEFAULT 1 CHECK (is_deletable IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_bf_eval_criterion_opp ON brownfield_eval_criterion(opportunity_id, category, deleted_at);

CREATE TABLE brownfield_target_eval_state (
  id TEXT PRIMARY KEY NOT NULL,
  brownfield_target_id TEXT NOT NULL REFERENCES brownfield_target(id),
  criterion_id TEXT NOT NULL REFERENCES brownfield_eval_criterion(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pass', 'fail', 'na', 'waived')),
  note TEXT,
  evidence_ref TEXT,
  assessed_by TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  UNIQUE(brownfield_target_id, criterion_id)
);
CREATE INDEX idx_bf_target_eval_state ON brownfield_target_eval_state(brownfield_target_id, criterion_id);
