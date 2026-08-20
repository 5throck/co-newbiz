-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- Closes the documented-vs-migrated gap found in the 2026-08-21 session audit:
-- docs/db-schema.md documented 68 tables, only 51 had ever been migrated.
-- This migration adds the 24 missing tables in one pass, grouped by
-- db-schema.md section. Most urgent: dd_finding, referenced by
-- commercial-due-diligence, dd-to-valuation-bridge, and
-- financial-statement-analysis skills as their primary write target.

-- ── §3 Fact and Observation Tables ──────────────────────────────────────

CREATE TABLE fact_financial (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES md_company(id),
  period_id TEXT NOT NULL REFERENCES md_period(id),
  account_id TEXT NOT NULL REFERENCES md_account(id),
  value REAL NOT NULL,
  revision_no INTEGER NOT NULL DEFAULT 1,
  source_id TEXT REFERENCES md_source(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_fact_financial_latest ON fact_financial(company_id, period_id, account_id, revision_no DESC);

CREATE TABLE fact_industry (
  id TEXT PRIMARY KEY,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  period_id TEXT NOT NULL REFERENCES md_period(id),
  metric_key TEXT NOT NULL,
  value REAL NOT NULL,
  revision_no INTEGER NOT NULL DEFAULT 1,
  source_id TEXT REFERENCES md_source(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_fact_industry_ind ON fact_industry(industry_id, period_id);

-- value_chain_link deliberately shares no coefficient column with
-- proxy_link (ADR-0025) — the two answer different questions and mixing
-- their coefficients would corrupt both the demand estimate and the risk
-- assessment it feeds.
CREATE TABLE value_chain_link (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  from_industry_id TEXT NOT NULL REFERENCES md_industry(id),
  to_industry_id TEXT NOT NULL REFERENCES md_industry(id),
  direction TEXT NOT NULL CHECK (direction IN ('upstream', 'downstream')),
  elasticity REAL,
  lag_months INTEGER,
  correlation REAL,
  r2 REAL,
  pass_through_rate REAL,
  pass_through_lag_months INTEGER,
  concentration_hhi REAL,
  switching_cost_grade TEXT,
  substitution_threat TEXT,
  evidence_ref TEXT,
  assessed_at TEXT NOT NULL
);
CREATE INDEX idx_value_chain_link_project ON value_chain_link(project_id);

-- ── §4 Assumption, Run, and Versioning ──────────────────────────────────

CREATE TABLE document (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT REFERENCES document(id),
  document_section_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_document_run ON document(run_id);

CREATE TABLE fx_policy (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('transaction_date', 'period_average', 'period_end')),
  source_series_id TEXT,
  created_at TEXT NOT NULL
);

-- ── §5 Governance Tables ─────────────────────────────────────────────────

CREATE TABLE policy (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('shared', 'entity', 'region')),
  entity_id TEXT,
  region_code TEXT,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  superseded_by TEXT REFERENCES policy(id),
  doc_path TEXT
);

CREATE TABLE procedure (
  id TEXT PRIMARY KEY,
  procedure_key TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('shared', 'entity', 'region', 'group')),
  entity_id TEXT,
  region_code TEXT,
  version TEXT NOT NULL,
  references_id TEXT REFERENCES procedure(id),
  spec_json TEXT NOT NULL,
  effective_from TEXT NOT NULL
);
CREATE INDEX idx_procedure_key ON procedure(procedure_key, scope, entity_id);

-- project_policy_pin is what keeps a project's evaluation from silently
-- changing the day a policy is amended (design §2-4) — without it, a
-- project that was Green yesterday can turn Red overnight for no
-- traceable reason.
CREATE TABLE project_policy_pin (
  project_id TEXT NOT NULL REFERENCES md_project(id),
  policy_id TEXT NOT NULL REFERENCES policy(id),
  policy_version TEXT NOT NULL,
  pinned_at TEXT NOT NULL,
  pinned_by TEXT NOT NULL,
  migration_note TEXT,
  PRIMARY KEY (project_id, policy_id)
);

CREATE TABLE policy_change (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policy(id),
  from_version TEXT,
  to_version TEXT NOT NULL,
  summary TEXT NOT NULL,
  adr_ref TEXT,
  detected_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE TABLE policy_impact (
  id TEXT PRIMARY KEY,
  policy_change_id TEXT NOT NULL REFERENCES policy_change(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  impact TEXT,
  action TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected'))
);
CREATE INDEX idx_policy_impact_change ON policy_impact(policy_change_id);

CREATE TABLE governance_kpi (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  entity_id TEXT,
  metric_key TEXT NOT NULL,
  value REAL NOT NULL,
  note TEXT
);
CREATE INDEX idx_governance_kpi_period ON governance_kpi(period_id, metric_key);

-- ── §7 M&A Special-Topics Tables ─────────────────────────────────────────

-- category='rbd' findings carry R&BD-specific columns (design §18.2,
-- pilot 011 F-2 / pilot 012 F-2) rather than a separate table, since they
-- are still DD findings with a financial consequence like any other row
-- here — only the evidence shape differs.
CREATE TABLE dd_finding (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  value_impact REAL,
  assumption_key TEXT,
  evidence_ref TEXT,
  trl_grade TEXT,
  ip_ownership_status TEXT,
  commercialization_path TEXT,
  parent_relationship_json TEXT,
  rbd_source TEXT CHECK (rbd_source IS NULL OR rbd_source IN ('internal_only', 'accelerator_partnered', 'external_technology_acquisition')),
  created_at TEXT NOT NULL,
  CHECK (category != 'rbd' OR rbd_source IS NOT NULL)
);
CREATE INDEX idx_dd_finding_project ON dd_finding(project_id);

CREATE TABLE antitrust_finding (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  market_definition TEXT NOT NULL,
  hhi_before REAL,
  hhi_after REAL,
  combination_type TEXT CHECK (combination_type IN ('direct_merger', 'common_ownership')),
  filing_jurisdictions TEXT,
  remedy_type TEXT NOT NULL DEFAULT 'none' CHECK (remedy_type IN ('none', 'behavioral', 'structural', 'prohibited')),
  remedy_detail TEXT,
  discharge_confirmed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_antitrust_finding_project ON antitrust_finding(project_id);

CREATE TABLE benefit_item (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  category TEXT NOT NULL,
  target_value REAL,
  acquirer_value REAL,
  per_capita_delta REAL,
  harmonization_cost REAL,
  statutory_constraint TEXT
);
CREATE INDEX idx_benefit_item_project ON benefit_item(project_id);

CREATE TABLE debt_instrument (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  lender TEXT,
  principal REAL NOT NULL,
  currency_id TEXT REFERENCES md_currency(id),
  rate_type TEXT NOT NULL CHECK (rate_type IN ('fixed', 'floating')),
  rate REAL NOT NULL,
  maturity TEXT,
  amortization TEXT,
  covenant_json TEXT,
  coc_acceleration INTEGER NOT NULL DEFAULT 0,
  security TEXT,
  seniority TEXT
);
CREATE INDEX idx_debt_instrument_project ON debt_instrument(project_id);

CREATE TABLE covenant_test (
  simulation_id TEXT NOT NULL REFERENCES simulation(id),
  period_id TEXT NOT NULL,
  covenant_key TEXT NOT NULL,
  threshold REAL NOT NULL,
  projected_value REAL NOT NULL,
  breached INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (simulation_id, period_id, covenant_key)
);

CREATE TABLE incentive (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  site_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('prospective', 'granted')),
  type TEXT NOT NULL,
  grantor TEXT,
  program_name TEXT,
  amount REAL,
  npv_value REAL,
  currency_id TEXT REFERENCES md_currency(id),
  granted_on TEXT,
  application_deadline TEXT,
  construction_deadline TEXT,
  obligation_json TEXT,
  clawback_rule TEXT,
  estimated_clawback REAL,
  negotiability TEXT,
  status TEXT NOT NULL DEFAULT 'prospective',
  evidence_ref TEXT
);
CREATE INDEX idx_incentive_project ON incentive(project_id);

-- ── §8 Green Field Tables ────────────────────────────────────────────────

CREATE TABLE site_candidate (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  name TEXT NOT NULL,
  region_code TEXT,
  infra_score REAL,
  infra_capex REAL,
  incentive_npv REAL,
  logistics_cost REAL,
  labor_availability REAL,
  permit_lead_time_days INTEGER,
  affected_area_notification_status TEXT,
  total_score REAL,
  rank INTEGER
);
CREATE INDEX idx_site_candidate_project ON site_candidate(project_id);

-- permit and certification are kept structurally separate (design §4-1
-- non-negotiable boundary: a permit lets you operate, a certification
-- lets you sell — different issuers, procedures, and critical paths).
CREATE TABLE permit (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  name TEXT NOT NULL,
  agency TEXT,
  statutory_days INTEGER,
  status TEXT NOT NULL DEFAULT 'not_started'
);
CREATE INDEX idx_permit_project ON permit(project_id);

CREATE TABLE permit_edge (
  from_permit_id TEXT NOT NULL REFERENCES permit(id),
  to_permit_id TEXT NOT NULL REFERENCES permit(id),
  PRIMARY KEY (from_permit_id, to_permit_id)
);

CREATE TABLE certification (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  name TEXT NOT NULL,
  agency TEXT,
  statutory_days INTEGER,
  status TEXT NOT NULL DEFAULT 'not_started'
);
CREATE INDEX idx_certification_project ON certification(project_id);

CREATE TABLE certification_edge (
  from_certification_id TEXT NOT NULL REFERENCES certification(id),
  to_certification_id TEXT NOT NULL REFERENCES certification(id),
  PRIMARY KEY (from_certification_id, to_certification_id)
);

CREATE TABLE partner_candidate (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  name TEXT NOT NULL,
  partner_type TEXT NOT NULL,
  region_code TEXT,
  capability_score REAL,
  capacity_score REAL,
  financial_score REAL,
  compliance_risk TEXT,
  customer_base_fit REAL,
  dependency_risk TEXT,
  status TEXT NOT NULL DEFAULT 'sourcing',
  contacted_at TEXT,
  nda_signed INTEGER NOT NULL DEFAULT 0,
  evidence_ref TEXT
);
CREATE INDEX idx_partner_candidate_project ON partner_candidate(project_id);

CREATE TABLE jv_term (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  partner_id TEXT NOT NULL REFERENCES partner_candidate(id),
  equity_split TEXT,
  governance_json TEXT,
  veto_matters TEXT,
  contribution_json TEXT,
  exit_clause TEXT,
  deadlock_mechanism TEXT,
  non_compete_scope TEXT
);
CREATE INDEX idx_jv_term_project ON jv_term(project_id);

-- ── §10 Review and Access Tables ─────────────────────────────────────────

-- unverified_items_json is NOT NULL by design (FR per design §1): the
-- human review surface carries no "PASS" stamp, and an AI reviewer must
-- always explicitly declare what it could not check rather than being
-- silent about it.
CREATE TABLE review_stage (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  stage TEXT NOT NULL CHECK (stage IN ('ai_1st', 'ai_2nd', 'human_final')),
  reviewer_agent_or_user TEXT NOT NULL,
  reviewer_domain TEXT,
  unverified_items_json TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_review_stage_run ON review_stage(run_id);

CREATE TABLE analysis_task (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  deliverable_type TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX idx_analysis_task_project ON analysis_task(project_id);
