-- 0042_opportunity_and_gate_decision.sql
-- Process metamodel primitives (docs/process-flow.md):
--
-- opportunity: a first-class funnel entity ABOVE projects. One market study
-- yields many opportunities; only selected ones are promoted to projects.
-- project_id is NULLABLE on purpose — opportunities exist before (and
-- sometimes without) a project.
CREATE TABLE opportunity (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES md_project(id),
  name TEXT NOT NULL,
  market_scope TEXT,
  value_chain_node TEXT,
  market_size_krw_m INTEGER,
  growth_rate REAL,
  attractiveness_score INTEGER CHECK (attractiveness_score BETWEEN 0 AND 100),
  synergy_score INTEGER CHECK (synergy_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'identified'
    CHECK (status IN ('identified', 'assessed', 'selected', 'dropped')),
  rationale TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_opportunity_status ON opportunity(status, created_at);
CREATE INDEX idx_opportunity_project ON opportunity(project_id);

-- gate_decision: recorded output of a gate evaluation (GO | HOLD | KILL).
-- Decisions are GATE outputs, distinct from stage artifacts. HOLD must list
-- the artifacts to supplement (missing_artifacts_json); re-evaluation clears
-- HOLD only when those artifacts exist (computed in lib/process-flow.ts).
-- Entity IC / Group IC decisions keep living in approval_chain — S7
-- gate_decision rows mirror their outcome for stage evaluation.
CREATE TABLE gate_decision (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'project')),
  entity_id TEXT NOT NULL,
  gate TEXT NOT NULL CHECK (gate IN ('screening', 'pre_fs', 'fs', 'dd', 'entity_ic', 'group_ic')),
  decision TEXT NOT NULL CHECK (decision IN ('go', 'hold', 'kill')),
  rationale TEXT NOT NULL,
  missing_artifacts_json TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE INDEX idx_gate_decision_entity ON gate_decision(entity_type, entity_id, gate, decided_at);
