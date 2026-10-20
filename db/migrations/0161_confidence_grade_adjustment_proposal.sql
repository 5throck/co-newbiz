-- 0161_confidence_grade_adjustment_proposal.sql (2026-10-21 S9 depth: ADR-0123
-- #3 "bias detection feeding future data-confidence grades — grade adjustments
-- are proposed, human-approved"). The backtest computes the bias statistics;
-- a person files the proposal and another person approves or rejects it.
-- An APPROVED org-scope row lowers the data-confidence cap read by the RAG
-- service (boundary #4: the cap can only tighten, never loosen — the service
-- takes the worse of the derived grade and the approved grade).
CREATE TABLE confidence_grade_adjustment_proposal (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('org', 'project')),
  project_id TEXT REFERENCES md_project(id),
  proposed_grade TEXT NOT NULL CHECK (proposed_grade IN ('A', 'B', 'C')),
  bias_stats_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_rationale TEXT,
  CHECK ((scope = 'project') = (project_id IS NOT NULL))
);
CREATE INDEX idx_cga_proposal_status ON confidence_grade_adjustment_proposal(status, scope, decided_at);
