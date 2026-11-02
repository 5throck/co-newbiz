// @version 1.0.0
/**
 * Shared server-side validation for schedule_job mutations — PATCH update and POST create
 * (design 2026-10-29-scheduled-jobs-design §4.1/§4.3). One source for the cron rules and the
 * numeric ranges so the two routes can never drift: create's `validation reuses PATCH rules`
 * is enforced by importing this module in both routes.
 *
 * Errors come back as structured results, not responses — this module stays envelope-free and
 * each route maps the code onto its own badRequest() call.
 */
import { nextFireTimes, validateCron } from "./cron.ts";

/** Crons must not fire more often than every 5 minutes (§4.1 interval floor) except these keys. */
export const INTERVAL_FLOOR_MS = 300_000;
// §13.2: notify.deliver is INTENTIONALLY `* * * * *` (one fire per tick — delivery worker);
// watch.evaluate is likewise exempt (flagged in the P3 Row 0 drift notes, never had a route to
// live in until the PATCH route).
export const INTERVAL_FLOOR_EXEMPT_KEYS = new Set(["watch.evaluate", "notify.deliver"]);

/** Fires the next two times and requires >= 300 s between them — the honest minimal check with the shared parser. */
export function cronTooFrequent(expr: string, now: Date): boolean {
  const fires = nextFireTimes(expr, now, 2);
  return fires.length === 2 && fires[1].getTime() - fires[0].getTime() < INTERVAL_FLOOR_MS;
}

export type CronCheck =
  | { ok: true; cron_expr: string }
  | { ok: false; code: "invalid_cron" | "cron_too_frequent"; message: string };

/** validateCron plus the 5-minute floor with the §13.2 exemptions, keyed by the job's job_key. */
export function checkCronForJob(expr: unknown, jobKey: string, now: Date): CronCheck {
  if (typeof expr !== "string") {
    return { ok: false, code: "invalid_cron", message: "cron_expr must be a string." };
  }
  const check = validateCron(expr); // same parser the tick uses — §4.1 one-parser mandate
  if (!check.ok) {
    return { ok: false, code: "invalid_cron", message: `invalid cron expression: ${check.error}` };
  }
  if (!INTERVAL_FLOOR_EXEMPT_KEYS.has(jobKey) && cronTooFrequent(expr, now)) {
    return { ok: false, code: "cron_too_frequent", message: "schedule interval must be at least 5 minutes." };
  }
  return { ok: true, cron_expr: expr };
}

/** timeout_sec: integer 60..7200 (§4.3 floor: 1–120 minutes stored as seconds). Applies to explicitly supplied values only — registry defaults may legitimately sit below the floor (notify.deliver runs at 50 s, §13.2). */
export function isValidTimeoutSec(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 60 && v <= 7200;
}

/** max_retries: integer 0..5 (explicitly supplied values only). */
export function isValidMaxRetries(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5;
}
