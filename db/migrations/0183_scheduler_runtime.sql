-- 0183_scheduler_runtime.sql
-- @reversible: false in the general case (job_run is rebuilt to widen its status CHECK, and SQLite cannot alter a CHECK in
-- place; every existing row is copied verbatim and the new columns are NULL for them. Rollback is a pre-migration backup
-- restore - scripts/co-newbiz/restore.ts, ADR-0014. The schedule_job columns and the three new tables are purely additive;
-- manual rollback of those is in ROLLBACK-SQL below, after a backup, SQLite >= 3.35 for DROP COLUMN.)
-- ROLLBACK LIMITS (ADR-0014): once any job_run row carries status 'skipped' or 'timeout' (or a schedule_job_request carries
-- 'abandoned'), the old CHECK constraints cannot hold those rows, so a down-migration is not possible in place: restore the
-- pre-migration backup instead. This migration rebuilds a table: it needs dba execution and release-engineer sign-off
-- (backup first, ordering per ADR-0014) before it runs against any non-scratch database.
-- ROLLBACK-SQL-BEGIN
--   DROP TABLE schedule_heartbeat;
--   DROP TABLE schedule_job_request;
--   DROP TABLE schedule_job_lock;
--   ALTER TABLE schedule_job DROP COLUMN last_fire_minute;
--   ALTER TABLE schedule_job DROP COLUMN updated_by;
--   ALTER TABLE schedule_job DROP COLUMN updated_at;
--   ALTER TABLE schedule_job DROP COLUMN max_retries;
--   ALTER TABLE schedule_job DROP COLUMN timeout_sec;
--   ALTER TABLE schedule_job DROP COLUMN description;
--   ALTER TABLE schedule_job DROP COLUMN display_name;
-- ROLLBACK-SQL-END
--
-- Scheduler runtime schema (ADR-0189, design 2026-10-29-scheduled-jobs-design sections 3.4-3.5, phase P1).
--   job_run             rebuilt: trigger source, actor (manual only), env, row counts, attempt, detail_json; status gains
--                       'skipped' and 'timeout'. Legacy rows keep NULL in every new column.
--   schedule_job        additive columns for the admin CRUD and the dispatcher (last_fire_minute is the dispatcher's
--                       compare-and-set cursor: one fire per minute even with two concurrent ticks).
--   schedule_job_lock   lease lock, one row per job_key (overlap guard).
--   schedule_job_request  "run now" requests enqueued by the admin API; executed by the next tick, never in-process.
--   schedule_heartbeat  one row per environment, upserted by every tick (did-it-fire signal for SRE).

CREATE TABLE job_run_new (
  id TEXT PRIMARY KEY NOT NULL,
  job_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped', 'timeout')),
  error TEXT,
  trigger TEXT CHECK (trigger IS NULL OR trigger IN ('schedule', 'manual', 'catchup')),
  actor TEXT,
  env TEXT CHECK (env IS NULL OR env IN ('prod', 'dev')),
  rows_read INTEGER,
  rows_written INTEGER,
  rows_changed INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  detail_json TEXT
);
INSERT INTO job_run_new (id, job_key, started_at, finished_at, status, error)
  SELECT id, job_key, started_at, finished_at, status, error FROM job_run;
DROP TABLE job_run;
ALTER TABLE job_run_new RENAME TO job_run;
CREATE INDEX idx_job_run_key ON job_run(job_key, started_at DESC);

ALTER TABLE schedule_job ADD COLUMN display_name TEXT;
ALTER TABLE schedule_job ADD COLUMN description TEXT;
ALTER TABLE schedule_job ADD COLUMN timeout_sec INTEGER NOT NULL DEFAULT 600 CHECK (timeout_sec > 0);
ALTER TABLE schedule_job ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 0 CHECK (max_retries >= 0);
ALTER TABLE schedule_job ADD COLUMN updated_at TEXT;
ALTER TABLE schedule_job ADD COLUMN updated_by TEXT;
ALTER TABLE schedule_job ADD COLUMN last_fire_minute TEXT;

CREATE TABLE schedule_job_lock (
  job_key TEXT PRIMARY KEY NOT NULL,
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  lease_until TEXT NOT NULL
);

CREATE TABLE schedule_job_request (
  id TEXT PRIMARY KEY NOT NULL,
  job_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'done', 'rejected_locked', 'abandoned')),
  job_run_id TEXT
);
CREATE INDEX idx_schedule_job_request_status ON schedule_job_request(status, requested_at);

CREATE TABLE schedule_heartbeat (
  env TEXT PRIMARY KEY NOT NULL CHECK (env IN ('prod', 'dev')),
  last_tick_at TEXT NOT NULL
);
