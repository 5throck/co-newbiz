-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- 역할 분리: 인수 주체(acquirer)와 M&A 대상(target)/그린필드 후보(candidate)를
-- 명확히 구분한다 — 기존 synergy_analysis.company_id는 '대상 기업' 의미로 유지.

ALTER TABLE synergy_analysis ADD COLUMN acquirer_company_id TEXT REFERENCES md_company(id);

-- 프로젝트-회사 역할 매핑 (brownfield target / greenfield candidates)
CREATE TABLE project_company (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  company_id TEXT NOT NULL REFERENCES md_company(id),
  role TEXT NOT NULL CHECK (role IN ('acquirer', 'target', 'candidate')),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, company_id, role)
);
CREATE INDEX idx_project_company ON project_company(project_id, role);
