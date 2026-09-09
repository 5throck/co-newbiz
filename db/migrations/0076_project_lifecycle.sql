-- @reversible: true (additive lifecycle columns only; rollback via pre-migration backup restore per ADR-0014)
-- Wave B1 project lifecycle: explicit closure/archival distinct from derived KILL gate verdicts.

ALTER TABLE md_project ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived'));
ALTER TABLE md_project ADD COLUMN closed_at TEXT;
ALTER TABLE md_project ADD COLUMN closure_reason TEXT;
CREATE INDEX idx_md_project_status_created ON md_project(status, created_at DESC);
