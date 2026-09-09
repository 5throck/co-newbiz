-- @reversible: true (data remap of the four stale industry-profile anchors to
-- the in-force KSIC 11th-revision codes — see ADR-0111 revision 2026-09-10.
-- Manual rollback: reverse the four code pairs; the collision guard means any
-- row left unmapped keeps its old value, so a rollback re-run is also safe.)
-- Corrects md_industry.ksic_code values written from the four stale profile
-- anchors (264/29192/30111/30303) to the in-force 11th-revision codes
-- (261/29280/31111/3131). Each UPDATE is guarded so an industry is never
-- remapped onto a code already held by a different row (UNIQUE index) — such
-- a row keeps its old value rather than being nulled or merged. The HYD-BRK
-- freeze sentinel and NULL rows are untouched.

UPDATE md_industry SET ksic_code = '261'   WHERE ksic_code = '264'   AND NOT EXISTS (SELECT 1 FROM md_industry WHERE ksic_code = '261');
UPDATE md_industry SET ksic_code = '29280' WHERE ksic_code = '29192' AND NOT EXISTS (SELECT 1 FROM md_industry WHERE ksic_code = '29280');
UPDATE md_industry SET ksic_code = '31111' WHERE ksic_code = '30111' AND NOT EXISTS (SELECT 1 FROM md_industry WHERE ksic_code = '31111');
UPDATE md_industry SET ksic_code = '3131'  WHERE ksic_code = '30303' AND NOT EXISTS (SELECT 1 FROM md_industry WHERE ksic_code = '3131');
