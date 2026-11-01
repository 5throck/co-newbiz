// @version 1.0.0
/**
 * collect.ecos — daily 08:00 KST ECOS observation collection (ADR-0189 phase P5,
 * design section 3.1 row 2). Collects the Bank of Korea monthly interest-rate
 * series (721Y001 seeds) into fact_market_observation through the fetchSource
 * library — the same function the CLI `fetch --source ecos` case calls.
 *
 * Cron 0 8 * * * (KST), timeout 20 min, max_retries 2 (RetryableJobError,
 * network/5xx/429 only), catch-up run once if missed within 24 h (D7),
 * credential ECOS_API_KEY (missing key → skipped/credential_missing).
 */
import type { JobHandler } from "../types.ts";
import { runCollectSource } from "./common.ts";

export const collectEcos: JobHandler = {
  key: "collect.ecos",
  displayName: "ECOS collection",
  description: "Collects ECOS (Bank of Korea) monthly interest-rate observations into fact_market_observation.",
  defaultCron: "0 8 * * *",
  timeoutSec: 1200,
  maxRetries: 2,
  catchup: { mode: "once", maxAgeHours: 24 },
  run(ctx) {
    return runCollectSource(ctx, "ecos");
  },
};
