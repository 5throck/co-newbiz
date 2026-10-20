-- 0160_risk_assessment_ledger.sql (2026-10-21 S9 depth: ADR-0122 #2 "risk
-- ledger"). The 0156 sidecar (md_project.risk_heatmap_assessment_json) keeps
-- only the latest likelihood/impact per heatmap item and overwrites on each
-- save — a ledger needs the history and the mitigation the 2026-10-19 design
-- deferred (§6). Append-only: every person assessment is a new row; the
-- sidecar stays as the "latest per key" projection so existing readers keep
-- working. item_key uses the stable source keys dd:<finding> / coc:<contract>
-- / inc:<incentive> / cov:<covenant_key>.
CREATE TABLE risk_assessment_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  item_key TEXT NOT NULL,
  likelihood INTEGER NOT NULL CHECK (likelihood IN (1, 2, 3)),
  impact INTEGER NOT NULL CHECK (impact IN (1, 2, 3)),
  mitigation TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX idx_risk_assessment_ledger_item ON risk_assessment_ledger(project_id, item_key, recorded_at);
