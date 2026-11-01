// @version 1.0.0
/**
 * collect.krx — weekday 18:30 KST (after market close) KRX daily-close
 * collection (ADR-0189 phase P5, design section 3.1 row 3). Day-grain series
 * (KOSPI/KOSDAQ index closes, per-deal stock closes) collect through the
 * adapter's listDailyRows hook inside fetchSource; one API call per
 * (service × day) is shared across series and the adapter's pacing/budget
 * guards keep the run inside its quota.
 *
 * Cron 30 18 * * 1-5 (KST), timeout 20 min, max_retries 2 (RetryableJobError,
 * network/5xx/429 only — the adapter's internal single retry runs first),
 * catch-up run once if missed within 24 h (D7), credential KRX_API_KEY
 * (missing key → skipped/credential_missing).
 */
import type { JobHandler } from "../types.ts";
import { runCollectSource } from "./common.ts";

export const collectKrx: JobHandler = {
  key: "collect.krx",
  displayName: "KRX daily collection",
  description: "Collects KRX daily closes (index and per-deal stock series) into fact_market_observation after market close.",
  defaultCron: "30 18 * * 1-5",
  timeoutSec: 1200,
  maxRetries: 2,
  catchup: { mode: "once", maxAgeHours: 24 },
  run(ctx) {
    return runCollectSource(ctx, "krx");
  },
};
