// @version 1.0.0
/**
 * Scheduler runtime primitives (ADR-0189, scheduled-jobs design sections 2-3, phase P1).
 *
 * Pure DB functions with an injected clock so the dispatcher (scripts/co-newbiz/schedule-tick.ts) and the runner
 * (scripts/co-newbiz/run-job.ts) are testable against a scratch SQLite. Nothing here spawns a process or runs a handler.
 *
 *   environment   resolveSchedulerEnv: CO_NEWBIZ_SCHEDULER_ENV must be prod|dev, otherwise refuse
 *   due jobs      collectDueJobs: cron + schedule_job.last_fire_minute compare-and-set (one fire per minute even with
 *                 two concurrent ticks), catch-up policy per job
 *   lock          acquireLock / releaseLock: lease lock on schedule_job_lock (overlap guard)
 *   job_run       startJobRun / finishJobRun / sweepStaleRuns
 *   requests      "run now" rows from the admin API (never executed in-process): enqueue / claim / complete
 *   heartbeat     writeHeartbeat: every tick upserts schedule_heartbeat(env)
 */
import { ulid } from "../../db/lib/ulid.ts";
import { floorToMinute, nextFire, parseCron } from "../../app/web-next/lib/schedule/cron.ts";
import { registerCredentialEnvNames, safeDetailJson, scrubSecrets } from "../../db/lib/secret-scrubber.ts";
import { SOURCE_ADAPTERS } from "./source-adapters.ts";

// Direction of the layering: scripts/ -> db/lib (scrubber) and scripts/ -> app/web-next/lib/schedule (cron); never db/lib -> scripts/.
registerCredentialEnvNames(Object.values(SOURCE_ADAPTERS).flatMap((a) => (a.credentialEnv ? [a.credentialEnv] : [])));

// bun:sqlite Database; typed loosely like db/client.ts getDb() so scripts and tests can pass either.
type Db = any;

export type SchedulerEnv = "prod" | "dev";
export type RunTrigger = "schedule" | "manual" | "catchup";
export type RunStatus = "running" | "success" | "failed" | "skipped" | "timeout";

export const LEASE_MARGIN_SEC = 300;
const MINUTE_MS = 60_000;
/** A fire whose minute is within this window of `now` is on time; older ones are missed (catch-up policy decides). */
const ON_TIME_MS = 2 * MINUTE_MS;
const MAX_FIRES_SCANNED = 5000;

export function resolveSchedulerEnv(raw: string | undefined = process.env.CO_NEWBIZ_SCHEDULER_ENV): SchedulerEnv {
  if (raw === "prod" || raw === "dev") return raw;
  throw new Error("CO_NEWBIZ_SCHEDULER_ENV must be set to 'prod' or 'dev' (refusing to run the scheduler without an explicit environment)");
}

// ── Due-job computation ────────────────────────────────────────────────────

export interface CatchupPolicy {
  /** skip = a missed fire is consumed without running; once = run a single catch-up if the missed fire is recent enough */
  mode: "skip" | "once";
  /** only meaningful for mode "once" */
  maxAgeHours?: number;
}

export interface DueJob {
  jobKey: string;
  /** the cron fire instant (ISO, minute precision) this dispatch represents */
  fireMinute: string;
  trigger: RunTrigger;
  timeoutSec: number;
  maxRetries: number;
}

export interface DueScan {
  due: DueJob[];
  /** missed fires consumed without a run (catch-up policy skip, or too old) */
  skippedMissed: Array<{ jobKey: string; fireMinute: string }>;
  /** jobs whose cron_expr does not parse (never fires; reported so the tick can log it) */
  invalid: Array<{ jobKey: string; error: string }>;
}

export function collectDueJobs(db: Db, now: Date, policyFor: (jobKey: string) => CatchupPolicy): DueScan {
  const out: DueScan = { due: [], skippedMissed: [], invalid: [] };
  const nowMin = floorToMinute(now);
  const rows = db
    .query("SELECT job_key, cron_expr, last_fire_minute, timeout_sec, max_retries FROM schedule_job WHERE enabled = 1 ORDER BY job_key")
    .all() as Array<{ job_key: string; cron_expr: string; last_fire_minute: string | null; timeout_sec: number; max_retries: number }>;
  for (const r of rows) {
    let spec;
    try {
      spec = parseCron(r.cron_expr);
    } catch (e) {
      out.invalid.push({ jobKey: r.job_key, error: (e as Error).message });
      continue;
    }
    // Never fired: only the current minute can fire (no catch-up from an unbounded past).
    let cursor = r.last_fire_minute ? new Date(r.last_fire_minute) : new Date(nowMin.getTime() - MINUTE_MS);
    let latest: Date | null = null;
    for (let i = 0; i < MAX_FIRES_SCANNED; i++) {
      const n = nextFire(spec, cursor);
      if (!n || n.getTime() > nowMin.getTime()) break;
      latest = n;
      cursor = n;
    }
    if (!latest) continue;
    // Compare-and-set the cursor: whichever tick wins dispatches; the loser sees changes = 0.
    const fire = latest.toISOString();
    const res = db.run(
      "UPDATE schedule_job SET last_fire_minute = ? WHERE job_key = ? AND COALESCE(last_fire_minute, '') = COALESCE(?, '')",
      [fire, r.job_key, r.last_fire_minute],
    );
    if (res.changes !== 1) continue;
    const lateMs = nowMin.getTime() - latest.getTime();
    if (lateMs <= ON_TIME_MS) {
      out.due.push({ jobKey: r.job_key, fireMinute: fire, trigger: "schedule", timeoutSec: r.timeout_sec, maxRetries: r.max_retries });
      continue;
    }
    const policy = policyFor(r.job_key);
    const maxAgeMs = (policy.maxAgeHours ?? 24) * 3_600_000;
    if (policy.mode === "once" && lateMs <= maxAgeMs) {
      out.due.push({ jobKey: r.job_key, fireMinute: fire, trigger: "catchup", timeoutSec: r.timeout_sec, maxRetries: r.max_retries });
    } else {
      out.skippedMissed.push({ jobKey: r.job_key, fireMinute: fire });
    }
  }
  return out;
}

// ── Lease lock ─────────────────────────────────────────────────────────────

export function leaseSeconds(timeoutSec: number, maxRetries: number, retryDelaySec = 0): number {
  return timeoutSec * (1 + maxRetries) + retryDelaySec * maxRetries + LEASE_MARGIN_SEC;
}

/** One atomic statement: insert, or take over only an EXPIRED lease. True when this holder now owns the lock. */
export function acquireLock(db: Db, jobKey: string, holder: string, now: Date, leaseSec: number): boolean {
  const acquired = now.toISOString();
  const until = new Date(now.getTime() + leaseSec * 1000).toISOString();
  const res = db.run(
    `INSERT INTO schedule_job_lock (job_key, holder, acquired_at, lease_until) VALUES (?, ?, ?, ?)
     ON CONFLICT(job_key) DO UPDATE SET holder = excluded.holder, acquired_at = excluded.acquired_at, lease_until = excluded.lease_until
     WHERE schedule_job_lock.lease_until < excluded.acquired_at`,
    [jobKey, holder, acquired, until],
  );
  return res.changes === 1;
}

export function releaseLock(db: Db, jobKey: string, holder: string): void {
  db.run("DELETE FROM schedule_job_lock WHERE job_key = ? AND holder = ?", [jobKey, holder]);
}

// ── job_run ────────────────────────────────────────────────────────────────

export interface JobRunStart {
  jobKey: string;
  env: SchedulerEnv;
  trigger: RunTrigger;
  actor?: string | null;
  attempt?: number;
  now: Date;
}

export function startJobRun(db: Db, s: JobRunStart): string {
  const id = ulid();
  db.run(
    `INSERT INTO job_run (id, job_key, started_at, status, "trigger", actor, env, attempt) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
    [id, s.jobKey, s.now.toISOString(), s.trigger, s.actor ?? null, s.env, s.attempt ?? 1],
  );
  return id;
}

export interface JobRunFinish {
  status: Exclude<RunStatus, "running">;
  now: Date;
  /** scrubbed and truncated to 2 KB here; callers pass the raw message */
  error?: string | null;
  rowsRead?: number | null;
  rowsWritten?: number | null;
  rowsChanged?: number | null;
  detail?: unknown;
}

export function finishJobRun(db: Db, id: string, f: JobRunFinish): void {
  db.run(
    `UPDATE job_run SET finished_at = ?, status = ?, error = ?, rows_read = ?, rows_written = ?, rows_changed = ?, detail_json = ? WHERE id = ?`,
    [
      f.now.toISOString(),
      f.status,
      f.error ? scrubSecrets(f.error) : null,
      f.rowsRead ?? null,
      f.rowsWritten ?? null,
      f.rowsChanged ?? null,
      f.detail === undefined ? null : safeDetailJson(f.detail),
      id,
    ],
  );
}

/**
 * Mark runs still 'running' past their lease as failed ('timeout_or_crash') and drop expired locks. A killed
 * run-job cannot update its own row, so the next tick repairs it (same pattern as reclaimStaleJobs in job-worker).
 */
export function sweepStaleRuns(db: Db, now: Date): { reclaimed: number; locksCleared: number; requestsAbandoned: number } {
  // Scheduler-owned rows only (env IS NOT NULL): legacy/watch-run rows are never touched by the scheduler sweep.
  const running = db
    .query(
      `SELECT r.id, r.started_at, COALESCE(j.timeout_sec, 600) AS timeout_sec, COALESCE(j.max_retries, 0) AS max_retries
       FROM job_run r LEFT JOIN schedule_job j ON j.job_key = r.job_key WHERE r.status = 'running' AND r.env IS NOT NULL`,
    )
    .all() as Array<{ id: string; started_at: string; timeout_sec: number; max_retries: number }>;
  let reclaimed = 0;
  for (const r of running) {
    const staleAt = Date.parse(r.started_at) + leaseSeconds(r.timeout_sec, r.max_retries) * 1000;
    if (staleAt < now.getTime()) {
      finishJobRun(db, r.id, { status: "timeout", now, error: "timeout_or_crash" });
      reclaimed++;
    }
  }
  // A 'claimed' run-now request whose child never finished (no job_run linked, nothing running for the job, older than
  // the lease) is terminal 'abandoned' so it does not sit claimed forever.
  let requestsAbandoned = 0;
  const claimed = db
    .query(
      `SELECT q.id, q.requested_at, COALESCE(j.timeout_sec, 600) AS timeout_sec, COALESCE(j.max_retries, 0) AS max_retries, q.job_key
       FROM schedule_job_request q LEFT JOIN schedule_job j ON j.job_key = q.job_key
       WHERE q.status = 'claimed' AND q.job_run_id IS NULL`,
    )
    .all() as Array<{ id: string; requested_at: string; timeout_sec: number; max_retries: number; job_key: string }>;
  for (const q of claimed) {
    if (Date.parse(q.requested_at) + leaseSeconds(q.timeout_sec, q.max_retries) * 1000 >= now.getTime()) continue;
    if (db.query("SELECT 1 FROM job_run WHERE job_key = ? AND status = 'running' AND env IS NOT NULL").get(q.job_key)) continue;
    requestsAbandoned += db.run("UPDATE schedule_job_request SET status = 'abandoned' WHERE id = ? AND status = 'claimed'", [q.id]).changes;
  }
  const cleared = db.run("DELETE FROM schedule_job_lock WHERE lease_until < ?", [now.toISOString()]);
  return { reclaimed, locksCleared: cleared.changes, requestsAbandoned };
}

/**
 * Trailing streak of failed/timeout RUNS (final attempts only: attempts that were retried carry detail_json
 * {"retried":true} and are not counted). For the "3 consecutive failures" SRE rule and the P3 alert hook.
 */
export function consecutiveFailures(db: Db, jobKey: string, limit = 5): number {
  const rows = db
    .query(
      `SELECT status FROM job_run WHERE job_key = ? AND status != 'running'
       AND COALESCE(CASE WHEN json_valid(detail_json) THEN json_extract(detail_json, '$.retried') END, 0) != 1
       ORDER BY started_at DESC, id DESC LIMIT ?`,
    )
    .all(jobKey, limit) as Array<{ status: string }>;
  let n = 0;
  for (const r of rows) {
    if (r.status === "failed" || r.status === "timeout") n++;
    else break;
  }
  return n;
}

// ── Run-now requests ───────────────────────────────────────────────────────

export function enqueueRequest(db: Db, jobKey: string, requestedBy: string, now: Date): string {
  const id = ulid();
  db.run("INSERT INTO schedule_job_request (id, job_key, requested_by, requested_at, status) VALUES (?, ?, ?, ?, 'queued')", [
    id,
    jobKey,
    requestedBy,
    now.toISOString(),
  ]);
  return id;
}

export interface JobRequest {
  id: string;
  jobKey: string;
  requestedBy: string;
}

/** Claim every queued request (compare-and-set per row, safe against a concurrent tick). */
export function claimQueuedRequests(db: Db): JobRequest[] {
  const rows = db
    .query("SELECT id, job_key, requested_by FROM schedule_job_request WHERE status = 'queued' ORDER BY requested_at, id")
    .all() as Array<{ id: string; job_key: string; requested_by: string }>;
  const claimed: JobRequest[] = [];
  for (const r of rows) {
    const res = db.run("UPDATE schedule_job_request SET status = 'claimed' WHERE id = ? AND status = 'queued'", [r.id]);
    if (res.changes === 1) claimed.push({ id: r.id, jobKey: r.job_key, requestedBy: r.requested_by });
  }
  return claimed;
}

export function completeRequest(db: Db, id: string, status: "done" | "rejected_locked", jobRunId?: string | null): void {
  db.run("UPDATE schedule_job_request SET status = ?, job_run_id = ? WHERE id = ?", [status, jobRunId ?? null, id]);
}

// ── Heartbeat ──────────────────────────────────────────────────────────────

export function writeHeartbeat(db: Db, env: SchedulerEnv, now: Date): void {
  db.run(
    "INSERT INTO schedule_heartbeat (env, last_tick_at) VALUES (?, ?) ON CONFLICT(env) DO UPDATE SET last_tick_at = excluded.last_tick_at",
    [env, now.toISOString()],
  );
}
