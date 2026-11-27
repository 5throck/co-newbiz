// @version 1.0.0
// KOFIA collection status for the WACC panel (ADR-0208 slice 4, scheduled collection): stored data and the schedule row
// only - no network, no switch-gated work. `enabled` says whether collection may run at all (CO_NEWBIZ_KOFIA_COLLECT);
// the freshness comes from the stored observations (kofiaFreshness); the next run is computed from the scheduler's own
// schedule_job row with the scheduler's own cron module, so the panel can never disagree with what the tick will do.
import type { Database } from "bun:sqlite";
import { KOFIA_JOB_KEY, kofiaFreshness } from "../../../db/lib/kofia-grade-yield.ts";
import { kofiaCollectEnabled } from "./kofia-collector.ts";
import { nextFire, parseCron } from "./schedule/cron.ts";

export type KofiaNextRun =
  /** The job row is enabled: `at` is the next fire instant (ISO, UTC). */
  | { state: "scheduled"; at: string; cron: string }
  /** The job row exists but is switched off (enable it on the admin schedule page). */
  | { state: "disabled"; at: null; cron: string }
  /** No job row (schedule-seed has not run) or an unparsable cron expression. */
  | { state: "not_registered"; at: null; cron: null };

export interface KofiaCollectStatus {
  enabled: boolean;
  latest_date: string | null;
  expected_date: string;
  up_to_date: boolean;
  next_run: KofiaNextRun;
}

export function kofiaNextRun(db: Database, now: Date): KofiaNextRun {
  const row = db.query("SELECT enabled, cron_expr FROM schedule_job WHERE job_key = ?").get(KOFIA_JOB_KEY) as
    | { enabled: number; cron_expr: string }
    | undefined;
  if (!row) return { state: "not_registered", at: null, cron: null };
  if (row.enabled !== 1) return { state: "disabled", at: null, cron: row.cron_expr };
  try {
    const at = nextFire(parseCron(row.cron_expr), now);
    return at
      ? { state: "scheduled", at: at.toISOString(), cron: row.cron_expr }
      : { state: "not_registered", at: null, cron: null };
  } catch {
    return { state: "not_registered", at: null, cron: null };
  }
}

export function kofiaCollectStatus(db: Database, now: Date = new Date()): KofiaCollectStatus {
  const f = kofiaFreshness(db, now);
  return {
    enabled: kofiaCollectEnabled(),
    latest_date: f.latestStoredDate,
    expected_date: f.expectedDate,
    up_to_date: f.upToDate,
    next_run: kofiaNextRun(db, now),
  };
}
