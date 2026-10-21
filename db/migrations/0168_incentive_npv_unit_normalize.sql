-- 0168_incentive_npv_unit_normalize.sql (2026-10-21, decider: "인센티브·클로백에
-- 왜 NPV (억원)가 나타날까?"). The incentives form collected NPV in 억원 but the
-- column was read elsewhere as 백만 KRW (the ADR-0061 money unit) — the same
-- number meant two things. Standardize the STORED unit to 백만 KRW: legacy rows
-- were entered through the form in 억원, so multiply by 100 (억원 → 백만원).
-- estimated_clawback has never had an input surface; it is left untouched.
-- From this migration the page converts on the way IN (input 억원 ×100) and
-- displays with fmtNpvEok (백만 → 억원).
UPDATE incentive SET npv_value = npv_value * 100 WHERE npv_value IS NOT NULL AND npv_value <> 0;
