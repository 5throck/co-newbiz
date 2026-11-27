// @version 1.0.0
/**
 * collect.kofia - weekday 18:45 KST scheduled collection of the KOFIA grade-by-rating corporate bond yields (ADR-0208
 * slice 4). KOFIA publishes one set per business day; this job stores the latest published day (and backfills the
 * business days still missing within the last KOFIA_BACKFILL_DAYS calendar days) as day-grain observations, so the WACC
 * suggestions only ever READ stored data and the manual button is a fallback, not the data path.
 *
 * Dedicated handler, NOT a SOURCE_ADAPTERS entry (db/lib/kofia-grade-yield.ts, kofia-collector.ts): the generic
 * `fetch` / `md:sync` / collect.* paths must never reach the KOFIA collector, whose service is undocumented and whose
 * automated use is switched off by default. Same gate here: with CO_NEWBIZ_KOFIA_COLLECT not "on" the run ends
 * `skipped` (reason kofia_collect_off, logged in job_run) and makes no network call.
 *
 * Cron 45 18 * * 1-5 (KST; 15 minutes after collect.krx), timeout 10 min, max_retries 2 (RetryableJobError for
 * network/5xx/429 only; a layout change is terminal and loud), catch-up run once if missed within 24 h (D7).
 * Already stored days are not fetched again on a scheduled or catch-up run (a holiday weekday costs one POST). A MANUAL run
 * (admin "run now" on the schedule page, or run-job --trigger manual) is the admin's force: it fetches the latest day
 * again (an unchanged value writes nothing; a changed one is stored as a revision). Admins cannot reach the project
 * collect route (FR-SEC-03), so this is their path.
 */
import { KOFIA_BACKFILL_DAYS, KOFIA_COLLECT_ENV } from "../../../../db/lib/kofia-grade-yield.ts";
import {
  DEFAULT_KOFIA_DEPS,
  collectKofiaGradeYields,
  kofiaCollectEnabled,
} from "../../../../app/web-next/lib/kofia-collector.ts";
import { RetryableJobError, type JobHandler } from "../types.ts";
import { isRetryableCollectError } from "./fetch-source.ts";

export const collectKofia: JobHandler = {
  key: "collect.kofia",
  displayName: "KOFIA grade-yield collection",
  description:
    "Collects the KOFIA valuation-firm average 3y yields of the AAA..BBB- corporate bond grades and the KTB 3y into fact_market_observation after publication (off unless CO_NEWBIZ_KOFIA_COLLECT=on).",
  defaultCron: "45 18 * * 1-5",
  timeoutSec: 600,
  maxRetries: 2,
  catchup: { mode: "once", maxAgeHours: 24 },
  async run(ctx) {
    if (!kofiaCollectEnabled()) {
      return {
        skipped: "kofia_collect_off",
        detail: { switch: KOFIA_COLLECT_ENV, message: `${KOFIA_COLLECT_ENV} is not "on": nothing was fetched.` },
      };
    }
    try {
      const r = await collectKofiaGradeYields(ctx.db, ctx.now, DEFAULT_KOFIA_DEPS, {
        backfillDays: KOFIA_BACKFILL_DAYS,
        skipStoredDays: ctx.trigger !== "manual",
        signal: ctx.signal,
      });
      return {
        rowsRead: 1 + 2 * (r.days_stored.length + r.backfill_no_data.length + r.backfill_failed.length),
        rowsWritten: r.rows_written_total,
        rowsChanged: r.rows_changed,
        detail: {
          max_published_date: r.max_published_date,
          days_stored: r.days_stored,
          days_already_stored: r.days_already_stored,
          backfill_no_data: r.backfill_no_data,
          backfill_failed: r.backfill_failed,
          ktb_pct: r.ktb_pct,
          warnings: r.warnings,
          source_url: r.source_url,
        },
      };
    } catch (err) {
      if (isRetryableCollectError(err)) throw new RetryableJobError(`kofia: ${(err as Error).message}`);
      throw err;
    }
  },
};
