-- 0026_class_c_evidence_extension.sql
-- @version 1.0.0
-- @reversible: true (additive DDL — 4 new tables + indexes, no ALTER/DROP of
-- existing tables; reversal is DROP TABLE in reverse dependency order,
-- backup-first per ADR-0014)
--
-- ADR-0063 — the Class C evidence-plane extension round: gives kill-criteria
-- entries #4/#14/#28/#29 their VAR half. Threshold halves were decided by
-- docs/decisions/2026-08-24-class-c-decisions.md (gd-0024-class-c-decisions).
--
-- Schema discipline (ADR-0002): ULID TEXT PKs, ISO-8601 TEXT dates,
-- CHECK-constrained enums/statuses, no AUTOINCREMENT/INSERT OR REPLACE,
-- integer minor units where money appears (run_rate_pct is basis points of
-- the committed cost-synergy run-rate: 9000 = 90%).
--
-- PII guard (ADR-0039, mirroring management_package's own convention):
-- key-talent rows are ROLE references, never real names — the role_ref shape
-- check below rejects anything that looks like a person's name.

CREATE TABLE pmi_key_talent (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  role_ref TEXT NOT NULL CHECK (role_ref GLOB '[A-Z]-[A-Z0-9][A-Z0-9]-[0-9][0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'departed_regretted', 'departed_planned')),
  exit_date TEXT,
  locked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((status = 'active') = (exit_date IS NULL))
);
CREATE INDEX idx_pmi_key_talent_project ON pmi_key_talent(project_id);

CREATE TABLE pmi_synergy_certification (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  run_rate_bp INTEGER NOT NULL CHECK (run_rate_bp BETWEEN 0 AND 10000),
  sustained_quarters INTEGER NOT NULL CHECK (sustained_quarters >= 1),
  certified_by TEXT NOT NULL,
  baseline_locked_at TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pmi_synergy_cert_project ON pmi_synergy_certification(project_id);

CREATE TABLE deal_shape_evaluation (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  shape TEXT NOT NULL CHECK (shape IN ('full_acquisition', 'majority_stake', 'spv', 'holdco_route', 'joint_venture', 'minority_stake', 'license_in', 'co_development')),
  intent TEXT NOT NULL CHECK (intent IN ('integration', 'capability_access')),
  viable INTEGER NOT NULL CHECK (viable IN (0, 1)),
  evaluated_by TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);
CREATE INDEX idx_deal_shape_evaluation_project ON deal_shape_evaluation(project_id);

CREATE TABLE project_incentive_deadline (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  incentive_ref TEXT NOT NULL,
  deadline TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_incentive_deadline_project ON project_incentive_deadline(project_id);

-- Evidence vars: the VAR half of #28/#29/#14/#4 (computed; requires_evidence_ref=0
-- per the 0017 convention — provenance rides the source queries).
INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('pmi.key_talent_attrition_90d', '90일 핵심인력 이탈률(regretted)', 'number', 'ratio', 'computed', 0, '2026-08-24T00:00:00Z'),
  ('pmi.synergy_run_rate_certified', '시너지 런레이트 인증 상태', 'string', NULL, 'computed', 0, '2026-08-24T00:00:00Z'),
  ('dealshape.viable_shapes', '생존 딜 쉐이프 수(P3)', 'number', 'count', 'computed', 0, '2026-08-24T00:00:00Z'),
  ('permit.critical_path_exceeds_incentive_deadline', '허가 크리티컬패스가 인센티브 마감 초과 여부', 'string', NULL, 'computed', 0, '2026-08-24T00:00:00Z');
