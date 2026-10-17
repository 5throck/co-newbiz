-- ADR-0181 follow-up (2026-10-18): the S1 analysis declares the market-size
-- UNIT at analysis time. NULL = the pipeline convention (usd_b_year - the S1
-- UI renders anchor totals as $B, formatUsdBOrNa); a person may correct the
-- declaration per analysis (e.g. usd_m_year, krw_m_year). The declaration is
-- statement metadata about the analysis - estimation data is never touched.
-- The declared unit flows into every new version's payload scope at run time
-- and into the unit resolution chain (target scope -> analysis -> convention).

-- @reversible: true
-- ROLLBACK-SQL-BEGIN
-- SQLite cannot drop a column with a CHECK in older builds without a table
-- rebuild; the column is additive and nullable, so rollback recreates the
-- table without the column.
-- ROLLBACK-SQL-END

ALTER TABLE market_sizing_analysis ADD COLUMN unit_basis TEXT CHECK (unit_basis IS NULL OR (length(unit_basis) <= 32 AND unit_basis = lower(unit_basis)));
