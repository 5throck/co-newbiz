-- @reversible: true (purely additive: one new table and one index; no backfill; no existing table altered.
-- Rollback: the ROLLBACK-SQL block below (DROP TABLE) after the pre-migration backup per ADR-0014. Ignore events
-- recorded after this migration are lost with the table on rollback.)
-- ROLLBACK-SQL-BEGIN
--   DROP TABLE brownfield_target_proposal_ignore;
-- ROLLBACK-SQL-END
--
-- 0192_target_proposal_ignore.sql
-- Brownfield S6/S7 target-proposal ignore events (design
-- 2026-11-13-proposal-ignore-suppression, DEC-20261113-04): the proposal-card
-- 무시 gesture becomes a persisted event, not a UI-only filter. One row per
-- ignore click; a candidate is suppressed from BOTH proposal surfaces
-- (web-search POST and master-proposals GET) once its company_key has
-- >= PROPOSAL_IGNORE_SUPPRESS_THRESHOLD (2) rows for the opportunity.
-- Append-only by design (ADR-0012 audit-family precedent): NO unique
-- constraint on (opportunity_id, company_key) — the user's rule counts ignore
-- EVENTS, so repeated ignores accumulate rows and count = row count; no
-- UPDATE, no DELETE in application code (un-ignore is a manual DB op).
CREATE TABLE brownfield_target_proposal_ignore (
  id TEXT PRIMARY KEY NOT NULL,                       -- ulid (db/lib/ulid.ts, house style)
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  company_name_raw TEXT NOT NULL,                     -- exactly what the card showed
  company_key TEXT NOT NULL,                          -- companyKey(company_name_raw) — name-similarity.ts
  ignored_by TEXT NOT NULL,                           -- app_user.id of the clicking analyst
  created_at TEXT NOT NULL                            -- ISO 8601, same convention as audit_log
);
CREATE INDEX idx_btpi_opp_key ON brownfield_target_proposal_ignore(opportunity_id, company_key);
