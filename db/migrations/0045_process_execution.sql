-- 0045_process_execution.sql (ADR-0074 Phase 2)
-- Execution records for the agentic process runtime. Definition lives in
-- process/flow.spec.yaml; this migration stores EXECUTION only — separated
-- by design and linked by spec_version so past runs survive spec changes.
-- Every row carries the common `source` discriminator
-- (web | claude-desktop | cli | system | agent | human).
CREATE TABLE process_run (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  spec_version TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'claude-desktop', 'cli', 'system', 'agent', 'human')),
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_process_run_project ON process_run(project_id, started_at);

CREATE TABLE activity_run (
  id TEXT PRIMARY KEY NOT NULL,
  process_run_id TEXT NOT NULL REFERENCES process_run(id),
  activity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  output_md TEXT,
  source TEXT NOT NULL DEFAULT 'agent',
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_activity_run_process ON activity_run(process_run_id);

CREATE TABLE agent_run (
  id TEXT PRIMARY KEY NOT NULL,
  process_run_id TEXT NOT NULL REFERENCES process_run(id),
  activity_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  summary_md TEXT,
  source TEXT NOT NULL DEFAULT 'agent',
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_agent_run_process ON agent_run(process_run_id);

CREATE TABLE agent_position (
  id TEXT PRIMARY KEY NOT NULL,
  process_run_id TEXT NOT NULL REFERENCES process_run(id),
  agent_key TEXT NOT NULL,
  position_md TEXT NOT NULL,
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  round INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_agent_position_run ON agent_position(process_run_id, round);

CREATE TABLE gate_evaluation (
  id TEXT PRIMARY KEY NOT NULL,
  process_run_id TEXT NOT NULL REFERENCES process_run(id),
  gate TEXT NOT NULL CHECK (gate IN ('screening', 'pre_fs', 'fs', 'dd', 'entity_ic', 'group_ic')),
  criteria_json TEXT NOT NULL,
  score REAL,
  evidence_json TEXT,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('go', 'hold', 'kill')),
  evaluated_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_gate_evaluation_run ON gate_evaluation(process_run_id, created_at);

CREATE TABLE decision (
  id TEXT PRIMARY KEY NOT NULL,
  gate_evaluation_id TEXT REFERENCES gate_evaluation(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'project')),
  entity_id TEXT NOT NULL,
  gate TEXT NOT NULL CHECK (gate IN ('screening', 'pre_fs', 'fs', 'dd', 'entity_ic', 'group_ic')),
  decision TEXT NOT NULL CHECK (decision IN ('go', 'hold', 'kill')),
  decided_by TEXT NOT NULL,
  decided_by_agent TEXT NOT NULL CHECK (decided_by_agent IN (0, 1)),
  override_allowed INTEGER NOT NULL DEFAULT 1 CHECK (override_allowed IN (0, 1)),
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_decision_entity ON decision(entity_type, entity_id, gate, created_at);
