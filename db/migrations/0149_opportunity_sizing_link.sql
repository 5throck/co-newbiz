-- ADR-0179 amendment slice A (2026-10-17): explicit opportunity -> S1
-- market-sizing link (OPEN-3 pulled forward). The opportunity references its
-- S1 sizing analysis and the PINNED version whose declared scope becomes the
-- anchor's scope by construction (design §12.1). Additive and NULL by
-- default: NULL = unlinked, every existing behavior byte-identical. The bare
-- market_size_krw_m copy stays the legacy compat path. NEVER backfilled;
-- a person (analyst+) sets/clears the link through the human-only
-- sizing-link route — agents never write it.

-- @reversible: true
-- ROLLBACK-SQL-BEGIN
-- SQLite cannot drop columns with a CHECK/FK without a table rebuild; the
-- columns are additive and nullable, so rollback recreates the table without
-- them.
-- ROLLBACK-SQL-END

ALTER TABLE opportunity ADD COLUMN sizing_analysis_id TEXT REFERENCES market_sizing_analysis(id);
ALTER TABLE opportunity ADD COLUMN sizing_version_id TEXT REFERENCES market_sizing_version(id);
-- Both-or-neither (a half-link is never stored) is enforced by the
-- sizing-link route: SQLite cannot add a table-level CHECK via ALTER TABLE,
-- so the constraint lives in the write path and is asserted in tests.
