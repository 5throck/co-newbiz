-- Governance engines — docs/db-schema.md §5/§6, Wave 5.3.
--   rag_rule / rag_assessment / rag_transition   (FR-RAG-01..08, ADR-0016)
--   approval_chain / group_agenda                (FR-GOV-04..06, ADR-0028/0029)
--   compliance_check / waiver / interpretation   (FR-GOV-09..12, ADR-0036/0037)
--
-- governance_doc lands here (not in a later policy-pipeline wave) because
-- waiver, interpretation, and rag_rule.policy_id all reference it — it is the
-- anchor table of this domain (docs/db-schema.md §5). The procedure/policy/
-- policy_change/policy_impact/project_policy_pin tables remain with the
-- policy:sync / policy:impact work that owns them.

CREATE TABLE governance_doc (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL CHECK (layer IN ('policy', 'procedure', 'guideline', 'checklist', 'template')),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'shared',
  entity_id TEXT REFERENCES md_entity(id),
  region_code TEXT,
  version TEXT NOT NULL,
  enforceability TEXT NOT NULL CHECK (enforceability IN ('mandatory', 'recommended', 'mixed')),
  owner_agent TEXT NOT NULL,
  doc_path TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  superseded_by TEXT REFERENCES governance_doc(id),
  review_cycle_months INTEGER
);
CREATE INDEX idx_governance_doc_key ON governance_doc(layer, key);

-- ---------------------------------------------------------------------------
-- RAG (docs/rag-framework.md — thresholds are the meeting M3 decisions
-- D-M3-1..D-M3-4, encoded as engine logic in db/lib/rag-engine.ts; rag_rule
-- rows carry the same conditions as data for the future admin console).
-- ---------------------------------------------------------------------------

CREATE TABLE rag_rule (
  id TEXT PRIMARY KEY,
  stage_gate TEXT NOT NULL CHECK (stage_gate IN ('screening', 'pre_fs', 'fs', 'dd', 'entity_ic', 'group_ic')),
  dimension TEXT NOT NULL CHECK (dimension IN ('financial', 'market', 'data_confidence', 'regulatory_permit', 'technical_execution', 'risk', 'overall')),
  grade TEXT NOT NULL CHECK (grade IN ('green', 'amber', 'red')),
  condition_expr TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  policy_id TEXT REFERENCES governance_doc(id)
);
CREATE INDEX idx_rag_rule ON rag_rule(stage_gate, dimension, priority);

CREATE TABLE rag_assessment (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  dimension TEXT NOT NULL CHECK (dimension IN ('financial', 'market', 'data_confidence', 'regulatory_permit', 'technical_execution', 'risk', 'overall')),
  grade TEXT NOT NULL CHECK (grade IN ('green', 'amber', 'red')),
  -- FR-RAG-05: remedy shape only meaningful on the regulatory_permit row.
  remedy_shape TEXT CHECK (
    remedy_shape IS NULL
    OR (dimension = 'regulatory_permit' AND remedy_shape IN ('structural', 'behavioral', 'none'))
  ),
  triggered_rules TEXT NOT NULL DEFAULT '[]', -- JSON array of rag_rule ids
  rationale TEXT NOT NULL,
  assessed_at TEXT NOT NULL
);
-- Dashboard's current-grade lookup (docs/db-schema.md §11).
CREATE INDEX idx_rag ON rag_assessment(project_id, assessed_at DESC);

CREATE TABLE rag_transition (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  from_grade TEXT CHECK (from_grade IN ('green', 'amber', 'red')),
  to_grade TEXT NOT NULL CHECK (to_grade IN ('green', 'amber', 'red')),
  run_id TEXT NOT NULL REFERENCES run(id),
  at TEXT NOT NULL,
  reason TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_rag_transition ON rag_transition(project_id, at DESC);

-- ---------------------------------------------------------------------------
-- Approval chain (ADR-0028: Entity IC approval is a hard precondition for
-- Group-level entry; blocked_reason records the block explicitly).
-- FR-GOV-06: four decision states incl. withdrawn_pending_resubmission
-- (pilot 003 finding F-2 — Doosan's withdraw-and-re-propose pattern).
-- ---------------------------------------------------------------------------

CREATE TABLE approval_chain (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  level TEXT NOT NULL CHECK (level IN ('entity', 'group')),
  gate TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  required_procedure_id TEXT,
  approver_role TEXT NOT NULL,
  entity_id TEXT REFERENCES md_entity(id),
  status TEXT NOT NULL CHECK (status IN ('not_ready', 'pending', 'approved', 'rejected', 'conditional', 'withdrawn_pending_resubmission')),
  decision TEXT CHECK (decision IN ('approved', 'rejected', 'conditional', 'withdrawn_pending_resubmission')),
  decided_at TEXT,
  conditions TEXT,
  blocked_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_approval_chain_project ON approval_chain(project_id, level, sequence);

-- Ranking inputs (irr_over_hurdle_pp, rag_grade) come from the group-agenda-
-- ranking step's own three inputs (rag-framework.md §6 / pilot 004 §6):
-- IRR-over-hurdle spread + RAG grade + capital requested.
CREATE TABLE group_agenda (
  id TEXT PRIMARY KEY,
  cycle TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  entity_id TEXT REFERENCES md_entity(id),
  submitted_at TEXT NOT NULL,
  capital_request REAL NOT NULL,
  irr_over_hurdle_pp REAL,
  rag_grade TEXT CHECK (rag_grade IN ('green', 'amber', 'red')),
  priority_rank INTEGER,
  decision TEXT CHECK (decision IN ('approved', 'rejected', 'conditional', 'withdrawn_pending_resubmission')),
  rationale TEXT
);
CREATE INDEX idx_group_agenda_cycle ON group_agenda(cycle, priority_rank);

-- ---------------------------------------------------------------------------
-- Compliance / waiver / interpretation (ADR-0036, ADR-0037).
-- ---------------------------------------------------------------------------

CREATE TABLE compliance_check (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  gate TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('policy', 'procedure', 'guideline', 'checklist', 'template')),
  result TEXT NOT NULL CHECK (result IN ('pass', 'blocked', 'reason_required', 'waived')),
  detail TEXT,
  waiver_id TEXT,
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX idx_compliance_check ON compliance_check(project_id, gate);

-- ADR-0036: expires_at NOT NULL — an indefinite waiver is a de facto
-- unrecorded repeal of its clause and is rejected at the database level.
CREATE TABLE waiver (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  governance_doc_id TEXT NOT NULL REFERENCES governance_doc(id),
  clause_ref TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'rejected', 'revoked')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_waiver_clause ON waiver(governance_doc_id, clause_ref);
CREATE INDEX idx_waiver_project ON waiver(project_id, status);

CREATE TABLE interpretation (
  id TEXT PRIMARY KEY,
  governance_doc_id TEXT NOT NULL REFERENCES governance_doc(id),
  clause_ref TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  asked_by TEXT NOT NULL,
  answered_by TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  supersedes TEXT REFERENCES interpretation(id),
  published INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_interpretation ON interpretation(governance_doc_id, clause_ref);
