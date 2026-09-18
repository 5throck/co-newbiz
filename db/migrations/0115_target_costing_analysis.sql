-- 0115_target_costing_analysis.sql
-- @version 1.0.0
-- @reversible: true — dropping the table loses only recomputable gap analyses
--   (pure functions of their recorded inputs; design
--   2026-09-18-s8-business-case-evaluation REQ-W2-1, output_type
--   target_cost_gap).
--
-- Target costing (FS procedures greenfield-fs 6.96 / brownfield-fs 7.96):
-- the market price is reversed into an allowable cost at the target margin
-- and compared against the estimated unit cost. One row per analysis run;
-- the fs gate reviews the recorded gap, and a beyond-threshold gap feeds the
-- downside scenario's opex driver (REQ-W2-3) at generation time.
CREATE TABLE target_costing_analysis (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  market_price REAL NOT NULL,
  target_margin REAL NOT NULL CHECK (target_margin >= 0 AND target_margin < 1),
  allowable_cost REAL NOT NULL,
  estimated_unit_cost REAL NOT NULL CHECK (estimated_unit_cost >= 0),
  gap REAL NOT NULL,
  gap_ratio REAL NOT NULL,
  threshold_exceeded INTEGER NOT NULL DEFAULT 0,
  levers_json TEXT,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'peer_benchmark')),
  rationale TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_target_costing_project ON target_costing_analysis(project_id, created_at DESC);
