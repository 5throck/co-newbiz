-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- S3 시너지 정합성 (company-linked short-list stage) + project↔company linkage.
-- FR: 프로젝트 등록 시 대상 회사 필수 — md_project.company_id 추가.

ALTER TABLE md_project ADD COLUMN company_id TEXT REFERENCES md_company(id);

CREATE TABLE synergy_analysis (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES md_company(id),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  current_step INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_synergy_company ON synergy_analysis(company_id, created_at DESC);

-- Append-only version rows (same discipline as market_sizing_version).
CREATE TABLE synergy_version (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES synergy_analysis(id),
  version_no INTEGER NOT NULL,
  payload TEXT NOT NULL,
  changelog TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (analysis_id, version_no)
);
CREATE INDEX idx_synergy_version ON synergy_version(analysis_id, version_no DESC);
