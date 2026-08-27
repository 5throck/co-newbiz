-- 0036_watch_rule_adr_ref.sql
-- Adds adr_ref to watch_rule: a notification-threshold rule must carry a
-- linked ADR reference (ui-spec §5 / FR-GOV — a threshold edit without a
-- linked ADR reference is a hard block, not a warning). Nullable for
-- pre-existing rows; the admin console enforces it on new rules.
ALTER TABLE watch_rule ADD COLUMN adr_ref TEXT;
