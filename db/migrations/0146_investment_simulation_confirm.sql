-- 0146_investment_simulation_confirm.sql
-- @reversible: true (purely additive - three nullable columns and one partial index on
-- investment_simulation_run; no existing column or row changes, so every run stored by 0144 stays
-- unconfirmed and therefore invisible to S8. Manual rollback: the statements in ROLLBACK-SQL below
-- (ALTER TABLE ... DROP COLUMN needs SQLite 3.35+; otherwise restore the pre-migration backup,
-- scripts/co-newbiz/restore.ts, ADR-0014). Code rollback: revert the PR. ADR-0176 slice 3.
-- Number 0145 is reserved by a parallel Brown Field change.)
-- ROLLBACK-SQL-BEGIN
--   DROP INDEX idx_isr_confirmed;
--   ALTER TABLE investment_simulation_run DROP COLUMN confirm_audit_id;
--   ALTER TABLE investment_simulation_run DROP COLUMN confirmed_at;
--   ALTER TABLE investment_simulation_run DROP COLUMN confirmed_by;
-- ROLLBACK-SQL-END
--
-- ADR-0176 slice 3 - human confirmation of an S5 investment simulation run (Decision 5 / 7: S8
-- consumes only the latest CONFIRMED run). confirmed_at IS NULL means "not confirmed"; the
-- confirmation is a person's act (human-only route, audited as investment_simulation.confirmed) and
-- is never set by an agent or MCP path. A run keeps its confirmation when a newer run supersedes it;
-- S8 reads the most recent confirmed run, so an unconfirmed re-run never silently revokes it.
ALTER TABLE investment_simulation_run ADD COLUMN confirmed_by TEXT;
ALTER TABLE investment_simulation_run ADD COLUMN confirmed_at TEXT;
ALTER TABLE investment_simulation_run ADD COLUMN confirm_audit_id TEXT;
CREATE INDEX idx_isr_confirmed ON investment_simulation_run(opportunity_id, confirmed_at DESC) WHERE confirmed_at IS NOT NULL;
