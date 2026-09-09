-- @reversible: true (data remap — manual rollback: set the row's ksic_code
-- back to 'HYD-BRK'; only rows literally holding the sentinel are touched.)
-- Retires the HYD-BRK freeze sentinel (ADR-0112): 유압브레이커's ksic_code
-- becomes the real KSIC 29241 (건설 및 채광용 기계장비 제조업 — verified via
-- DART-registered induty codes of Soosan-group breaker affiliates). The
-- report itself is persisted as a regular market_sizing_version by
-- scripts/co-newbiz/backfill-hyd-brk-report.ts. Guarded: if another row
-- already owns 29241 the sentinel row falls back to NULL (미지정) instead of
-- violating the unique index.

UPDATE md_industry SET ksic_code = '29241' WHERE ksic_code = 'HYD-BRK' AND NOT EXISTS (SELECT 1 FROM md_industry WHERE ksic_code = '29241');
UPDATE md_industry SET ksic_code = NULL WHERE ksic_code = 'HYD-BRK';
