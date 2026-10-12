-- 0135_project_business_goal.sql
-- @reversible: true (purely additive — one new table and two indexes, no
-- existing table touched. Manual rollback, in this order:
--   DROP INDEX idx_pbg_project_metric_active;
--   DROP INDEX idx_pbg_project;
--   DROP TABLE project_business_goal;
-- Nothing else references the table. Code rollback: revert the PR; target
-- resolution then falls back to affiliate > group standards. No backfill.)
--
-- Project-level business goals (ADR-0159, design 2026-10-11-s8-project-
-- business-goals). Analysts set goals per deal in S8, above the admin-managed
-- group/affiliate standards (md_business_target, ADR-0114). Versions are
-- append-only: a supersede writes a NEW row and only stamps superseded_at /
-- superseded_by on the old one; a retire stamps retired_*. Active =
-- superseded_at IS NULL AND retired_at IS NULL. Stored units follow ADR-0061
-- (KRW millions, ratios, years). Additive-only (ADR-0014).

CREATE TABLE project_business_goal (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  metric_key TEXT NOT NULL,
  label TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('gte','lte')),
  target_value REAL NOT NULL,
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  source_note TEXT,
  supersedes_id TEXT REFERENCES project_business_goal(id),
  superseded_at TEXT,
  superseded_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retired_at TEXT,
  retired_by TEXT,
  retire_reason TEXT
);

CREATE INDEX idx_pbg_project ON project_business_goal(project_id, metric_key);

CREATE UNIQUE INDEX idx_pbg_project_metric_active ON project_business_goal(
  project_id, metric_key, COALESCE(label, '')
) WHERE superseded_at IS NULL AND retired_at IS NULL;
