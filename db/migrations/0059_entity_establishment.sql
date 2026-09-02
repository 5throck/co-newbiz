-- 0059_entity_establishment.sql — S10 설립 실행 기록 (ADR-0085).
-- entity-establishment-execution 절차 5단계(설립준비 → 등기·정관·사업자등록 →
-- 인허가 이전/재발급 분류 → 인력이전(신 근로계약+PIIA) → 완료확인)의 상태·증적을
-- 기록한다. origin∈{internal,joint}에만 적용(ADR-0047, 절차 applies_when과 동일).
-- status는 절차 kill criteria 액션과 1:1: halted=IP양도체인 미완료 등 halt,
-- escalated=인력이전 동의 미확정 등 risk-officer 에스컬레이션. Additive-only (ADR-0014).

CREATE TABLE entity_establishment_step (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  step_no INTEGER NOT NULL CHECK (step_no BETWEEN 1 AND 5),
  -- 1=설립준비(관할·주식구조·이사회 결의) 2=법인등기·정관·사업자등록
  -- 3=인허가 이전/재발급 분류 4=인력이전(신 근로계약+PIIA) 5=완료확인(IP양도체인·거버넌스 베이스라인)
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'done', 'halted', 'escalated')),
  origin TEXT NOT NULL CHECK (origin IN ('internal', 'joint')),
  checklist_item TEXT,        -- 해당 단계의 chk-entity-formation 항목 ID (ef-01..ef-12, JV ef-13..ef-18)
  evidence_url TEXT,          -- entity data room 증적 링크
  note TEXT,
  owner TEXT NOT NULL,        -- 담당자
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_ees_opp ON entity_establishment_step(opportunity_id, step_no);
