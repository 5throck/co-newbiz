-- 0158_drop_technical_item_verdicts_column.sql (DEC-20261020-01 — the second pending
-- follow-up the decider accepted after the documentation audit).
--
-- Migration 0157 added opportunity.technical_item_verdicts_json for the round-4 S9
-- recording block (`technical-items` route + sidecar lib). The decider then retracted
-- that structure (round 5c: the S9 DD structure is the judgement home and S8 only
-- rolls it up), so the route, lib and UI were removed in the same window and nothing
-- writes or reads the column. SQLite >= 3.35 supports DROP COLUMN; the column is
-- nullable, unreferenced by indexes/FKs/views, and only ever held test rows.
ALTER TABLE opportunity DROP COLUMN technical_item_verdicts_json;
