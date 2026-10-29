#!/usr/bin/env bun
// @version 1.0.0
//
// schedule-seed - idempotent default `schedule_job` rows for every registered handler (ADR-0189, design 4.1 seed and D3).
// Rows are created DISABLED. An existing row is never touched (an admin-edited cron or enabled flag is never overwritten).
// This script is the ONLY seeding path in P1 and is never run automatically: it needs an explicit environment and, when
// the target is not the dev database, an explicit --db-path. Enabling a job is a separate, deliberate admin action.
//
// Usage: CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-seed.ts [--db-path <path>] [--dry-run]
import { getDb } from "../../db/client.ts";
import { resolveSchedulerEnv } from "./scheduler-core.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { validateCron } from "../../app/web-next/lib/schedule/cron.ts";
import { listJobHandlers } from "./jobs/index.ts";

export function seedScheduleJobs(db: any, now: Date, opts: { dryRun?: boolean } = {}): { inserted: string[]; existing: string[] } {
  const inserted: string[] = [];
  const existing: string[] = [];
  for (const h of listJobHandlers()) {
    const v = validateCron(h.defaultCron);
    if (!v.ok) throw new Error(`default cron for ${h.key} is invalid: ${v.error}`);
    const has = db.query("SELECT 1 FROM schedule_job WHERE job_key = ?").get(h.key);
    if (has) {
      existing.push(h.key);
      continue;
    }
    if (!opts.dryRun) {
      db.run(
        `INSERT INTO schedule_job (id, job_key, cron_expr, enabled, created_at, display_name, description, timeout_sec, max_retries, updated_at, updated_by)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'seed')`,
        [ulid(), h.key, h.defaultCron, now.toISOString(), h.displayName, h.description, h.timeoutSec, h.maxRetries, now.toISOString()],
      );
    }
    inserted.push(h.key);
  }
  return { inserted, existing };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--db-path");
  const dbPath = i !== -1 ? argv[i + 1] : undefined;
  try {
    const env = resolveSchedulerEnv();
    const res = seedScheduleJobs(getDb(dbPath), new Date(), { dryRun: argv.includes("--dry-run") });
    console.log(JSON.stringify({ env, dryRun: argv.includes("--dry-run"), ...res, note: "rows are created disabled" }));
  } catch (e) {
    console.error(`schedule-seed: ${(e as Error).message}`);
    process.exit(1);
  }
}
