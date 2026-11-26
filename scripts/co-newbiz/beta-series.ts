// @version 1.4.0
// 1.4.0: the flow itself moved to beta-series-core.ts (runBetaCollection, callable in-process — the web
// "수집 실행" route shares it); this file is now only argv parsing + exit codes. CLI behavior, output and
// exit codes are unchanged; betaSeriesMain stays exported for tests.
// 1.3.1: lint-gate cleanup only (biome whole-file scan on the changed file blocked the quality
// gate) — useTemplate string concat → template literal, `let rows: KrxDailyRow[]` instead of an
// implicit-any let, biome format drift; no behavior change.
/**
 * beta-series.ts — register and collect KRX beta inputs (index + subject/target
 * daily closes) for one brownfield project (WACC beta regression, issue #2 of
 * the beta-series work).
 *
 * Registers (in-process, via registerKrxSeries) a day-grain series per
 * shortlisted target company (seriesId convention `krx:stock:<md_company.id>:close`,
 * documented deviation — md_company has no ISIN/short-code column), then
 * collects KOSPI + KOSDAQ index closes plus each company's daily closes into
 * fact_market_observation via the same ensure_fresh path as `newbiz fetch`.
 *
 * v1.3.0 (owner decision 2026-11-02, option 1): each registration is ALSO
 * persisted to the stock_series table (migration 0187, upsert by company_id
 * via db/repositories/stock-series.repository.ts, registered_by 'beta-series')
 * in addition to the in-process registration — from then on the nightly
 * collect.krx job collects the company's closes in every process, not just
 * where a beta run registered them. Re-registration updates the row and
 * clears a soft disable; an identical enabled row is a no-op.
 *
 * KRX request shape: every daily service is called with ONE reference date
 * (basDd=YYYYMMDD) per weekday; one call per (service, day) is shared across
 * all series of that service (source-adapters.ts listKrxDailyRows). Expect
 * roughly weekdays x distinct services calls (~22 x 3 per month here).
 *
 * 단축코드 (short code) resolution: the stock-master services
 * (sto/stk_isu_base_info / sto/ksq_isu_base_info) are called with basDd and
 * filtered by abbreviated name (exact → startsWith → includes; ambiguity is
 * reported). A resolved code is cached in db/data/krx-stock-code-cache.json
 * keyed by md_company.id. Pass --ticker to pin a code explicitly.
 *
 * Listing market: the resolved market (KOSPI/KOSDAQ) is also persisted to the
 * DB raw layer (raw_payload id `krx:stock-master:<md_company.id>`, see
 * db/repositories/krx-listing.repository.ts) so the web beta-series route can
 * default to the listing-market index. `--backfill-market` writes ONLY that
 * metadata from the local cache for already-collected companies — no KRX calls,
 * no KRX_API_KEY needed, idempotent.
 *
 * Web trigger: POST /api/projects/[id]/wacc/beta-series/collect runs the same core (runBetaCollection in
 * beta-series-core.ts) in-process for analyst users; this CLI stays the operator/runbook path.
 *
 * Scheduling: there is no host scheduler running locally — run this manually
 * (monthly, or more often; ensure_fresh makes reruns cache-hit), or wire it
 * into the host cron when one exists. See docs/runbooks/beta-series-collection.md.
 *
 * Usage:
 *   bun scripts/co-newbiz/beta-series.ts --project <md_project.id> [--from YYYY-MM] [--to YYYY-MM] [--ticker <companyName=code>]... [--budget N]
 *   bun scripts/co-newbiz/beta-series.ts --project <md_project.id> --backfill-market
 *
 * Authorization note: writes ONLY market data (md_source/md_unit/md_period/
 * fact_market_observation, plus the raw_payload stock-master record) to the
 * production DB — nothing else.
 */
import { BetaSeriesError, runBetaCollection } from "./beta-series-core.ts";

export { BetaSeriesError, monthRange, runBetaCollection } from "./beta-series-core.ts";

/**
 * The CLI entry point. `pacing` exists for tests only — production runs take
 * the adapter's burst-safe defaults (250ms spacing) via resetKrxRunState.
 */
async function main(
  argv: string[] = process.argv.slice(2),
  pacing: { minIntervalMs?: number; retryDelayMs?: number } = {},
): Promise<void> {
  const args = argv;
  const idx = args.indexOf("--project");
  const projectId = idx >= 0 ? args[idx + 1] : undefined;
  if (!projectId) {
    console.error(
      "usage: beta-series --project <md_project.id> [--from YYYY-MM] [--to YYYY-MM] [--ticker <회사명=단축코드>]...",
    );
    process.exit(2);
  }
  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");
  const tickers: Array<[string, string]> = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--ticker") {
      const [name, code] = (args[i + 1] ?? "").split("=");
      if (name && code) tickers.push([name, code]);
    }
  }
  const budgetIdx = args.indexOf("--budget");
  const budget = budgetIdx >= 0 ? Number(args[budgetIdx + 1]) : undefined;

  try {
    await runBetaCollection({
      projectId,
      from: fromIdx >= 0 ? args[fromIdx + 1] : undefined,
      to: toIdx >= 0 ? args[toIdx + 1] : undefined,
      tickers,
      budget,
      backfillOnly: args.includes("--backfill-market"),
      pacing,
    });
  } catch (err) {
    if (err instanceof BetaSeriesError) {
      // The 0-observation diagnosis was always printed after a blank line.
      console.error(`${err.code === "zero_collected" ? "\n" : ""}${err.label}: ${err.message}`);
      process.exit(err.exitCode);
    }
    throw err;
  }
}

// Exported for tests (import.meta.main guard: running as a script still
// executes the flow; importing it does not).
export { main as betaSeriesMain };

if (import.meta.main) await main();
