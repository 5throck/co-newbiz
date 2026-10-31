// @version 1.0.0
/**
 * collect.dart — weekday 07:00 KST full-market corp-code catalog sync
 * (ADR-0189 phase P5, design section 3.1 row 1).
 *
 * The design row reads "fetch adapter dart + md:sync dart"; for the catalog-kind
 * dart adapter both CLI commands perform the SAME operation (credential gate +
 * md_source registration + listCatalog + natural-key upsert of md_company), so
 * the handler performs that sync ONCE through the fetchSource library — the
 * same function both CLI cases call after the P5 extraction. Calling it twice
 * would download the ~100k-row corpCode ZIP twice for zero additional rows.
 *
 * Cron 0 7 * * 1-5 (KST), timeout 30 min, max_retries 2 (RetryableJobError,
 * network/5xx/429 only), catch-up run once if missed within 24 h (D7),
 * credential DART_API_KEY (missing key → skipped/credential_missing).
 */
import type { JobHandler } from "../types.ts";
import { runCollectSource } from "./common.ts";

export const collectDart: JobHandler = {
  key: "collect.dart",
  displayName: "DART corp-code sync",
  description: "Syncs the DART full-market corporation code catalog into md_company (natural-key upsert, idempotent).",
  defaultCron: "0 7 * * 1-5",
  timeoutSec: 1800,
  maxRetries: 2,
  catchup: { mode: "once", maxAgeHours: 24 },
  run(ctx) {
    return runCollectSource(ctx, "dart");
  },
};
