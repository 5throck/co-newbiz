-- ADR-0179 amendment slice B (2026-10-17): the S2 entry-market derivation
-- surface. The ratio-factor chain (design §12.2) over the LINKED S1 series
-- lives in a payload document on the opportunity — the same pattern as
-- target_scope_json (slice 1): lineage in a payload, no separate table, the
-- derived value is always COMPUTED (S1 anchor x product of factors at the
-- pinned version's year-1 baseline) and never stored as an input. Additive
-- and NULL by default: NULL = no derivation chain, every existing behavior
-- byte-identical (the bare market_size_krw_m copy stays the legacy compat
-- path). NEVER backfilled; a person (analyst+) writes the chain through the
-- human-only entry-market-derivation route — agents never write it.

-- @reversible: true
-- ROLLBACK-SQL-BEGIN
-- SQLite cannot drop a column with a CHECK in older builds without a table
-- rebuild; the column is additive and nullable, so rollback recreates the
-- table without the column.
-- ROLLBACK-SQL-END

ALTER TABLE opportunity ADD COLUMN entry_market_derivation_json TEXT CHECK (entry_market_derivation_json IS NULL OR json_valid(entry_market_derivation_json) = 1);
