#!/usr/bin/env bun
// @version 1.1.0
//
// schedule-seed - idempotent default rows for the scheduled-jobs feature (ADR-0189, design 4.1 seed
// and D3): (1) default `schedule_job` rows for every registered handler, and (2) since the registry
// reconciliation (dba adjudication 2026-11-02 + owner adoption) default `retention_policy` rows for
// every registry-eligible table (db/lib/retention-registry.ts RETENTION_ELIGIBLE_TABLES - the D2
// defaults plus the dba session/llm_call_log rulings).
//
// Both seeders are INSERT-missing-only: an existing row is NEVER touched (an admin-edited cron, an
// enabled flag, or an admin-tuned policy such as the dev notification row at 6 months is never
// overwritten). Rows are created DISABLED (jobs) / with last_run_at NULL (policies). This script is
// the ONLY seeding path and is never run automatically: it needs an explicit environment and, when
// the target is not the dev database, an explicit --db-path. Enabling a job is a separate,
// deliberate admin action.
//
// Explicitly NOT seeded: dry_run_session - it is not registry-eligible (the retention executor
// refuses it; expired dry-run sessions are purged on the read path per migration 0172's TTL, see
// RETENTION_EXCLUDED_TABLES).
//
// Usage: CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-seed.ts [--db-path <path>] [--dry-run]
import { getDb } from "../../db/client.ts";
import { resolveSchedulerEnv } from "./scheduler-core.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { validateCron } from "../../app/web-next/lib/schedule/cron.ts";
import { listJobHandlers } from "./jobs/index.ts";
import {
  RETENTION_ELIGIBLE_TABLES,
  handlingToStoredAction,
} from "../../db/lib/retention-registry.ts";

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

/**
 * Idempotent default `retention_policy` rows: one per registry-eligible table, with the entry's
 * defaultBasis/defaultMonths and the stored action derived from handlingToStoredAction(entry.handling)
 * - the SAME vocabulary mapping the executor's action_mismatch guard compares against and the admin
 * route derives from, so every seeded row is guaranteed to pass the nightly retention.cleanup run
 * (guarded by the cross-module invariant test in tests/unit/retention-cleanup.test.ts).
 *
 * INSERT-missing-only: a table_key that already has a policy row is reported under `existing` and
 * left untouched (an admin-tuned row - e.g. the dev notification row at 6 months - always wins).
 * dry_run_session is intentionally absent: it is not registry-eligible (executor-refused, read-path
 * purge per migration 0172).
 */
export function seedRetentionPolicies(db: any, opts: { dryRun?: boolean } = {}): { inserted: string[]; existing: string[] } {
  const inserted: string[] = [];
  const existing: string[] = [];
  for (const entry of RETENTION_ELIGIBLE_TABLES) {
    const has = db.query("SELECT 1 FROM retention_policy WHERE table_key = ?").get(entry.table);
    if (has) {
      existing.push(entry.table);
      continue;
    }
    if (!opts.dryRun) {
      db.run(
        "INSERT INTO retention_policy (table_key, basis, retention_months, action, last_run_at) VALUES (?,?,?,?,NULL)",
        [entry.table, entry.defaultBasis, entry.defaultMonths, handlingToStoredAction(entry.handling)],
      );
    }
    inserted.push(entry.table);
  }
  return { inserted, existing };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--db-path");
  const dbPath = i !== -1 ? argv[i + 1] : undefined;
  try {
    const env = resolveSchedulerEnv();
    const dryRun = argv.includes("--dry-run");
    const db = getDb(dbPath);
    const jobs = seedScheduleJobs(db, new Date(), { dryRun });
    const policies = seedRetentionPolicies(db, { dryRun });
    console.log(
      JSON.stringify({
        env,
        dryRun,
        ...jobs,
        policies,
        note: "rows are created disabled; policy rows use the registry D2/dba defaults and never overwrite existing rows",
      }),
    );
  } catch (e) {
    console.error(`schedule-seed: ${(e as Error).message}`);
    process.exit(1);
  }
}
