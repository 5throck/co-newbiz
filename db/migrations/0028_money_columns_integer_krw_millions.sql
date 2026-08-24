-- 0028_money_columns_integer_krw_millions.sql
-- @version 1.0.0
-- @reversible: false (ROUND(x*1e6) loses sub-million precision — a restored
-- pre-migration backup is the only faithful reverse; joint release-engineer
-- + dba sign-off required per ADR-0014)
--
-- ADR-0061 EXECUTION — schema debt F-3 corrected. Storage convention of
-- record for monetary quantities: INTEGER, unit = KRW millions (user decision
-- 2026-08-24; "KRW 백만원 기준"). FX-exposed amounts convert upstream via
-- fx_policy before storage.
--
-- Rebuild pattern = 0019's table-rebuild (create-new → INSERT..SELECT with an
-- explicit scale conversion CAST(ROUND(old * 1000000) AS INTEGER) → DROP old
-- → RENAME → indexes recreated verbatim). Legacy REAL values are interpreted
-- as raw won; production tables were empty (prototype), so the conversion is
-- future-proofing rather than live-data surgery.
--
-- Deliberately NOT converted (stay REAL — ratios/indexes/scores, per
-- ADR-0061's exclusion table): covenant_test.threshold/projected_value (DSCR-
-- style ratios — correcting ADR-0061's draft table, which had listed them),
-- antitrust_finding.hhi_before/after, benefit_item target_value/acquirer_value/
-- per_capita_delta/harmonization_cost, all *_score / labor_availability,
-- probability / discount_rate / rate.
--
-- Unit-boundary duties this migration pairs with (same release window, F-14):
--   snapshot-filler contingent family multiplies storage by 1e6 so the pinned
--   raw-won rule constants (0019/gd-0022-risk-thresholds) stay untouched;
--   db/lib/simulation.ts composes engine scenarios in raw won and persists
--   engine quantiles ÷1e6 back into these INTEGER columns.

-- ── contingent_liability ────────────────────────────────────────────────
CREATE TABLE contingent_liability_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  category TEXT NOT NULL,
  description TEXT,
  probability REAL NOT NULL CHECK (probability >= 0 AND probability <= 1),
  amount_low INTEGER NOT NULL,
  amount_expected INTEGER NOT NULL,
  amount_high INTEGER NOT NULL,
  distribution TEXT NOT NULL DEFAULT 'triangular' CHECK (distribution IN ('triangular')),
  expected_timing_year INTEGER NOT NULL DEFAULT 0,
  evidence_ref TEXT,
  value_impact INTEGER,
  CHECK (amount_low <= amount_expected AND amount_expected <= amount_high)
);
INSERT INTO contingent_liability_new SELECT id, project_id, category, description, probability,
  CAST(ROUND(amount_low*1000000) AS INTEGER), CAST(ROUND(amount_expected*1000000) AS INTEGER),
  CAST(ROUND(amount_high*1000000) AS INTEGER), distribution, expected_timing_year, evidence_ref,
  CASE WHEN value_impact IS NULL THEN NULL ELSE CAST(ROUND(value_impact*1000000) AS INTEGER) END
FROM contingent_liability;
DROP TABLE contingent_liability;
ALTER TABLE contingent_liability_new RENAME TO contingent_liability;
CREATE INDEX idx_contingent_liability_project ON contingent_liability(project_id);

-- ── simulation_result / simulation_draw stay REAL: engine-native units are
--    the §12 reproducibility contract (CLI-parity test pins exact quantiles);
--    ADR-0064 execution note records this scope narrowing.

-- ── dd_finding ──────────────────────────────────────────────────────────
-- ── dd_finding — carries 0019's enum CHECKs forward verbatim (a rebuild
--    that dropped them would silently loosen D-M-TE-1's vocabulary) ────────
CREATE TABLE dd_finding_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  value_impact INTEGER,
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
INSERT INTO dd_finding_new SELECT id, project_id, category, description,
  CASE WHEN value_impact IS NULL THEN NULL ELSE CAST(ROUND(value_impact*1000000) AS INTEGER) END,
  assumption_key, evidence_ref, trl_grade, ip_ownership_status, commercialization_path,
  parent_relationship_json, rbd_source, created_at
FROM dd_finding;
DROP TABLE dd_finding;
ALTER TABLE dd_finding_new RENAME TO dd_finding;
CREATE INDEX idx_dd_finding_project ON dd_finding(project_id);

-- ── benefit_item — NO money columns exist in its 0011 DDL (target/acquirer/
--    per_capita/harmonization stay REAL per ADR-0061's exclusions); ADR-0061's
--    draft table listed a value_impact here erroneously. Nothing to convert;
--    the table is left untouched. ──────────────────────────────────────────

-- ── debt_instrument (principal only; rate stays REAL) ───────────────────
CREATE TABLE debt_instrument_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  lender TEXT,
  principal INTEGER NOT NULL,
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
INSERT INTO debt_instrument_new SELECT id, project_id, lender,
  CAST(ROUND(principal*1000000) AS INTEGER), currency_id, rate_type, rate,
  maturity, amortization, covenant_json, coc_acceleration, security, seniority
FROM debt_instrument;
DROP TABLE debt_instrument;
ALTER TABLE debt_instrument_new RENAME TO debt_instrument;
CREATE INDEX idx_debt_instrument_project ON debt_instrument(project_id);

-- ── incentive ───────────────────────────────────────────────────────────
CREATE TABLE incentive_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  site_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('prospective', 'granted')),
  type TEXT NOT NULL,
  grantor TEXT,
  program_name TEXT,
  amount INTEGER,
  npv_value INTEGER,
  currency_id TEXT REFERENCES md_currency(id),
  granted_on TEXT,
  application_deadline TEXT,
  construction_deadline TEXT,
  obligation_json TEXT,
  clawback_rule TEXT,
  estimated_clawback INTEGER,
  negotiability TEXT,
  status TEXT NOT NULL DEFAULT 'prospective',
  evidence_ref TEXT
);
INSERT INTO incentive_new SELECT id, project_id, site_id, direction, type, grantor, program_name,
  CASE WHEN amount IS NULL THEN NULL ELSE CAST(ROUND(amount*1000000) AS INTEGER) END,
  CASE WHEN npv_value IS NULL THEN NULL ELSE CAST(ROUND(npv_value*1000000) AS INTEGER) END,
  currency_id, granted_on, application_deadline, construction_deadline, obligation_json,
  clawback_rule,
  CASE WHEN estimated_clawback IS NULL THEN NULL ELSE CAST(ROUND(estimated_clawback*1000000) AS INTEGER) END,
  negotiability, status, evidence_ref
FROM incentive;
DROP TABLE incentive;
ALTER TABLE incentive_new RENAME TO incentive;
CREATE INDEX idx_incentive_project ON incentive(project_id);

-- ── site_candidate (capex/npv/logistics only; scores stay REAL) ─────────
CREATE TABLE site_candidate_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  name TEXT NOT NULL,
  region_code TEXT,
  infra_score REAL,
  infra_capex INTEGER,
  incentive_npv INTEGER,
  logistics_cost INTEGER,
  labor_availability REAL,
  permit_lead_time_days INTEGER,
  affected_area_notification_status TEXT,
  total_score REAL,
  rank INTEGER
);
INSERT INTO site_candidate_new SELECT id, project_id, name, region_code, infra_score,
  CASE WHEN infra_capex IS NULL THEN NULL ELSE CAST(ROUND(infra_capex*1000000) AS INTEGER) END,
  CASE WHEN incentive_npv IS NULL THEN NULL ELSE CAST(ROUND(incentive_npv*1000000) AS INTEGER) END,
  CASE WHEN logistics_cost IS NULL THEN NULL ELSE CAST(ROUND(logistics_cost*1000000) AS INTEGER) END,
  labor_availability, permit_lead_time_days, affected_area_notification_status, total_score, rank
FROM site_candidate;
DROP TABLE site_candidate;
ALTER TABLE site_candidate_new RENAME TO site_candidate;
CREATE INDEX idx_site_candidate_project ON site_candidate(project_id);
