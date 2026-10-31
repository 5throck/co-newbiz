-- 0185_notification_delivery.sql
-- @reversible: false in the general case (notification is rebuilt to widen its trigger_type CHECK and gains title/source_ref,
-- and SQLite cannot alter a CHECK in place; every existing row is copied verbatim into the new shape. Rollback is a pre-migration
-- backup restore - scripts/co-newbiz/restore.ts, ADR-0014. The four new tables and the app_user email column are cleanly
-- droppable; manual rollback of those is in ROLLBACK-SQL below, after a backup, SQLite >= 3.35 for DROP COLUMN.)
-- ROLLBACK LIMITS (ADR-0014): dropping notification_delivery, notification_recipient_policy, user_notification_pref,
-- notify_webhook_target and app_user.email (with idx_app_user_email) is clean. Rebuilding notification back to the 0141 shape
-- is only possible while no row carries trigger_type 'test' and the title/source_ref values are discarded (the old CHECK and
-- column set cannot hold them); once a 'test' row exists, a down-migration is not possible in place: restore the pre-migration
-- backup instead. This migration rebuilds a table and is tagged irreversible: it needs dba execution and release-engineer
-- sign-off (FR-OPS-02, backup first, ordering per ADR-0014) before it runs against any non-scratch database.
-- ROLLBACK-SQL-BEGIN
--   DROP TABLE notification_delivery;
--   DROP TABLE user_notification_pref;
--   DROP TABLE notification_recipient_policy;
--   DROP TABLE notify_webhook_target;
--   DROP INDEX idx_app_user_email;
--   ALTER TABLE app_user DROP COLUMN email;
--   -- notification back to the 0141 shape ONLY IF no trigger_type='test' row exists (else restore the backup):
--   DROP INDEX idx_notification_dedupe;
--   CREATE TABLE notification_old (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT REFERENCES md_project(id), trigger_type TEXT NOT NULL CHECK (trigger_type IN ('rag_upgrade', 'rag_downgrade', 'kill_criteria', 'regulation_change', 'threshold_breach', 'staleness', 'batch_failure', 'pipeline_paused', 'establishment_step_reopened', 'establishment_step_assigned')), severity TEXT NOT NULL CHECK (severity IN ('opportunity', 'warning', 'urgent', 'info', 'ops')), payload TEXT NOT NULL, channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webhook', 'all')), bundle TEXT NOT NULL CHECK (bundle IN ('immediate', 'daily')), sent_at TEXT NOT NULL, read_at TEXT, dedupe_key TEXT);
--   INSERT INTO notification_old (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at, dedupe_key) SELECT id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at, dedupe_key FROM notification;
--   DROP TABLE notification;
--   ALTER TABLE notification_old RENAME TO notification;
--   CREATE INDEX idx_notification_cooldown ON notification(project_id, trigger_type, sent_at DESC);
--   CREATE INDEX idx_notification_user ON notification(user_id, sent_at DESC);
--   CREATE INDEX idx_notification_user_unread ON notification(user_id, read_at, sent_at DESC);
--   CREATE UNIQUE INDEX idx_notification_dedupe ON notification(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
-- ROLLBACK-SQL-END
--
-- Notification delivery schema (ADR-0190, design 2026-10-29-scheduled-jobs-design section 13.3, phase P3 row 1).
--   notification                   rebuilt: 0141 shape verbatim plus 'test' in trigger_type, nullable title and source_ref.
--                                  project_id was already nullable (since 0072) and stays that way; sent_at stays the
--                                  enqueue time - per-channel delivery time lives in notification_delivery.sent_at.
--   app_user.email                 recipient address, read at send time (D-3); provisioning/verification UI is P4.
--   notification_delivery          one row per notification x recipient x channel (the delivery ledger, ADR-0190 section 3).
--   notification_recipient_policy  severity/trigger -> audience -> channels/bundle, seeded per D9.
--   user_notification_pref         per-user opt-out per channel/severity (D12).
--   notify_webhook_target          channel key -> env-var NAME + format; URLs stay in env (D11, ADR-0190 section 1).

-- (a) notification rebuild (0141's in-transaction pattern - notification is a leaf table, nothing references it,
--     so no PRAGMA foreign_keys dance as in 0033). user_id stays TEXT NOT NULL without a declared FK (0007
--     convention; the user_id='system' sentinel for system/ops notifications keeps working as-is).
CREATE TABLE notification_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT REFERENCES md_project(id),
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('rag_upgrade', 'rag_downgrade', 'kill_criteria', 'regulation_change', 'threshold_breach', 'staleness', 'batch_failure', 'pipeline_paused', 'establishment_step_reopened', 'establishment_step_assigned', 'test')
  ),
  severity TEXT NOT NULL CHECK (severity IN ('opportunity', 'warning', 'urgent', 'info', 'ops')),
  payload TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webhook', 'all')),
  bundle TEXT NOT NULL CHECK (bundle IN ('immediate', 'daily')),
  sent_at TEXT NOT NULL,
  read_at TEXT,
  dedupe_key TEXT,
  title TEXT,
  source_ref TEXT
);
INSERT INTO notification_new (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at, dedupe_key)
  SELECT id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at, dedupe_key FROM notification;
DROP TABLE notification;
ALTER TABLE notification_new RENAME TO notification;
CREATE INDEX idx_notification_cooldown ON notification(project_id, trigger_type, sent_at DESC);
CREATE INDEX idx_notification_user ON notification(user_id, sent_at DESC);
CREATE INDEX idx_notification_user_unread ON notification(user_id, read_at, sent_at DESC);
CREATE UNIQUE INDEX idx_notification_dedupe ON notification(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- (b) Recipient email address (closes design gap D-3). Addresses are read from the user record at send time and
--     stored only masked (j***@example.com) on notification_delivery rows; provisioning/verification UI is P4.
--     No declared FK, per the 0008 additive-DDL convention. The partial unique index lets every user stay NULL
--     (SQLite treats NULLs as distinct in a plain UNIQUE) while forbidding one address on two users.
ALTER TABLE app_user ADD COLUMN email TEXT;
CREATE UNIQUE INDEX idx_app_user_email ON app_user(email) WHERE email IS NOT NULL;

-- (c) Delivery ledger and policy tables (ADR-0190 sections 3-4, design section 13.3). ULID TEXT PKs, ISO-8601 TEXT timestamps.

CREATE TABLE notification_delivery (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notification(id),
  recipient_user_id TEXT,          -- NULL for channel-level webhook targets (not tied to one user)
  recipient_address_masked TEXT,   -- masked only, e.g. j***@example.com; never the raw address
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),
  target_key TEXT,                 -- webhook channel key 'deals'|'ops' (D11); NULL for email
  status TEXT NOT NULL CHECK (status IN ('pending', 'retry', 'sent', 'failed', 'skipped', 'deferred')),
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,            -- ISO-8601; due when status IN (pending, retry) and next_attempt_at <= now
  last_error TEXT,                 -- scrubbed through db/lib/secret-scrubber.ts, truncated to 2 KB
  provider_message_id TEXT,
  digest_id TEXT,                  -- shared id marking the rows folded into one notify.digest email
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),  -- 1 for admin test sends (design section 13.7)
  created_at TEXT NOT NULL,
  sent_at TEXT
);
-- Uniqueness with the SQLite NULL caveat: a plain UNIQUE (notification_id, recipient_user_id, channel, target_key)
-- treats NULLs as distinct, so a webhook row (recipient NULL, target NULL) could be re-expanded forever. The
-- COALESCE expression index normalizes NULL to '' and makes re-expansion idempotent (ADR-0190 section 3).
CREATE UNIQUE INDEX idx_delivery_unique ON notification_delivery(notification_id, COALESCE(recipient_user_id, ''), channel, COALESCE(target_key, ''));
CREATE INDEX idx_delivery_due ON notification_delivery(status, next_attempt_at);
CREATE INDEX idx_delivery_digest ON notification_delivery(digest_id);
CREATE INDEX idx_delivery_notification ON notification_delivery(notification_id);

CREATE TABLE notification_recipient_policy (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('opportunity', 'warning', 'urgent', 'info', 'ops')),
  trigger_type TEXT,               -- NULL = all triggers of this severity
  audience TEXT NOT NULL,          -- 'owner' | 'project_members' | 'role:<role>' | 'admins' - string form on
                                   -- purpose, NO restrictive CHECK; validated in code (PM decision, D9)
  channels TEXT NOT NULL,          -- JSON array, e.g. '["in_app","email","webhook"]'
  bundle TEXT NOT NULL CHECK (bundle IN ('immediate', 'daily')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE TABLE user_notification_pref (
  user_id TEXT NOT NULL,           -- links app_user.user_id by convention (0007/0008 pattern); no declared FK
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook')),  -- in-app is not opt-outable (D12, ADR-0190 section 4)
  severity TEXT NOT NULL CHECK (severity IN ('opportunity', 'warning', 'urgent', 'info', 'ops')),
  -- D12: rows may exist for 'urgent' (the pref UI stores all severities) but the code layer never honours an
  -- opt-out for urgent; enforcing that here with a CHECK forbidding 'urgent' is deliberately not done.
  opt_in INTEGER NOT NULL DEFAULT 1 CHECK (opt_in IN (0, 1)),
  PRIMARY KEY (user_id, channel, severity)
);

CREATE TABLE notify_webhook_target (
  channel_key TEXT PRIMARY KEY NOT NULL,  -- 'deals' | 'ops' per D11; env var is NOTIFY_WEBHOOK_URL_<CHANNEL upper-cased>.
                                          -- NOT NULL is explicit: SQLite's TEXT PRIMARY KEY does not imply it.
  env_var TEXT NOT NULL,           -- the env-var NAME, never the URL (URLs are bearer secrets, ADR-0190 section 1)
  format TEXT NOT NULL CHECK (format IN ('slack', 'teams')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

-- (d) D9 recipient-policy seed rows (design section 10 D9). Idempotent: INSERT OR IGNORE on stable ids, so a
--     re-applied seed never duplicates. trigger_type NULL = the policy covers every trigger of that severity.
INSERT OR IGNORE INTO notification_recipient_policy (id, severity, trigger_type, audience, channels, bundle, enabled) VALUES
  ('d9-urgent-owner',            'urgent',      NULL, 'owner',        '["in_app","email","webhook"]', 'immediate', 1),
  ('d9-urgent-analyst-role',     'urgent',      NULL, 'role:analyst', '["in_app","email","webhook"]', 'immediate', 1),  -- project members with role >= analyst
  ('d9-urgent-admins',           'urgent',      NULL, 'admins',       '["in_app","email","webhook"]', 'immediate', 1),
  ('d9-warning-owner-inapp',     'warning',     NULL, 'owner',        '["in_app"]',                   'immediate', 1),
  ('d9-warning-owner-daily',     'warning',     NULL, 'owner',        '["email"]',                    'daily',     1),
  ('d9-opportunity-owner-inapp', 'opportunity', NULL, 'owner',        '["in_app"]',                   'immediate', 1),
  ('d9-opportunity-owner-daily', 'opportunity', NULL, 'owner',        '["email"]',                    'daily',     1),
  ('d9-info-owner-inapp',        'info',        NULL, 'owner',        '["in_app"]',                   'immediate', 1),
  ('d9-info-owner-daily',        'info',        NULL, 'owner',        '["email"]',                    'daily',     1),
  ('d9-ops-admins',              'ops',         NULL, 'admins',       '["in_app","webhook"]',         'immediate', 1);
-- Ops webhook deliveries go to the 'ops' channel (D11); that severity->target mapping is handler-level - the
-- policy row carries only the channels array.
