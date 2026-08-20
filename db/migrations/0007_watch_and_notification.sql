-- Monitoring, auto-reanalysis, and scheduler tables — docs/db-schema.md §9/§11,
-- design v1.0 §4-3, ADR-0019, FR-MON-01..04, Wave 5.4.
--
-- schedule_job / job_run: the OS-level scheduler (Task Scheduler / systemd
-- timer, per FR-MON-01) registers schedule_job rows and drives `watch:run`;
-- job_run is the operational audit trail checked first when a scheduled run
-- appears not to have fired (docs/ops-cadence.md §1).
--
-- watch / watch_rule / notification: bidirectional monitoring (FR-MON-02 —
-- downgrade alerts are NOT optional) with per-(project, trigger_type)
-- cooldown and hysteresis-aligned re-trigger suppression (FR-MON-03).

CREATE TABLE schedule_job (
  id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  cron_expr TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE job_run (
  id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  error TEXT
);
-- Ops-cadence's first stop when a scheduled run appears not to have fired.
CREATE INDEX idx_job_run_key ON job_run(job_key, started_at DESC);

-- No FK to a users table (auth/accounts land in Wave 5.5) — user_id is a
-- plain identifier, matching the existing created_by/requested_by
-- convention used elsewhere in this schema (run.created_by, waiver.requested_by).
CREATE TABLE watch (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  user_id TEXT NOT NULL,
  -- Change-detection watermark: data_change_log rows at or before this
  -- timestamp have already been considered by a prior watch:run cycle.
  last_checked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_watch_project ON watch(project_id);

CREATE TABLE watch_rule (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES watch(id),
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('rag_upgrade', 'rag_downgrade', 'kill_criteria', 'regulation_change', 'threshold_breach', 'staleness', 'batch_failure')
  ),
  -- Interpretation is trigger-specific (e.g. threshold_breach = an IRR/NPV
  -- delta in percentage points); NULL where the trigger has no threshold.
  threshold REAL,
  cooldown_hours INTEGER NOT NULL DEFAULT 24,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webhook', 'all')),
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_watch_rule_watch ON watch_rule(watch_id);

CREATE TABLE notification (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('rag_upgrade', 'rag_downgrade', 'kill_criteria', 'regulation_change', 'threshold_breach', 'staleness', 'batch_failure')
  ),
  severity TEXT NOT NULL CHECK (severity IN ('opportunity', 'warning', 'urgent', 'info', 'ops')),
  payload TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webhook', 'all')),
  -- 'immediate' = urgent, sent as soon as generated; 'daily' = bundled into
  -- a digest (design §4-3 fatigue-prevention rule) — actual digest delivery
  -- is a Wave 5.6/5.9 concern (real email/webhook transport), this column
  -- only records the intended cadence.
  bundle TEXT NOT NULL CHECK (bundle IN ('immediate', 'daily')),
  -- Generated/queued timestamp — see bundle column note; not necessarily a
  -- literal delivery timestamp until a transport layer exists.
  sent_at TEXT NOT NULL
);
-- Cooldown lookup: most recent notification for a (project, trigger_type) pair.
CREATE INDEX idx_notification_cooldown ON notification(project_id, trigger_type, sent_at DESC);
CREATE INDEX idx_notification_user ON notification(user_id, sent_at DESC);
