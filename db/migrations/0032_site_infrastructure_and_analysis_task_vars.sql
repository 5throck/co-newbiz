-- 0032_site_infrastructure_and_analysis_task_vars.sql
-- @version 1.0.0
-- @reversible: true (ALTER ADD COLUMN with NULL-safe defaults + pure INSERT
-- seeds; reversal drops the five columns and deletes the three var rows,
-- backup-first per ADR-0014)
--
-- ADR-0068 — kill-criteria extension round 5 (site infrastructure +
-- analysis_task review plane). Unblocks entries #20/#23/#26 per the
-- disposition doc's design-ready routing:
--
--   site_candidate gains four capacity-sufficiency flags plus a mitigation
--   marker (all NULLable — a site whose infrastructure assessment hasn't run
--   stays honestly unassessed rather than defaulted):
--     wastewater_capacity_sufficient / power_capacity_sufficient /
--     industrial_water_sufficient / logistics_access_sufficient /
--     infrastructure_mitigation_documented
--
--   evidence_var seeds (computed, requires_evidence_ref=0 — 0017 convention):
--     deliverables.required_unreviewed      #20  count of analysis_task rows
--                                           awaiting cross-domain review
--     infra.wastewater_insufficient_no_mitigation  #23  count of sites where
--                                           capacity insufficient AND no
--                                           documented mitigation
--     infra.sites_clearing_minimums         #26  count of sites clearing ALL
--                                           four minimums

ALTER TABLE site_candidate ADD COLUMN wastewater_capacity_sufficient INTEGER CHECK (wastewater_capacity_sufficient IN (0, 1));
ALTER TABLE site_candidate ADD COLUMN power_capacity_sufficient INTEGER CHECK (power_capacity_sufficient IN (0, 1));
ALTER TABLE site_candidate ADD COLUMN industrial_water_sufficient INTEGER CHECK (industrial_water_sufficient IN (0, 1));
ALTER TABLE site_candidate ADD COLUMN logistics_access_sufficient INTEGER CHECK (logistics_access_sufficient IN (0, 1));
ALTER TABLE site_candidate ADD COLUMN infrastructure_mitigation_documented INTEGER CHECK (infrastructure_mitigation_documented IN (0, 1));

INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES
  ('deliverables.required_unreviewed', '검토 대기 필수 산출물 수', 'number', 'count', 'computed', 0, '2026-08-25T00:00:00Z'),
  ('infra.wastewater_insufficient_no_mitigation', '배수용량 미흡·완화 미문서 부지 수', 'number', 'count', 'computed', 0, '2026-08-25T00:00:00Z'),
  ('infra.sites_clearing_minimums', '인프라 최소기준 충족 부지 수', 'number', 'count', 'computed', 0, '2026-08-25T00:00:00Z');
