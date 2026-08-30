-- 0043_route_decision.sql
-- S4 Route Decision (docs/process-flow.md §3 S4): how do we enter the market?
-- opportunity_id NOT NULL (the route is decided FOR an opportunity);
-- project_id NULLABLE until the opportunity is promoted to a deal (existing
-- deals fill both). sub_track applies only to the greenfield track.
-- alternatives_considered / decision_factors_json keep the "why this route?"
-- record explainable (for humans now, for AI rationale later).
CREATE TABLE route_decision (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  project_id TEXT REFERENCES md_project(id),
  track TEXT NOT NULL CHECK (track IN ('greenfield', 'brownfield')),
  sub_track TEXT CHECK (sub_track IN ('existing_business_rbd', 'intra_venture')),
  rationale TEXT NOT NULL,
  alternatives_considered TEXT,
  decision_factors_json TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE INDEX idx_route_decision_opportunity ON route_decision(opportunity_id);
CREATE INDEX idx_route_decision_project ON route_decision(project_id);
