// @version 1.0.0
/**
 * schedule_job row serializer shared by the admin schedule-jobs routes (design
 * 2026-10-29-scheduled-jobs-design §4.1/§4.3, pulled-forward admin screen): every row carries the
 * registry fields from migration 0183 plus `next_run_at` and `last_run`.
 *
 * `next_run_at` is computed here from cron_expr through the SAME parser the tick uses
 * (`./cron.ts` — the §4.1 one-parser mandate: a preview that disagrees with execution is a bug).
 * There is deliberately NO server-side human cron string on the row: the frontend humanizes with
 * cronstrue per active locale, so this API stays locale-free.
 */
import type { Database } from "bun:sqlite";
import { CronError, nextFireTimes } from "./cron.ts";

export interface ScheduleJobLastRun {
  started_at: string;
  status: string;
  /** finished_at − started_at in ms; null while the run has no finished_at (still running). */
  duration_ms: number | null;
}

export interface ScheduleJobRow {
  id: string;
  job_key: string;
  cron_expr: string;
  enabled: number;
  created_at: string;
  display_name: string | null;
  description: string | null;
  timeout_sec: number;
  max_retries: number;
  updated_at: string | null;
  updated_by: string | null;
  /** Next fire instant (ISO, KST wall clock via the shared parser) for enabled jobs; null when disabled or the stored cron is invalid. */
  next_run_at: string | null;
  /** Latest job_run row for the key; null when the job has never run. */
  last_run: ScheduleJobLastRun | null;
}

interface RawScheduleJob {
  id: string;
  job_key: string;
  cron_expr: string;
  enabled: number;
  created_at: string;
  display_name: string | null;
  description: string | null;
  timeout_sec: number;
  max_retries: number;
  updated_at: string | null;
  updated_by: string | null;
}

const RAW_COLUMNS =
  "id, job_key, cron_expr, enabled, created_at, display_name, description, timeout_sec, max_retries, updated_at, updated_by";

function nextRunAt(job: Pick<RawScheduleJob, "cron_expr" | "enabled">, now: Date): string | null {
  if (!job.enabled) return null;
  try {
    return nextFireTimes(job.cron_expr, now, 1)[0]?.toISOString() ?? null;
  } catch (e) {
    // An invalid stored cron is reported by the tick (§3.2); the admin list must not 500 on it.
    if (e instanceof CronError) return null;
    throw e;
  }
}

function lastRunOf(db: Database, jobKey: string): ScheduleJobLastRun | null {
  const row = db
    .query("SELECT started_at, status, finished_at FROM job_run WHERE job_key = ? ORDER BY id DESC LIMIT 1")
    .get(jobKey) as { started_at: string; status: string; finished_at: string | null } | null;
  if (!row) return null;
  const started = Date.parse(row.started_at);
  const finished = row.finished_at === null ? NaN : Date.parse(row.finished_at);
  const duration_ms = Number.isNaN(started) || Number.isNaN(finished) ? null : finished - started;
  return { started_at: row.started_at, status: row.status, duration_ms };
}

/** Build one API row from a raw schedule_job record (the GET row shape — PATCH responds with it too). */
export function buildScheduleJobRow(db: Database, raw: RawScheduleJob, now: Date): ScheduleJobRow {
  return {
    id: raw.id,
    job_key: raw.job_key,
    cron_expr: raw.cron_expr,
    enabled: raw.enabled,
    created_at: raw.created_at,
    display_name: raw.display_name,
    description: raw.description,
    timeout_sec: raw.timeout_sec,
    max_retries: raw.max_retries,
    updated_at: raw.updated_at,
    updated_by: raw.updated_by,
    next_run_at: nextRunAt(raw, now),
    last_run: lastRunOf(db, raw.job_key),
  };
}

/** One job's row by job_key, or null when the key is unknown. */
export function fetchScheduleJobRow(db: Database, jobKey: string, now: Date): ScheduleJobRow | null {
  const raw = db
    .query(`SELECT ${RAW_COLUMNS} FROM schedule_job WHERE job_key = ?`)
    .get(jobKey) as RawScheduleJob | null;
  return raw ? buildScheduleJobRow(db, raw, now) : null;
}

/** All jobs' rows, ordered by job_key (the admin list). */
export function fetchScheduleJobRows(db: Database, now: Date): ScheduleJobRow[] {
  const rows = db.query(`SELECT ${RAW_COLUMNS} FROM schedule_job ORDER BY job_key`).all() as RawScheduleJob[];
  return rows.map((raw) => buildScheduleJobRow(db, raw, now));
}
