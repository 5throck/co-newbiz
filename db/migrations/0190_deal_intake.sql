-- @reversible: true (purely additive: one new table and two indexes; no backfill; no existing table altered.
-- Rollback: the ROLLBACK-SQL block below (DROP TABLE) after the pre-migration backup per ADR-0014. Intake rows
-- recorded after this migration are lost with the table on rollback.)
-- ROLLBACK-SQL-BEGIN
--   DROP TABLE deal_intake;
-- ROLLBACK-SQL-END
--
-- 0190_deal_intake.sql
-- Client-request intake record (design 2026-11-11-owner-decisions-intake-batch §3):
-- a first-class record of WHO asked for this deal and through which board entry,
-- created at board-CTA time and linked to the opportunity once S2 creates it.
-- opportunity_id is NULLABLE on purpose — the intake precedes the deal, and an
-- abandoned intake stays as the honest record that a request was made and no
-- deal resulted.
CREATE TABLE deal_intake (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT REFERENCES opportunity(id),
  source TEXT NOT NULL CHECK (source IN ('board_new_deal', 'board_known_target')),
  requested_by TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_deal_intake_opportunity ON deal_intake(opportunity_id);
CREATE INDEX idx_deal_intake_created ON deal_intake(created_at);
