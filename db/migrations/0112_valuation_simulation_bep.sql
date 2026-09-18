-- 0112_valuation_simulation_bep.sql
-- @version 1.0.0
-- @reversible: false — nullable additive columns; dropping them would discard
--   persisted BEP facts (design 2026-09-18-s8-business-case-evaluation
--   REQ-W3-2).
--
-- BEP metrics land on the p50 row (design REQ-W3-1/2):
--   bep_year                 — first year cumulative discounted FCF crosses
--                              zero on the deterministic path (fractional;
--                              NULL when the horizon ends first);
--   bep_volume               — annual fixed cost / unit contribution margin
--                              (NULL when the case has no unit economics);
--   payback_discounted_years — the same crossing as bep_year, kept as its own
--                              column because finance reads it as payback
--                              while the business plan reads it as the BEP
--                              schedule point.
-- Existing rows keep NULL = "not computed"; regeneration fills them.
ALTER TABLE valuation_simulation ADD COLUMN bep_year REAL;
ALTER TABLE valuation_simulation ADD COLUMN bep_volume REAL;
ALTER TABLE valuation_simulation ADD COLUMN payback_discounted_years REAL;
