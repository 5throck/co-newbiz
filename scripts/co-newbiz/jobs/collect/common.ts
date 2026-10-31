// @version 1.0.0
/**
 * Shared core of the five collect.* handlers (ADR-0189 phase P5, design
 * docs/designs/2026-10-29-scheduled-jobs-design.md sections 3.1/3.2). Each
 * handler is a thin config wrapper (key/cron/timeout/retry/catch-up) around
 * runCollectSource, which:
 *
 *   1. gates on the adapter's credentialEnv FIRST — a missing key ends the run
 *      `skipped` (reason `credential_missing`), NOT failed: intentionally
 *      disabled sources must not raise nightly false alarms (design section
 *      3.1 note). The adapter gets zero calls on this path.
 *   2. runs the fetchSource library — the same function the CLI `fetch` and
 *      `md:sync` cases call — and carries its counts structurally in job_run
 *      (rows_written / rows_changed / detail_json).
 *
 * Failure policy: a PARTIAL failure (some series/periods failed, some rows
 * landed) is a SUCCESS whose detail_json lists the isolated failures — a
 * permanently bad series must not trip the SRE "3 consecutive failures" rule
 * every night. A run where NOTHING landed is a job failure, retried through
 * the P1 runner's RetryableJobError backoff ONLY when every failure (or the
 * thrown catalog error) is network/5xx/429-class; anything else (auth errors,
 * payload errors, unit quarantines) fails terminally after one attempt.
 */
import { SOURCE_ADAPTERS } from "../../source-adapters.ts";
import { RetryableJobError, type JobContext, type JobResult } from "../types.ts";
import { fetchSource, isRetryableCollectError } from "./fetch-source.ts";

/** The five sources with a collect.* job (design section 3.1; opendata has none). */
export type CollectSourceCode = "dart" | "ecos" | "krx" | "kosis" | "law";

export async function runCollectSource(ctx: JobContext, source: CollectSourceCode): Promise<JobResult> {
  const adapter = SOURCE_ADAPTERS[source];
  if (!adapter) throw new Error(`collect: no adapter registered for source '${source}'`);

  // Credential gate first: zero adapter calls when the key is absent.
  if (!adapter.isEnabled()) {
    return { skipped: "credential_missing", detail: { source, credentialEnv: adapter.credentialEnv } };
  }

  let result;
  try {
    result = await fetchSource(ctx.db, source, { signal: ctx.signal });
  } catch (err) {
    // Catalog fetches (dart ZIP, law search) are all-or-nothing and surface here.
    if (isRetryableCollectError(err)) throw new RetryableJobError(`${source}: ${(err as Error).message}`);
    throw err;
  }
  if (!result.ok) {
    if (result.reason === "credential_missing") {
      // Defensive re-check inside fetchSource; reachable only if the credential
      // vanished between the gate above and the call.
      return { skipped: "credential_missing", detail: { source, credentialEnv: result.credentialEnv } };
    }
    // Unreachable today: collect handlers pass no seriesArg (full catalog) and
    // catalog adapters never return no_series_matched.
    throw new Error(`collect: ${result.source} matched no series (${result.seriesArg})`);
  }

  const detail = {
    source: result.source,
    kind: result.kind,
    series: result.series,
    rows_upserted: result.rowsUpserted,
    rows_changed: result.rowsChanged,
    md_source_registered: result.sourceRegistered,
    ...(result.catalog ? { catalog_inserted: result.catalog.inserted, catalog_existing: result.catalog.existing } : {}),
    failures: result.failures.map((f) => ({
      series_id: f.seriesId,
      ...(f.period ? { period: f.period } : {}),
      message: f.message,
      retryable: f.retryable,
    })),
  };

  if (result.rowsUpserted === 0 && result.failures.length > 0) {
    const msg = `${source}: all ${result.series} target(s) failed (${result.failures.length} failure(s)); first: ${result.failures[0].seriesId}: ${result.failures[0].message}`;
    if (result.failures.every((f) => f.retryable)) throw new RetryableJobError(msg);
    throw new Error(msg);
  }
  if (result.kind === "catalog" && result.rowsUpserted === 0) {
    // A catalog sync that comes back empty means the upstream payload changed
    // shape — fail loudly instead of reporting a green zero-row night.
    throw new Error(`${source}: catalog sync returned 0 rows (upstream payload change?)`);
  }

  return {
    // rows_read counts ATTEMPTS (upserts executed + failures), not successes:
    // a half-dead night must not look like a clean half-size run (data-architect
    // review 2026-11-01).
    rowsRead: result.rowsUpserted + result.failures.length,
    rowsWritten: result.rowsUpserted,
    rowsChanged: result.rowsChanged,
    detail,
  };
}
