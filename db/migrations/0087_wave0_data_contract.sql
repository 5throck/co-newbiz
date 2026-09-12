-- 0087_wave0_data_contract.sql
-- @reversible: true
-- Wave 0 of the construction plan (docs/designs/2026-09-12-website-construction-plan.md):
-- persistence for the v5 mockup surfaces per docs/designs/2026-09-12-mockup-v3-data-contract.md
-- (+ v4/v5 addenda). Provenance-first, append-only where the flow demands it.
-- ADR-0122 (round-2) / ADR-0123 (round-3).

-- ── S6/S7 candidate discovery provenance (data contract A1/A2) ──
ALTER TABLE brownfield_target ADD COLUMN discovery_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (discovery_source IN ('manual', 'master_proposal', 'web_proposal'));
ALTER TABLE brownfield_target ADD COLUMN proposal_accepted_at TEXT;

-- ── S7 ⑥b ownership / antitrust screening ──
CREATE TABLE antitrust (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  target_id TEXT REFERENCES brownfield_target(id),
  market_definition TEXT NOT NULL,
  hhi_before INTEGER,
  hhi_after INTEGER,
  combination_type TEXT,
  filing_jurisdictions TEXT,
  remedy_type TEXT NOT NULL DEFAULT 'none',
  remedy_detail TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_antitrust_project ON antitrust(project_id, created_at);

-- ── site / facility assessment ──
CREATE TABLE site (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  name TEXT NOT NULL,
  region_code TEXT,
  infra_score INTEGER,
  logistics_score INTEGER,
  labor_score INTEGER,
  permit_lead_time_days INTEGER,
  infra_capex INTEGER,
  total_score INTEGER,
  rank INTEGER,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_site_project ON site(project_id, rank);

-- ── customer / supplier contract change-of-control (customer-retention) ──
CREATE TABLE contract_coc (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  counterparty TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('customer', 'supplier')),
  coc_clause_present INTEGER NOT NULL DEFAULT 0,
  clause_summary TEXT,
  concentration_pct REAL,
  est_exit_loss INTEGER,
  evidence_ref TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_contract_coc_project ON contract_coc(project_id);

-- ── expert interviews / channel checks (commercial-dd) ──
CREATE TABLE dd_interview (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  interviewee TEXT NOT NULL,
  topic TEXT NOT NULL,
  response_summary TEXT NOT NULL,
  disagreement TEXT,
  follow_up TEXT,
  evidence_ref TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_dd_interview_project ON dd_interview(project_id, created_at);

-- ── collaboration annotations (round-2 #6) ──
CREATE TABLE deal_comment (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity', 'project')),
  entity_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_deal_comment_entity ON deal_comment(entity_type, entity_id, created_at);

-- ── stage SLA policy (round-2 #1 — policy table; elapsed/overdue is computed) ──
CREATE TABLE stage_sla (
  stage_id TEXT PRIMARY KEY
    CHECK (stage_id IN ('S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12')),
  target_days INTEGER NOT NULL CHECK (target_days > 0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── e-approval cross-reference (round-3 #5, ADR-0123) ──
ALTER TABLE gate_decision ADD COLUMN erp_ref TEXT;

-- ── external safe-share (round-3 #4 — snapshots only, never live data) ──
CREATE TABLE share_link (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recipient TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  watermark TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE share_access (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES share_link(id),
  accessed_at TEXT NOT NULL
);
CREATE INDEX idx_share_link_project ON share_link(project_id);
