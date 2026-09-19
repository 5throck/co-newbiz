-- 0111_business_case_sales_plan.sql
-- @version 1.0.0
-- @reversible: false — nullable additive columns; dropping them would discard
--   manually entered sales-plan detail (design 2026-09-18-s8-business-case-
--   evaluation REQ-W1-1).
--
-- Annual sales-plan decomposition on business_case_line (design REQ-W1-1):
-- revenue = sales_volume x unit_price_krw when both are known; both stay
-- NULL when only the annual amount is known (the generated S8 lines carry no
-- price source yet, so generation writes NULL and manual entry fills them).
-- No backfill: existing rows keep NULL, which reads as "annual amount only".
ALTER TABLE business_case_line ADD COLUMN sales_volume REAL;
ALTER TABLE business_case_line ADD COLUMN unit_price_krw REAL;
