-- 0167_project_milestone.sql (2026-10-21, decider: S12 일정관리가 약하다 —
-- 주요 마일스톤에 따른 일정관리 + 사이드바 관리). The S12 surfaces only had
-- computed stage SLA elapsed times; nothing let a person RUN a schedule. This
-- ledger is the person-managed milestone register: manual entries plus rows
-- imported from the greenfield execution baseline (source column), status
-- always derived from due_date + done_at, never stored.
CREATE TABLE project_milestone (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  category TEXT NOT NULL DEFAULT 'custom' CHECK (category IN ('permit', 'certification', 'capex', 'contract', 'custom')),
  due_date TEXT NOT NULL CHECK (due_date GLOB '????-??-??'),
  owner TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'execution_baseline')),
  done_at TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);
CREATE INDEX idx_project_milestone_due ON project_milestone(project_id, due_date);
