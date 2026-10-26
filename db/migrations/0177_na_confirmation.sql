-- @reversible: true (purely additive - two nullable columns on project_checklist_item_state; no
-- existing column or row changes, so the 26 existing `na` rows stay as recorded, merely
-- unconfirmed. Manual rollback: the statements in ROLLBACK-SQL below (ALTER TABLE ... DROP COLUMN
-- needs SQLite 3.35+; otherwise restore the pre-migration backup, scripts/co-newbiz/restore.ts,
-- ADR-0014). Code rollback: revert the PR or set CO_NEWBIZ_GATE_INTEGRITY_WAIVER=off.
-- ADR-0186 D5 / design 3.5.)
-- ROLLBACK-SQL-BEGIN
--   ALTER TABLE project_checklist_item_state DROP COLUMN na_confirmed_at;
--   ALTER TABLE project_checklist_item_state DROP COLUMN na_confirmed_by;
-- ROLLBACK-SQL-END
--
-- ADR-0186 D5: a mandatory DD checklist item marked `na` carries a reason (note) and a second
-- person's confirmation. na_confirmed_by must differ from assessed_by (enforced in code; the
-- confirmer also holds a human-role grant). Under enforce mode an unconfirmed mandatory `na` counts as
-- pending in the DD completion summary. Re-assessing the row (any status write) clears the
-- confirmation, so a changed judgement never inherits an earlier confirmer.
ALTER TABLE project_checklist_item_state ADD COLUMN na_confirmed_by TEXT;
ALTER TABLE project_checklist_item_state ADD COLUMN na_confirmed_at TEXT;
