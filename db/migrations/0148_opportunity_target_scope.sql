-- ADR-0179 slice 1: structured target scope on the promoting opportunity.
-- A person (analyst+) records the scope the deal actually addresses — regions
-- (fixed enum), segments (free tags) and the unit basis — so later slices can
-- compare it against the market-sizing anchor. Additive and NULL by default:
-- opportunities without a scope keep every existing behavior byte-identical.
-- NEVER backfilled; legacy rows stay NULL on purpose.

-- @reversible: true
-- ROLLBACK-SQL-BEGIN
-- SQLite cannot drop a column with a CHECK in older builds without a table
-- rebuild; the column is additive and nullable, so rollback recreates the
-- table without the column.
-- ROLLBACK-SQL-END

ALTER TABLE opportunity ADD COLUMN target_scope_json TEXT CHECK (target_scope_json IS NULL OR json_valid(target_scope_json) = 1);
