-- 0083: md_account seed — the canonical account rows any fact_financial writer
-- maps DART normalized account names onto (Phase 1: company financial facts,
-- ADR-0116). md_account had zero rows since 0001; without this seed the
-- writer cannot resolve account_id. ifrs_code is the stable canonical key —
-- DART's ifrs_account_id taxonomy element names, aligned with the 8 accounts
-- in app/web-next/lib/dart-client.ts WANTED_ACCOUNTS (fetchFinancials maps by
-- the normalized Korean name, so name_ko is the lookup key and must match it).
-- @reversible: true (additive seed only; unique ifrs_code makes re-apply safe)
INSERT INTO md_account (id, ifrs_code, name_ko, name_en, created_at) VALUES
  ('01J8MDACC0REVENUE0000000000', 'ifrs-full_Revenue',                            '매출액',       'Revenue',                        '2026-09-11T00:00:00Z'),
  ('01J8MDACC0COSTOFSALE00000000', 'ifrs-full_CostOfSales',                       '매출원가',     'Cost of sales',                  '2026-09-11T00:00:00Z'),
  ('01J8MDACC0ADMINEXP0000000000', 'ifrs-full_AdministrativeExpense',             '판매비와관리비', 'Administrative expense',        '2026-09-11T00:00:00Z'),
  ('01J8MDACC0OPERATING0000000000', 'ifrs-full_ProfitLossFromOperatingActivities', '영업이익',      'Operating profit',              '2026-09-11T00:00:00Z'),
  ('01J8MDACC0PROFITLOSS000000000', 'ifrs-full_ProfitLoss',                        '당기순이익',    'Profit for the period',         '2026-09-11T00:00:00Z'),
  ('01J8MDACC0ASSETS000000000000', 'ifrs-full_Assets',                            '자산총계',     'Total assets',                   '2026-09-11T00:00:00Z'),
  ('01J8MDACC0LIABILITIES00000000', 'ifrs-full_Liabilities',                       '부채총계',     'Total liabilities',              '2026-09-11T00:00:00Z'),
  ('01J8MDACC0EQUITY000000000000', 'ifrs-full_Equity',                            '자본총계',     'Total equity',                   '2026-09-11T00:00:00Z');
