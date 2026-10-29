#!/usr/bin/env bun
// @version 1.0.0
//
// schedule-tick - the single minute-tick dispatcher (ADR-0189, scheduled-jobs design 2.1 / 2.2). The OS scheduler
// (launchd / systemd / Task Scheduler) fires this short-lived process every minute; it decides, spawns, and exits.
// It never runs handler code itself.
//
//   1. refuse unless CO_NEWBIZ_SCHEDULER_ENV is prod|dev
//   2. write the heartbeat (schedule_heartbeat) FIRST, so a later failure still shows the tick fired
//   3. sweep stale 'running' job_run rows and expired locks (timeout_or_crash)
//   4. read schedule_job (enabled, cron_expr) -> due jobs; claim pending run-now requests
//   5. spawn `run-job.ts` once per due job / request (detached, one child each)
//
// Usage: CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-tick.ts [--db-path <path>] [--dry-run]
// Exit code: 0 ok, 2 refused (env / schema missing).
import { join } from "node:path";
import { getDb } from "../../db/client.ts";
import {
  claimQueuedRequests,
  completeRequest,
  finishJobRun,
  startJobRun,
  collectDueJobs,
  resolveSchedulerEnv,
  sweepStaleRuns,
  writeHeartbeat,
  type RunTrigger,
  type SchedulerEnv,
} from "./scheduler-core.ts";
import { scrubSecrets } from "../../db/lib/secret-scrubber.ts";
import { getJobHandler } from "./jobs/index.ts";

export interface SpawnRequest {
  jobKey: string;
  trigger: RunTrigger;
  actor?: string;
  requestId?: string;
  timeoutSec: number;
}

export type Spawner = (req: SpawnRequest) => void;

export interface TickSummary {
  env: SchedulerEnv;
  tickAt: string;
  reclaimed: number;
  locksCleared: number;
  dispatched: Array<{ jobKey: string; trigger: RunTrigger; fireMinute?: string; requestId?: string }>;
  skippedMissed: Array<{ jobKey: string; fireMinute: string }>;
  invalid: Array<{ jobKey: string; error: string }>;
}

const RUN_JOB_PATH = join(import.meta.dirname, "run-job.ts");

/**
 * Spawn options for the run-job child. H1: the child must OUTLIVE the tick, so it is `detached` (own process group) and
 * there is NO parent-side timeout (a parent-side timer dies with the tick; run-job enforces its own timeout and a hard
 * backstop, H2). The P2 launchd plist MUST set `AbandonProcessGroup = true`, otherwise launchd kills the tick's process
 * group - children included - when the tick exits (design section 7).
 */
export function spawnOptions(dbPath?: string) {
  return {
    env: { ...process.env, ...(dbPath ? { CO_NEWBIZ_DB_PATH: dbPath } : {}) },
    stdio: ["ignore", "inherit", "inherit"] as ["ignore", "inherit", "inherit"],
    detached: true,
  };
}

export function bunSpawner(dbPath?: string): Spawner {
  return (req) => {
    const args = [process.execPath, RUN_JOB_PATH, "--job", req.jobKey, "--trigger", req.trigger];
    if (req.actor) args.push("--actor", req.actor);
    if (req.requestId) args.push("--request", req.requestId);
    const proc = Bun.spawn(args, spawnOptions(dbPath));
    proc.unref();
  };
}

export function runTick(db: any, opts: { env: SchedulerEnv; now: Date; spawn: Spawner }): TickSummary {
  const { env, now, spawn } = opts;
  writeHeartbeat(db, env, now);
  const swept = sweepStaleRuns(db, now);
  const scan = collectDueJobs(db, now, (k) => getJobHandler(k)?.catchup ?? { mode: "skip" });
  const summary: TickSummary = {
    env,
    tickAt: now.toISOString(),
    reclaimed: swept.reclaimed,
    locksCleared: swept.locksCleared,
    dispatched: [],
    skippedMissed: scan.skippedMissed,
    invalid: scan.invalid,
  };
  // L1: the fire cursor is already consumed (compare-and-set), so a spawn that throws must leave a trace.
  const safeSpawn = (req: SpawnRequest): string | null => {
    try {
      spawn(req);
      return null;
    } catch (e) {
      const id = startJobRun(db, { jobKey: req.jobKey, env, trigger: req.trigger, actor: req.actor, now });
      finishJobRun(db, id, { status: "skipped", now, detail: { reason: "spawn_failed", error: scrubSecrets(e, { maxLen: 300 }) } });
      return id;
    }
  };
  for (const d of scan.due) {
    safeSpawn({ jobKey: d.jobKey, trigger: d.trigger, timeoutSec: d.timeoutSec });
    summary.dispatched.push({ jobKey: d.jobKey, trigger: d.trigger, fireMinute: d.fireMinute });
  }
  for (const r of claimQueuedRequests(db)) {
    const row = db.query("SELECT timeout_sec FROM schedule_job WHERE job_key = ?").get(r.jobKey) as { timeout_sec: number } | null;
    const failedRun = safeSpawn({ jobKey: r.jobKey, trigger: "manual", actor: r.requestedBy, requestId: r.id, timeoutSec: row?.timeout_sec ?? getJobHandler(r.jobKey)?.timeoutSec ?? 600 });
    if (failedRun) completeRequest(db, r.id, "done", failedRun);
    summary.dispatched.push({ jobKey: r.jobKey, trigger: "manual", requestId: r.id });
  }
  return summary;
}

function schedulerSchemaReady(db: any): boolean {
  return !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schedule_heartbeat'").get();
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--db-path");
  const dbPath = i !== -1 ? argv[i + 1] : undefined;
  let env: SchedulerEnv;
  try {
    env = resolveSchedulerEnv();
  } catch (e) {
    console.error(`schedule-tick: ${(e as Error).message}`);
    process.exit(2);
  }
  try {
    const { loadRootEnvPipelineKeys } = await import("../../app/web-next/lib/llm.ts");
    loadRootEnvPipelineKeys();
    const db = getDb(dbPath);
    if (!schedulerSchemaReady(db)) {
      console.error("schedule-tick: scheduler schema missing (migration 0183 not applied) - run `bun db/migrate.ts` first");
      process.exit(2);
    }
    const dry = argv.includes("--dry-run");
    const summary = runTick(db, { env, now: new Date(), spawn: dry ? () => {} : bunSpawner(dbPath) });
    console.log(JSON.stringify(summary));
    process.exit(0);
  } catch (e) {
    console.error(`schedule-tick failed: ${scrubSecrets(e)}`);
    process.exit(1);
  }
}
