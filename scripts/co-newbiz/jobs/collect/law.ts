// @version 1.0.0
/**
 * collect.law — daily 06:00 KST statute catalog sync (ADR-0189 phase P5,
 * design section 3.1 row 5). The design row reads "fetch law + md:sync law";
 * the law adapter is catalog-kind, so both CLI commands perform the SAME
 * operation (credential gate + md_source registration + listCatalog +
 * natural-key upsert of md_statute) and the handler performs it ONCE through
 * the fetchSource library. The operating WHITELIST (LAW_WHITELIST, the
 * deal-review statutes) stays the daily default — `all: false` here; a full
 * sweep (thousands of statutes) remains an explicit operator action via the
 * CLI, not a nightly habit.
 *
 * Design drift (reported, not improvised): design section 3.1's idempotency
 * cell says "upsert by statute id + promulgation date", but the law adapter
 * collects 법령일련번호/법령명 only — md_statute has no promulgation-date
 * column, so the upsert key is korea_statute_id alone (pre-P5 behavior,
 * unchanged). Extending the schema is a data-architect change.
 *
 * Cron 0 6 * * * (KST), timeout 30 min, max_retries 2 (RetryableJobError,
 * network/5xx/429 only), catch-up run once if missed within 24 h (D7),
 * credential LAW_API_OC (missing key → skipped/credential_missing).
 */
import type { JobHandler } from "../types.ts";
import { runCollectSource } from "./common.ts";

export const collectLaw: JobHandler = {
  key: "collect.law",
  displayName: "Statute catalog sync",
  description: "Syncs the deal-review statute whitelist from 법제처 into md_statute (natural-key upsert, idempotent).",
  defaultCron: "0 6 * * *",
  timeoutSec: 1800,
  maxRetries: 2,
  catchup: { mode: "once", maxAgeHours: 24 },
  run(ctx) {
    return runCollectSource(ctx, "law");
  },
};
