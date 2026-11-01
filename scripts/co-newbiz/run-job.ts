#!/usr/bin/env bun
// @version 1.0.0
//
// run-job - the scheduler's thin runner (ADR-0189, scheduled-jobs design 2.2 / 3.4 / 5). Executes ONE registered job
// handler: re-checks `enabled` (manual requests carry an explicit actor and bypass it), takes the lease lock, runs the
// handler under a timeout, records job_run start/end/status/error/counts, retries RetryableJobError, releases the lock.
// Errors are scrubbed of secrets and truncated to 2 KB before they are stored or printed.
//
// Usage:
//   CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/run-job.ts --job <job_key>
//        [--trigger schedule|manual|catchup] [--actor <user>] [--request <request id>] [--db-path <path>]
//
// Called by schedule-tick.ts (trigger schedule|catchup|manual with --request) or directly by an operator (default
// trigger manual, actor operator:cli). Exit code: 0 success/skipped/lock-held, 1 failed, 124 timeout.
import { join } from "node:path";
import { getDb, DB_DIR } from "../../db/client.ts";
import {
  acquireLock,
  completeRequest,
  consecutiveFailures,
  finishJobRun,
  leaseSeconds,
  releaseLock,
  resolveSchedulerEnv,
  startJobRun,
  type RunTrigger,
  type SchedulerEnv,
} from "./scheduler-core.ts";
import { scrubSecrets } from "../../db/lib/secret-scrubber.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { getJobHandler } from "./jobs/index.ts";
import { RetryableJobError } from "./jobs/types.ts";

export type RunJobOutcome = "success" | "skipped" | "failed" | "timeout" | "locked" | "no_handler" | "disabled";

export interface RunJobOptions {
  jobKey: string;
  env: SchedulerEnv;
  trigger: RunTrigger;
  actor?: string | null;
  requestId?: string | null;
  /** injectable clock (tests) */
  clock?: () => Date;
  reportDir?: string;
  /** delay between retry attempts, ms (default 5 min; tests pass 0) */
  retryDelayMs?: number;
  /** test override of the per-attempt timeout, ms */
  timeoutMsOverride?: number;
  /** lock holder identity */
  holder?: string;
  /** process exit (injectable for tests). Default process.exit. Used for the timeout exit (124) and the hard backstop. */
  exit?: (code: number) => void;
  /** test override of the hard backstop, ms (default: the lease length) */
  backstopMsOverride?: number;
}

export const REQUEST_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** L5: --request must be a ULID that names a request for THIS job_key. Returns an error message or null. */
export function validateRequest(db: any, requestId: string, jobKey: string): string | null {
  if (!REQUEST_ID_RE.test(requestId)) return `invalid --request '${requestId}' (expected a 26-char ULID)`;
  const r = db.query("SELECT job_key FROM schedule_job_request WHERE id = ?").get(requestId) as {
    job_key: string;
  } | null;
  if (!r) return `request ${requestId} not found`;
  if (r.job_key !== jobKey) return `request ${requestId} is for job '${r.job_key}', not '${jobKey}'`;
  return null;
}

export interface RunJobResult {
  outcome: RunJobOutcome;
  jobRunId: string | null;
  attempts: number;
}

export const DEFAULT_REPORT_DIR = join(DB_DIR, "data", "reports", "gate-integrity");
const DEFAULT_RETRY_DELAY_MS = 5 * 60_000;

/**
 * Jobs whose terminal failure is itself urgent: the batch_failure notification escalates from 'ops' to 'urgent'
 * (immediate delivery) for these keys. Named/exported so P6 (retention.cleanup) inherits the list.
 */
export const BATCH_FAILURE_URGENT_JOB_KEYS: ReadonlySet<string> = new Set(["watch.evaluate", "retention.cleanup"]);

/**
 * batch_failure hook (ADR-0189/0190 P3, design sections 13.2/13.4). Every terminal job failure writes ONE
 * `notification` row (user_id 'system', project_id NULL - nullable since migration 0072) so notify.deliver fans it
 * out through the recipient policy (D9: system/ops rows reach admins). severity 'ops' (daily bundle) except for
 * BATCH_FAILURE_URGENT_JOB_KEYS, which escalate to 'urgent' (immediate). dedupe_key buckets per job × UTC hour so a
 * flapping job cannot spam a notification every minute. The scrubbed stderr line stays: it is what the launchd log
 * shows. Everything is wrapped so alerting never masks the original error.
 */
export function onJobFailure(
  db: any,
  jobKey: string,
  jobRunId: string,
  status: string,
  error: string,
  now: Date = new Date(),
): void {
  try {
    const n = consecutiveFailures(db, jobKey);
    console.error(
      `[run-job] ${jobKey} ${status} run=${jobRunId} consecutive_failures=${n}: ${scrubSecrets(error, { maxLen: 300 })}`,
    );
    const urgent = BATCH_FAILURE_URGENT_JOB_KEYS.has(jobKey);
    const nowIso = now.toISOString();
    const hourBucket = nowIso.slice(0, 13); // YYYY-MM-DDTHH (UTC) - one batch_failure notification per job per hour
    db.run(
      `INSERT OR IGNORE INTO notification
         (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, dedupe_key, title, source_ref)
       VALUES (?, 'system', NULL, 'batch_failure', ?, ?, 'all', ?, ?, ?, ?, ?)`,
      [
        ulid(),
        urgent ? "urgent" : "ops",
        JSON.stringify({ job_key: jobKey, job_run_id: jobRunId, status, error: scrubSecrets(error, { maxLen: 500 }) }),
        urgent ? "immediate" : "daily",
        nowIso,
        `batch_failure:${jobKey}:${hourBucket}`,
        `${jobKey} failed`,
        `job_run:${jobRunId}`,
      ],
    );
  } catch {
    /* alerting must never mask the original error */
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runJob(db: any, opts: RunJobOptions): Promise<RunJobResult> {
  const clock = opts.clock ?? (() => new Date());
  const exit = opts.exit ?? ((c: number) => process.exit(c));
  if (opts.requestId) {
    const bad = validateRequest(db, opts.requestId, opts.jobKey);
    if (bad) throw new Error(bad);
  }
  const handler = getJobHandler(opts.jobKey);
  const finishRequest = (status: "done" | "rejected_locked", runId: string | null) => {
    if (opts.requestId) completeRequest(db, opts.requestId, status, runId);
  };

  if (!handler) {
    const id = startJobRun(db, {
      jobKey: opts.jobKey,
      env: opts.env,
      trigger: opts.trigger,
      actor: opts.actor,
      now: clock(),
    });
    const msg = `no registered handler for job_key '${opts.jobKey}'`;
    finishJobRun(db, id, { status: "failed", now: clock(), error: msg });
    onJobFailure(db, opts.jobKey, id, "failed", msg, clock());
    finishRequest("done", id);
    return { outcome: "no_handler", jobRunId: id, attempts: 1 };
  }

  const row = db
    .query("SELECT enabled, timeout_sec, max_retries FROM schedule_job WHERE job_key = ?")
    .get(opts.jobKey) as { enabled: number; timeout_sec: number; max_retries: number } | null;

  // Manual runs carry an explicit actor and are allowed on a disabled job; every other trigger re-checks the flag.
  if (opts.trigger !== "manual" && (!row || row.enabled !== 1)) {
    const id = startJobRun(db, {
      jobKey: opts.jobKey,
      env: opts.env,
      trigger: opts.trigger,
      actor: opts.actor,
      now: clock(),
    });
    finishJobRun(db, id, { status: "skipped", now: clock(), detail: { reason: "disabled" } });
    return { outcome: "disabled", jobRunId: id, attempts: 1 };
  }

  const timeoutSec = row?.timeout_sec ?? handler.timeoutSec;
  const maxRetries = row?.max_retries ?? handler.maxRetries;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const timeoutMs = opts.timeoutMsOverride ?? timeoutSec * 1000;
  const holder = opts.holder ?? `run-job-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  if (!acquireLock(db, opts.jobKey, holder, clock(), leaseSeconds(timeoutSec, maxRetries, retryDelayMs / 1000))) {
    // A concurrent run holds the lease: record nothing (design 3.4); a manual request is marked rejected_locked.
    finishRequest("rejected_locked", null);
    return { outcome: "locked", jobRunId: null, attempts: 0 };
  }

  let lastRunId: string | null = null;
  let attempt = 0;
  let outcome: RunJobOutcome = "failed";
  let exitedOnTimeout = false;
  // H2: hard backstop INSIDE the runner. If everything (retries included) outlives the lease, record the current run as
  // timed out and exit non-zero; the tick's detached spawn has no parent-side timeout, so this is the only enforcer.
  const backstopMs = opts.backstopMsOverride ?? leaseSeconds(timeoutSec, maxRetries, retryDelayMs / 1000) * 1000;
  const backstop = setTimeout(() => {
    try {
      if (lastRunId)
        finishJobRun(db, lastRunId, { status: "timeout", now: clock(), error: "backstop: run exceeded its lease" });
    } finally {
      exit(125);
    }
  }, backstopMs);
  try {
    for (;;) {
      attempt++;
      const runId = startJobRun(db, {
        jobKey: opts.jobKey,
        env: opts.env,
        trigger: opts.trigger,
        actor: opts.actor,
        attempt,
        now: clock(),
      });
      lastRunId = runId;
      const ac = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() =>
            handler.run({
              db,
              now: clock(),
              env: opts.env,
              signal: ac.signal,
              reportDir: opts.reportDir ?? DEFAULT_REPORT_DIR,
            }),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              ac.abort();
              reject(new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`));
            }, timeoutMs);
          }),
        ]);
        finishJobRun(db, runId, {
          status: result.skipped ? "skipped" : "success",
          now: clock(),
          rowsRead: result.rowsRead,
          rowsWritten: result.rowsWritten,
          rowsChanged: result.rowsChanged,
          detail: result.skipped ? { reason: result.skipped, ...(result.detail as object | undefined) } : result.detail,
        });
        outcome = result.skipped ? "skipped" : "success";
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (timedOut) {
          // M1: the handler may still be running (a synchronous or ignoring-signal handler cannot be cancelled), so
          // do NOT release the lock and carry on: record the timeout and exit the process. The lease expires on its own.
          // Handlers must therefore be async and check ctx.signal between units of work.
          finishJobRun(db, runId, { status: "timeout", now: clock(), error: msg });
          onJobFailure(db, opts.jobKey, runId, "timeout", msg, clock());
          outcome = "timeout";
          exitedOnTimeout = true;
          break;
        }
        const willRetry = err instanceof RetryableJobError && attempt <= maxRetries;
        // M3: an attempt that will be retried is marked so failure streaks count distinct runs (final attempts only).
        finishJobRun(db, runId, {
          status: "failed",
          now: clock(),
          error: msg,
          ...(willRetry ? { detail: { retried: true } } : {}),
        });
        if (willRetry) {
          if (retryDelayMs > 0) await sleep(retryDelayMs);
          continue;
        }
        onJobFailure(db, opts.jobKey, runId, "failed", msg, clock());
        outcome = "failed";
        break;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } finally {
    clearTimeout(backstop);
    if (!exitedOnTimeout) releaseLock(db, opts.jobKey, holder);
    finishRequest("done", lastRunId);
  }
  if (exitedOnTimeout) exit(124);
  return { outcome, jobRunId: lastRunId, attempts: attempt };
}

/**
 * M5: everything this process (and the handlers it runs) writes to stdout/stderr passes through the scrubber, so the
 * launchd logs never receive a secret even from a handler that logs a raw URL. Installed only by the CLI entrypoint.
 */
export function installScrubbedOutput(): void {
  for (const stream of [process.stdout, process.stderr] as const) {
    const orig = stream.write.bind(stream) as (chunk: any, ...rest: any[]) => boolean;
    stream.write = ((chunk: any, ...rest: any[]) =>
      orig(
        typeof chunk === "string" ? scrubSecrets(chunk, { maxLen: Number.MAX_SAFE_INTEGER }) : chunk,
        ...rest,
      )) as typeof stream.write;
  }
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const jobKey = arg(argv, "--job");
  if (!jobKey) {
    console.error(
      "usage: run-job.ts --job <job_key> [--trigger schedule|manual|catchup] [--actor <user>] [--request <id>] [--db-path <path>]",
    );
    process.exit(2);
  }
  let env: SchedulerEnv;
  try {
    env = resolveSchedulerEnv();
  } catch (e) {
    console.error(`run-job: ${(e as Error).message}`);
    process.exit(2);
  }
  const trigger = (arg(argv, "--trigger") ?? "manual") as RunTrigger;
  if (!["schedule", "manual", "catchup"].includes(trigger)) {
    console.error(`run-job: invalid --trigger ${trigger}`);
    process.exit(2);
  }
  const requestArg = arg(argv, "--request");
  if (requestArg !== undefined && !REQUEST_ID_RE.test(requestArg)) {
    console.error(`run-job: invalid --request '${requestArg.slice(0, 40)}' (expected a 26-char ULID)`);
    process.exit(2);
  }
  const { loadRootEnvPipelineKeys } = await import("../../app/web-next/lib/llm.ts");
  loadRootEnvPipelineKeys();
  installScrubbedOutput();
  const db = getDb(arg(argv, "--db-path"));
  const actor = arg(argv, "--actor") ?? (trigger === "manual" ? "operator:cli" : null);
  try {
    const res = await runJob(db, {
      jobKey,
      env,
      trigger,
      actor,
      requestId: requestArg ?? null,
      reportDir: process.env.CO_NEWBIZ_REPORT_DIR,
    });
    console.log(JSON.stringify(res));
    process.exit(res.outcome === "failed" || res.outcome === "no_handler" ? 1 : res.outcome === "timeout" ? 124 : 0);
  } catch (e) {
    const msg = scrubSecrets(e);
    console.error(`run-job failed: ${msg}`);
    process.exit(/^(invalid --request|request )/.test(msg) ? 2 : 1);
  }
}
