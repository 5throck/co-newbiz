-- 0141_establishment_notifications_and_call_path.sql
-- @reversible: true (the event column is purely additive; the notification
-- table is rebuilt with the 0072 pattern — same columns plus dedupe_key, two
-- more trigger_type values — so the rollback deletes the rows of the two new
-- trigger types and rebuilds the previous shape. Take a backup first if those
-- notifications must be kept. Rollback mechanism of record: pre-migration
-- backup restore (scripts/co-newbiz/restore.ts, ADR-0014). ADR-0165 addendum.)
-- ROLLBACK-SQL-BEGIN
--   DELETE FROM notification WHERE trigger_type IN ('establishment_step_reopened', 'establishment_step_assigned');
--   DROP INDEX idx_notification_dedupe;
--   CREATE TABLE notification_old (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT REFERENCES md_project(id), trigger_type TEXT NOT NULL CHECK (trigger_type IN ('rag_upgrade', 'rag_downgrade', 'kill_criteria', 'regulation_change', 'threshold_breach', 'staleness', 'batch_failure', 'pipeline_paused')), severity TEXT NOT NULL CHECK (severity IN ('opportunity', 'warning', 'urgent', 'info', 'ops')), payload TEXT NOT NULL, channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webhook', 'all')), bundle TEXT NOT NULL CHECK (bundle IN ('immediate', 'daily')), sent_at TEXT NOT NULL, read_at TEXT);
--   INSERT INTO notification_old (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at) SELECT id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at FROM notification;
--   DROP TABLE notification;
--   ALTER TABLE notification_old RENAME TO notification;
--   CREATE INDEX idx_notification_cooldown ON notification(project_id, trigger_type, sent_at DESC);
--   CREATE INDEX idx_notification_user ON notification(user_id, sent_at DESC);
--   CREATE INDEX idx_notification_user_unread ON notification(user_id, read_at, sent_at DESC);
--   ALTER TABLE entity_establishment_step_event DROP COLUMN via;
-- ROLLBACK-SQL-END
--
-- ADR-0165 follow-up (2026-10-13, DEC-20261013-09):
--
-- (a) notification: two new trigger types for the S11 establishment steps
--     ('establishment_step_reopened', 'establishment_step_assigned') and a
--     nullable dedupe_key with a partial UNIQUE index per recipient, so a retried
--     or repeated write cannot notify the same person twice. SQLite cannot alter
--     a CHECK constraint, hence the table rebuild (0072 pattern): identical
--     columns in identical order (read_at from 0077 included), all rows copied
--     verbatim, the three existing indexes recreated. watch-engine and
--     pipeline writers do not name dedupe_key and are unaffected.
--
-- (b) entity_establishment_step_event.via: how the mutation arrived —
--     'ui' (cookie session), 'api' (bearer token on REST), 'mcp' (in-process
--     OAuth-delegated MCP call) or 'unknown' (rows written before this
--     migration, and callers that did not state it).

CREATE TABLE notification_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT REFERENCES md_project(id),
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('rag_upgrade', 'rag_downgrade', 'kill_criteria', 'regulation_change', 'threshold_breach', 'staleness', 'batch_failure', 'pipeline_paused', 'establishment_step_reopened', 'establishment_step_assigned')
  ),
  severity TEXT NOT NULL CHECK (severity IN ('opportunity', 'warning', 'urgent', 'info', 'ops')),
  payload TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webhook', 'all')),
  bundle TEXT NOT NULL CHECK (bundle IN ('immediate', 'daily')),
  sent_at TEXT NOT NULL,
  read_at TEXT,
  dedupe_key TEXT
);
INSERT INTO notification_new (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at)
  SELECT id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at FROM notification;
DROP TABLE notification;
ALTER TABLE notification_new RENAME TO notification;
CREATE INDEX idx_notification_cooldown ON notification(project_id, trigger_type, sent_at DESC);
CREATE INDEX idx_notification_user ON notification(user_id, sent_at DESC);
CREATE INDEX idx_notification_user_unread ON notification(user_id, read_at, sent_at DESC);
CREATE UNIQUE INDEX idx_notification_dedupe ON notification(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE entity_establishment_step_event ADD COLUMN via TEXT NOT NULL DEFAULT 'unknown' CHECK (via IN ('ui', 'api', 'mcp', 'unknown'));
