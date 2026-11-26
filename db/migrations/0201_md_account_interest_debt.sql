-- @reversible: true (additive seed of 11 md_account rows plus a freshness-cache reset; no existing row is altered or
-- removed. Rollback: the ROLLBACK-SQL block below after the pre-migration backup per ADR-0014. It deletes the
-- fact_financial rows written for the new accounts and then the account rows. The freshness reset of
-- dart_corp_sync_state is not undone: it only makes the next incremental sync re-check the latest year, which is
-- harmless.)
-- ROLLBACK-SQL-BEGIN
--   DELETE FROM fact_financial WHERE account_id IN (SELECT id FROM md_account WHERE ifrs_code IN ('ifrs-full_ProfitLossBeforeTax', 'dart_AdjustmentsForInterestExpenses', 'ifrs-full_InterestExpense', 'ifrs-full_FinanceCosts', 'ifrs-full_InterestPaidClassifiedAsOperatingActivities', 'ifrs-full_InterestPaidClassifiedAsFinancingActivities', 'conewbiz_ShortTermBorrowings', 'conewbiz_LongTermBorrowings', 'conewbiz_CurrentPortionOfLongTermDebt', 'conewbiz_BondsIssued', 'conewbiz_LeaseLiabilities'));
--   DELETE FROM md_account WHERE ifrs_code IN ('ifrs-full_ProfitLossBeforeTax', 'dart_AdjustmentsForInterestExpenses', 'ifrs-full_InterestExpense', 'ifrs-full_FinanceCosts', 'ifrs-full_InterestPaidClassifiedAsOperatingActivities', 'ifrs-full_InterestPaidClassifiedAsFinancingActivities', 'conewbiz_ShortTermBorrowings', 'conewbiz_LongTermBorrowings', 'conewbiz_CurrentPortionOfLongTermDebt', 'conewbiz_BondsIssued', 'conewbiz_LeaseLiabilities');
-- ROLLBACK-SQL-END
--
-- 0201_md_account_interest_debt.sql
-- ADR-0208 (design 2026-11-26-wacc-credit-rating-spread section 8.3, slice 3): the DART collector extension
-- (app/web-next/lib/dart-client.ts, db/lib/dart-financial-accounts.ts) stores six id-keyed income and cash-flow
-- accounts and five borrowing classes. The fact_financial writer resolves an account by ifrs_code and fails loudly on a
-- missing row (it never invents an account), so these rows must exist before the collector release (ADR-0014 order).
--
--   id-keyed (the DART account_id is the stable key; ifrs_code = that id):
--     ifrs-full_ProfitLossBeforeTax                              pre-tax income; ADR-0207's tax-rate suggestion already
--                                                                prefers it over operating income
--     dart_AdjustmentsForInterestExpenses / ifrs-full_InterestExpense   interest expense (cash-flow add-back / income statement)
--     ifrs-full_FinanceCosts                                     finance costs (includes FX and derivative losses:
--                                                                an overstating proxy for interest)
--     ifrs-full_InterestPaidClassifiedAs{Operating,Financing}Activities   interest paid: two rows that carry the SAME
--                                                                account name in the filing, kept as two accounts and
--                                                                summed at read time
--   name-pattern classes (balance-sheet rows have no stable standard code, and filers name them differently, so the
--   collector sums the matching rows into one fact per class; the ifrs_code below is a project key, not an IFRS element):
--     conewbiz_ShortTermBorrowings, conewbiz_LongTermBorrowings, conewbiz_CurrentPortionOfLongTermDebt,
--     conewbiz_BondsIssued, conewbiz_LeaseLiabilities
--
-- Values stay raw KRW as filed (the fact_financial convention); display and the cross-check convert.
INSERT OR IGNORE INTO md_account (id, ifrs_code, name_ko, name_en, created_at) VALUES
  ('01KMDACC1PRETAX00000000000', 'ifrs-full_ProfitLossBeforeTax', '세전이익', 'Profit before tax', '2026-11-26T00:00:00Z'),
  ('01KMDACC1INTEXPADJ00000000', 'dart_AdjustmentsForInterestExpenses', '이자비용', 'Interest expense (cash-flow adjustment)', '2026-11-26T00:00:00Z'),
  ('01KMDACC1INTEXPIS000000000', 'ifrs-full_InterestExpense', '이자비용(손익)', 'Interest expense (income statement)', '2026-11-26T00:00:00Z'),
  ('01KMDACC1FINCOSTS000000000', 'ifrs-full_FinanceCosts', '금융비용', 'Finance costs', '2026-11-26T00:00:00Z'),
  ('01KMDACC1INTPAIDOP00000000', 'ifrs-full_InterestPaidClassifiedAsOperatingActivities', '이자지급(영업활동)', 'Interest paid (operating activities)', '2026-11-26T00:00:00Z'),
  ('01KMDACC1INTPAIDFIN0000000', 'ifrs-full_InterestPaidClassifiedAsFinancingActivities', '이자지급(재무활동)', 'Interest paid (financing activities)', '2026-11-26T00:00:00Z'),
  ('01KMDACC1BSHORT00000000000', 'conewbiz_ShortTermBorrowings', '단기차입금', 'Short-term borrowings (sum of matching balance-sheet rows)', '2026-11-26T00:00:00Z'),
  ('01KMDACC1BLONG000000000000', 'conewbiz_LongTermBorrowings', '장기차입금', 'Long-term and other borrowings (sum of matching balance-sheet rows)', '2026-11-26T00:00:00Z'),
  ('01KMDACC1BCURLTD0000000000', 'conewbiz_CurrentPortionOfLongTermDebt', '유동성장기부채', 'Current portion of long-term debt', '2026-11-26T00:00:00Z'),
  ('01KMDACC1BBONDS00000000000', 'conewbiz_BondsIssued', '사채', 'Bonds issued (sum of matching balance-sheet rows)', '2026-11-26T00:00:00Z'),
  ('01KMDACC1BLEASE00000000000', 'conewbiz_LeaseLiabilities', '리스부채', 'Lease liabilities (sum of matching balance-sheet rows)', '2026-11-26T00:00:00Z');

-- One-time re-sync (ADR-0199 incremental logic, confirmed against db/repositories/dart-evidence-cache.repository.ts and
-- app/web-next/lib/dart-financial-facts.ts): an incremental sync fetches the missing years, the latest year and the years
-- a corrected report re-flagged, and only when the freshness window has lapsed. Clearing financial_checked_at lapses it
-- for every synced company, so the next incremental sync re-fetches the LATEST year and fills the new accounts for it.
-- Closed earlier years are not re-fetched by an incremental sync; the manual company sync (POST /api/companies/:id/sync,
-- the "sync DART financials" button) always pulls five years and fills them all. See docs/runbooks/beta-series-collection.md.
UPDATE dart_corp_sync_state
   SET financial_checked_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE financial_checked_at IS NOT NULL;
