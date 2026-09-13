-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- ADR-0125 — S3 시너지 큐레이션. LLM 파이프라인 출력(synergy_version.payload)은
-- append-only 스냅샷이라 직접 고칠 수 없다. 이 두 테이블은 그 위에 얹는 사람의
-- 큐레이션 레이어다: 연계 시너지에 사람이 항목을 추가하고, 우선 시너지 영역의
-- 판정·사유를 사람이 고치거나 새 영역을 더할 수 있게 한다. origin이 항목이
-- LLM 제안인지 사람이 추가한 것인지를 구분한다.

CREATE TABLE synergy_linkage_item (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES synergy_analysis(id),
  area TEXT NOT NULL,
  synergy_type TEXT NOT NULL,
  rationale TEXT NOT NULL,
  opportunity TEXT,
  risk TEXT,
  sources_json TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_synergy_linkage_item ON synergy_linkage_item(analysis_id, created_at);

CREATE TABLE synergy_shortlist_curation (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES synergy_analysis(id),
  area TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('llm', 'human')),
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL,
  rank INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  UNIQUE (analysis_id, area)
);
CREATE INDEX idx_synergy_shortlist_curation ON synergy_shortlist_curation(analysis_id);
