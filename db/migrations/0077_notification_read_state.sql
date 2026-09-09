-- @reversible: true (additive-only notification lifecycle column; rollback is pre-migration backup restore per ADR-0014)
-- Wave D1 — per-recipient notification read state. read_at is nullable so
-- existing rows remain unread until a user explicitly marks them read.

ALTER TABLE notification ADD COLUMN read_at TEXT;
CREATE INDEX idx_notification_user_unread ON notification(user_id, read_at, sent_at DESC);
