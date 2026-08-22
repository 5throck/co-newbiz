-- @reversible: true (the five table rebuilds carry no data change — all columns
-- and their pre-existing constraints are reproduced verbatim, only CHECK
-- clauses added; each rebuilt table was verified 0 rows, and the copies are
-- written generically anyway so a non-empty table would carry its rows
-- through. Manual rollback, legal only while the tables are unreferenced by
-- data: re-run the 0011 CREATE TABLE shapes (plus 0012's certification
-- columns) through the same rebuild procedure to drop the CHECKs; restore the
-- 0017/0018 placeholder condition_expr/grade/priority/stage_gate values
-- recorded verbatim in those files; DELETE the rag_rule_variable rows of the
-- six new rules; DELETE the six rule-0019-* rows; DELETE the
-- cert.load_bearing_non_transferable_on_coc seed. Full-restore mechanism for
-- production is pre-migration backup restore, see scripts/co-newbiz/restore.ts
-- — ADR-0014.)
-- Threshold decision records, implemented 1:1 — every CHECK text, enum
-- member, condition_expr scalar, grade, priority, and stage_gate below is
-- decided there; this migration invents nothing:
--   docs/decisions/market-thresholds.md (D-M-MKT-2, D-M-MKT-9, D-M-MKT-10,
--     and the final mapping table) — supersedes docs/decisions/open/
--     market-thresholds.md
--   docs/decisions/risk-thresholds.md (D-M-RISK-3, D-M-RISK-6, D-M-RISK-7)
--   docs/decisions/technical-execution-thresholds.md (D-M-TE-1, D-M-TE-3,
--     D-M-TE-4, D-M-TE-5, D-M-TE-8) — "Activation prerequisites" step 1
-- PR-8 (the record-mandated enum/finalization PR between PR-7 and the
-- fillers/PR-9).
--
-- Three sections, in dependency order:
--   (a) CHECK enums on existing columns — SQLite cannot ALTER ADD CHECK, so
--       each affected table is rebuilt (create-with-CHECKs, INSERT..SELECT,
--       DROP, RENAME). The rebuild runs inside the runner's transaction with
--       PRAGMA foreign_keys=ON (client.ts): validated shape — data copies
--       through, child FKs (jv_term, permit_edge, certification_edge) keep
--       resolving and enforcing after the rename, PRAGMA foreign_key_check
--       stays empty. Each table's pre-existing indexes are recreated
--       verbatim (DROP TABLE drops them).
--   (b) one new evidence_var seed (D-M-TE-8)
--   (c) rag_rule finalization — the 0017/0018 staged placeholder rows are
--       updated IN PLACE (version stays 1; the records' mapping tables are
--       the final values, not new drafts) plus six record-mandated new rows,
--       then the rag_rule_variable wiring for the new rules (after (b), FK).
--
-- ALL rules stay enabled=0: activation is PR-9's deliberate act (requires
-- policy_id + thresholds_source per the 0012 CHECK), gated on the records'
-- activation prerequisites. The re-graded market-dd-right-to-win (amber→
-- green, D-M-MKT-10.1) stays disabled — an enabled green market rule
-- pre-calibration would violate the Decision 9 Green cap, which these
-- numbers explicitly do not lift (D-M-MKT-11.2).
-- created_at is the same fixed literal 0017/0018 used ('2026-08-23T00:00:00Z',
-- ADR-0002: no dynamic date functions) so all three seed sets remain
-- byte-deterministic and mutually consistent.

-- ── (a) CHECK enums via table rebuild ─────────────────────────────────────
-- D-M-MKT-2: switching_cost_grade — five-member ordinal, NULL allowed
-- (absence must remain distinguishable from a value).
CREATE TABLE value_chain_link_constrained (
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
  switching_cost_grade TEXT CHECK (switching_cost_grade IS NULL OR switching_cost_grade IN ('negligible','low','moderate','high','very_high')),
  substitution_threat TEXT,
  evidence_ref TEXT,
  assessed_at TEXT NOT NULL
);
INSERT INTO value_chain_link_constrained (id, project_id, from_industry_id, to_industry_id, direction, elasticity, lag_months, correlation, r2, pass_through_rate, pass_through_lag_months, concentration_hhi, switching_cost_grade, substitution_threat, evidence_ref, assessed_at)
  SELECT id, project_id, from_industry_id, to_industry_id, direction, elasticity, lag_months, correlation, r2, pass_through_rate, pass_through_lag_months, concentration_hhi, switching_cost_grade, substitution_threat, evidence_ref, assessed_at FROM value_chain_link;
DROP TABLE value_chain_link;
ALTER TABLE value_chain_link_constrained RENAME TO value_chain_link;
CREATE INDEX idx_value_chain_link_project ON value_chain_link(project_id);

-- D-M-TE-1: trl_grade TRL1..TRL9 (uppercase prefix, single digit, no
-- zero-padding), NULL allowed. D-M-TE-3: ip_ownership_status — the four
-- ownership-chain shapes the R&BD pilots distinguish plus disputed, NULL
-- allowed. dd_finding's 0011 shape (rbd_source CHECK and the category/rbd
-- table-level CHECK) is reproduced verbatim.
CREATE TABLE dd_finding_constrained (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  value_impact REAL,
  assumption_key TEXT,
  evidence_ref TEXT,
  trl_grade TEXT CHECK (trl_grade IS NULL OR trl_grade IN ('TRL1','TRL2','TRL3','TRL4','TRL5','TRL6','TRL7','TRL8','TRL9')),
  ip_ownership_status TEXT CHECK (ip_ownership_status IS NULL OR ip_ownership_status IN ('owned_by_target','owned_by_originator','licensed_in','jointly_owned','disputed')),
  commercialization_path TEXT,
  parent_relationship_json TEXT,
  rbd_source TEXT CHECK (rbd_source IS NULL OR rbd_source IN ('internal_only', 'accelerator_partnered', 'external_technology_acquisition')),
  created_at TEXT NOT NULL,
  CHECK (category != 'rbd' OR rbd_source IS NOT NULL)
);
INSERT INTO dd_finding_constrained (id, project_id, category, description, value_impact, assumption_key, evidence_ref, trl_grade, ip_ownership_status, commercialization_path, parent_relationship_json, rbd_source, created_at)
  SELECT id, project_id, category, description, value_impact, assumption_key, evidence_ref, trl_grade, ip_ownership_status, commercialization_path, parent_relationship_json, rbd_source, created_at FROM dd_finding;
DROP TABLE dd_finding;
ALTER TABLE dd_finding_constrained RENAME TO dd_finding;
CREATE INDEX idx_dd_finding_project ON dd_finding(project_id);

-- D-M-TE-4 companion CHECK: transferable_on_coc yes/no, NULL = no position
-- taken (never read as 'yes'; unknown transferability is never transferable).
-- The 0011 base + 0012 ADD COLUMN shape (incl. the transferability_basis and
-- load_bearing CHECKs) is reproduced verbatim.
CREATE TABLE certification_constrained (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  name TEXT NOT NULL,
  agency TEXT,
  statutory_days INTEGER,
  status TEXT NOT NULL DEFAULT 'not_started',
  transferability_basis TEXT CHECK (transferability_basis IS NULL OR transferability_basis IN ('verified','inferred')),
  transferable_on_coc TEXT CHECK (transferable_on_coc IS NULL OR transferable_on_coc IN ('yes','no')),
  transferability_evidence_ref TEXT,
  load_bearing INTEGER NOT NULL DEFAULT 0 CHECK (load_bearing IN (0,1)),
  confirmed_at TEXT
);
INSERT INTO certification_constrained (id, project_id, name, agency, statutory_days, status, transferability_basis, transferable_on_coc, transferability_evidence_ref, load_bearing, confirmed_at)
  SELECT id, project_id, name, agency, statutory_days, status, transferability_basis, transferable_on_coc, transferability_evidence_ref, load_bearing, confirmed_at FROM certification;
DROP TABLE certification;
ALTER TABLE certification_constrained RENAME TO certification;
CREATE INDEX idx_certification_project ON certification(project_id);

-- D-M-TE-5 prerequisite companion decision: permit.status five-member
-- vocabulary, default 'not_started' ("unresolved" = not_started|in_progress).
CREATE TABLE permit_constrained (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  name TEXT NOT NULL,
  agency TEXT,
  statutory_days INTEGER,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','granted','denied','withdrawn'))
);
INSERT INTO permit_constrained (id, project_id, name, agency, statutory_days, status)
  SELECT id, project_id, name, agency, statutory_days, status FROM permit;
DROP TABLE permit;
ALTER TABLE permit_constrained RENAME TO permit;
CREATE INDEX idx_permit_project ON permit(project_id);

-- D-M-RISK-3: partner_candidate.status six values (default 'sourcing' — a
-- longlist entry, NOT the active set); dependency_risk {high, medium, low,
-- none} — the 'none' member is load-bearing (a no-partner-dependency project
-- writes 'none' so the rule is determinately FALSE, never forever-UNASSESSED).
CREATE TABLE partner_candidate_constrained (
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
  dependency_risk TEXT CHECK (dependency_risk IS NULL OR dependency_risk IN ('high','medium','low','none')),
  status TEXT NOT NULL DEFAULT 'sourcing' CHECK (status IN ('sourcing','contacted','in_negotiation','signed','withdrawn','rejected')),
  contacted_at TEXT,
  nda_signed INTEGER NOT NULL DEFAULT 0,
  evidence_ref TEXT
);
INSERT INTO partner_candidate_constrained (id, project_id, name, partner_type, region_code, capability_score, capacity_score, financial_score, compliance_risk, customer_base_fit, dependency_risk, status, contacted_at, nda_signed, evidence_ref)
  SELECT id, project_id, name, partner_type, region_code, capability_score, capacity_score, financial_score, compliance_risk, customer_base_fit, dependency_risk, status, contacted_at, nda_signed, evidence_ref FROM partner_candidate;
DROP TABLE partner_candidate;
ALTER TABLE partner_candidate_constrained RENAME TO partner_candidate;
CREATE INDEX idx_partner_candidate_project ON partner_candidate(project_id);

-- ── (b) evidence_var seed — 1 row (D-M-TE-8) ──────────────────────────────
-- The load-bearing count var the D-M-TE-4 definitional Red rule reads; same
-- all-computed / requires_evidence_ref=0 / fixed-literal conventions as the
-- 0018 seed set (provenance flows through the source query).

INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('cert.load_bearing_non_transferable_on_coc', 'COC 시 이전불가 사업핵심 인증 수', 'number', 'count', 'computed', 0, '2026-08-23T00:00:00Z');

-- ── (c) rag_rule finalization — records' mapping tables, verbatim ─────────
-- Staged rows updated in place (version stays 1): every _threshold_placeholder
-- scalar replaced by the records' numbers/memberships, the schema-forced
-- degenerate integers re-decided (partner lte 0→lte 1), grades restated
-- (covenant amber→red; right-to-win amber→green), priorities restated
-- (D-M-RISK-4 layer 2: Red before Amber within a dimension; D-M-TE-8 1–7),
-- and the partner gate restated dd→pre_fs (D-M-RISK-3). condition_expr JSON
-- strings are copied character-for-character from the records.

UPDATE rag_rule SET condition_expr = '{"op":"all_of","of":[{"op":"cmp","var":"market.bargaining_power_hhi","cmp":"gte","value":0.25},{"op":"cmp","var":"market.link_fit_quality","cmp":"gte","value":0.6}]}', grade = 'amber', priority = 1, stage_gate = 'dd' WHERE rule_key = 'market-dd-bargaining-power';
UPDATE rag_rule SET condition_expr = '{"op":"all_of","of":[{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.05},{"op":"in","var":"market.entry_barrier","values":["none","low"]},{"op":"cmp","var":"market.top3_share","cmp":"gte","value":0.5}]}', grade = 'amber', priority = 2, stage_gate = 'dd' WHERE rule_key = 'market-dd-competitive-demerit';
UPDATE rag_rule SET condition_expr = '{"op":"in","var":"market.switching_cost_grade","values":["negligible","low"]}', grade = 'amber', priority = 3, stage_gate = 'dd' WHERE rule_key = 'market-dd-switching-cost';
UPDATE rag_rule SET condition_expr = '{"op":"any_of","of":[{"op":"cmp","var":"market.tam","cmp":"lt","value":100000000000,"unit":"krw"},{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.02,"unit":"ratio"}]}', grade = 'amber', priority = 4, stage_gate = 'dd' WHERE rule_key = 'market-dd-tam-growth';
-- D-M-MKT-10.1: re-graded amber→green — a MERIT condition; activates only
-- post-calibration (stays enabled=0 here, per the Decision 9 Green cap).
UPDATE rag_rule SET condition_expr = '{"op":"at_least","k":2,"of":[{"op":"cmp","var":"right_to_win.customer_overlap","cmp":"gte","value":3},{"op":"cmp","var":"right_to_win.tech_overlap","cmp":"gte","value":3},{"op":"cmp","var":"right_to_win.brand_transferability","cmp":"gte","value":3}]}', grade = 'green', priority = 5, stage_gate = 'dd' WHERE rule_key = 'market-dd-right-to-win';

UPDATE rag_rule SET condition_expr = '{"op":"count","var":"risk.covenants_breached","cmp":"gte","value":1}', grade = 'red', priority = 5, stage_gate = 'dd' WHERE rule_key = 'risk-dd-covenant-breach';
UPDATE rag_rule SET condition_expr = '{"op":"cmp","var":"risk.contingent_expected_value","cmp":"gte","value":10000000000,"unit":"krw"}', grade = 'amber', priority = 6, stage_gate = 'dd' WHERE rule_key = 'risk-dd-contingent-expected-value';
UPDATE rag_rule SET condition_expr = '{"op":"all_of","of":[{"op":"cmp","var":"risk.contingent_max_amount","cmp":"gte","value":30000000000,"unit":"krw"},{"op":"cmp","var":"risk.contingent_max_probability","cmp":"gte","value":0.5,"unit":"ratio"}]}', grade = 'amber', priority = 7, stage_gate = 'dd' WHERE rule_key = 'risk-dd-contingent-two-factor';
-- D-M-RISK-3: gate restated dd→pre_fs (signal before DD spend, per ADR-0031).
UPDATE rag_rule SET condition_expr = '{"op":"all_of","of":[{"op":"count","var":"risk.partner_candidates_active","cmp":"lte","value":1},{"op":"in","var":"risk.partner_dependency_risk","values":["high"]}]}', grade = 'amber', priority = 8, stage_gate = 'pre_fs' WHERE rule_key = 'risk-dd-partner-sourcing';

UPDATE rag_rule SET condition_expr = '{"op":"in","var":"tech.trl_grade","values":["TRL4","TRL5"]}', grade = 'amber', priority = 2, stage_gate = 'dd' WHERE rule_key = 'tech-dd-trl-grade';
UPDATE rag_rule SET condition_expr = '{"op":"any_of","of":[{"op":"in","var":"tech.ip_ownership_status","values":["owned_by_originator","licensed_in","jointly_owned"]},{"op":"is_null","var":"tech.ip_ownership_status"}]}', grade = 'amber', priority = 4, stage_gate = 'dd' WHERE rule_key = 'tech-dd-ip-clarity';
-- expr unchanged from the staged gte 1 (D-M-TE-8 row 6 "(unchanged from
-- staged)"); only the priority restated 3→6 (Red-before-Amber within the axis).
UPDATE rag_rule SET condition_expr = '{"op":"count","var":"cert.non_transferable_on_coc","cmp":"gte","value":1}', grade = 'amber', priority = 6, stage_gate = 'dd' WHERE rule_key = 'tech-dd-cert-transferability';
UPDATE rag_rule SET condition_expr = '{"op":"any_of","of":[{"op":"cmp","var":"permit.critical_path_duration","cmp":"gt","value":18,"unit":"months"},{"op":"count","var":"permit.unresolved_on_critical_path","cmp":"gte","value":1}]}', grade = 'amber', priority = 7, stage_gate = 'dd' WHERE rule_key = 'tech-dd-permit-critical-path';

INSERT INTO rag_rule (id, rule_key, version, stage_gate, dimension, grade, condition_expr, priority, enabled, policy_id, thresholds_source, created_at) VALUES
  ('rule-0019-market-screening-tam-growth', 'market-screening-tam-growth', 1, 'screening', 'market', 'amber', '{"op":"any_of","of":[{"op":"cmp","var":"market.tam","cmp":"lt","value":100000000000,"unit":"krw"},{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.02,"unit":"ratio"}]}', 1, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0019-market-pre-fs-tam-growth', 'market-pre-fs-tam-growth', 1, 'pre_fs', 'market', 'amber', '{"op":"any_of","of":[{"op":"cmp","var":"market.tam","cmp":"lt","value":100000000000,"unit":"krw"},{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.02,"unit":"ratio"}]}', 1, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0019-market-dd-right-to-win-absent', 'market-dd-right-to-win-absent', 1, 'dd', 'market', 'amber', '{"op":"all_of","of":[{"op":"cmp","var":"right_to_win.customer_overlap","cmp":"lt","value":2},{"op":"cmp","var":"right_to_win.tech_overlap","cmp":"lt","value":2},{"op":"cmp","var":"right_to_win.brand_transferability","cmp":"lt","value":2}]}', 6, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0019-tech-dd-trl-pre-validation', 'tech-dd-trl-pre-validation', 1, 'dd', 'technical_execution', 'red', '{"op":"in","var":"tech.trl_grade","values":["TRL1","TRL2","TRL3"]}', 1, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0019-tech-dd-ip-disputed', 'tech-dd-ip-disputed', 1, 'dd', 'technical_execution', 'red', '{"op":"in","var":"tech.ip_ownership_status","values":["disputed"]}', 3, 0, NULL, NULL, '2026-08-23T00:00:00Z'),
  ('rule-0019-tech-dd-cert-load-bearing-loss', 'tech-dd-cert-load-bearing-loss', 1, 'dd', 'technical_execution', 'red', '{"op":"count","var":"cert.load_bearing_non_transferable_on_coc","cmp":"gte","value":1}', 5, 0, NULL, NULL, '2026-08-23T00:00:00Z');

INSERT INTO rag_rule_variable (rule_id, var_key) VALUES
  ('rule-0019-market-screening-tam-growth', 'market.tam'),
  ('rule-0019-market-screening-tam-growth', 'market.growth_rate'),
  ('rule-0019-market-pre-fs-tam-growth', 'market.tam'),
  ('rule-0019-market-pre-fs-tam-growth', 'market.growth_rate'),
  ('rule-0019-market-dd-right-to-win-absent', 'right_to_win.customer_overlap'),
  ('rule-0019-market-dd-right-to-win-absent', 'right_to_win.tech_overlap'),
  ('rule-0019-market-dd-right-to-win-absent', 'right_to_win.brand_transferability'),
  ('rule-0019-tech-dd-trl-pre-validation', 'tech.trl_grade'),
  ('rule-0019-tech-dd-ip-disputed', 'tech.ip_ownership_status'),
  ('rule-0019-tech-dd-cert-load-bearing-loss', 'cert.load_bearing_non_transferable_on_coc');
