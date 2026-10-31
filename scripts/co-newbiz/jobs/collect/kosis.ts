// @version 1.0.0
/**
 * collect.kosis — weekly Monday 09:00 KST KOSIS observation collection
 * (ADR-0189 phase P5, design section 3.1 row 4). Monthly-grain macro series
 * (production indices seeds) into fact_market_observation through the
 * fetchSource library; weekly cadence respects the KOSIS free-tier quota (D1).
 *
 * Cron 0 9 * * 1 (KST), timeout 30 min, max_retries 2 (RetryableJobError,
 * network/5xx/429 only), catch-up run once if missed within 24 h (D7),
 * credential KOSIS_API_KEY (missing key → skipped/credential_missing).
 */
import type { JobHandler } from "../types.ts";
import { runCollectSource } from "./common.ts";

export const collectKosis: JobHandler = {
  key: "collect.kosis",
  displayName: "KOSIS collection",
  description: "Collects KOSIS monthly statistical series (weekly) into fact_market_observation.",
  defaultCron: "0 9 * * 1",
  timeoutSec: 1800,
  maxRetries: 2,
  catchup: { mode: "once", maxAgeHours: 24 },
  run(ctx) {
    return runCollectSource(ctx, "kosis");
  },
};
