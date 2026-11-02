// @version 1.3.0
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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { KOSIS_UNITS } from "./kosis-units.ts";
import { loadPipelineKeys } from "../lib/env-keys.ts";
import {
  KRX_SEED_SERIES,
  listKrxDailyRows,
  registerKrxSeries,
  krxStockSeries,
  krxRunStats,
  krxWeekdays,
  resetKrxRunState,
  resolveKrxStockMaster,
} from "./source-adapters.ts";
import { normalizeKrxMarket, upsertKrxListing } from "../../db/repositories/krx-listing.repository.ts";
import { upsertStockSeries } from "../../db/repositories/stock-series.repository.ts";

const CACHE_PATH = resolve(import.meta.dir, "../../db/data/krx-stock-code-cache.json");
const CACHE_VERSION = 1;

interface StockCodeCache {
  version: number;
  updated_at: string;
  codes: Record<string, { shortCode: string; market: string; nameKo: string; resolvedAt: string }>;
}

function loadCache(): StockCodeCache {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as StockCodeCache;
    if (parsed.version === CACHE_VERSION) return parsed;
  } catch {
    // first run — start empty
  }
  return { version: CACHE_VERSION, updated_at: new Date().toISOString(), codes: {} };
}

async function saveCache(cache: StockCodeCache): Promise<void> {
  cache.updated_at = new Date().toISOString();
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n");
}

function ensureUnit(db: ReturnType<typeof getDb>, unitCode: string): string {
  const existing = db.query("SELECT id FROM md_unit WHERE code = ?").get(unitCode) as { id: string } | undefined;
  if (existing) return existing.id;
  const mapping = Object.values(KOSIS_UNITS).find((u) => u.unitCode === unitCode);
  if (!mapping) throw new Error(`unit '${unitCode}' has no md_unit mapping (kosis-units.ts)`);
  const id = ulid();
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)",
    [id, mapping.unitCode, mapping.dimension, mapping.siCoefficient, new Date().toISOString()]);
  return id;
}

/** YYYY-MM list, inclusive, defaulting to the 13 months ending this month. */
function monthRange(fromArg?: string, toArg?: string): string[] {
  const now = new Date();
  const to = toArg ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [ty, tm] = to.split("-").map(Number);
  const start = fromArg ? new Date(Number(fromArg.split("-")[0]), Number(fromArg.split("-")[1]) - 1, 1)
    : new Date(ty, tm - 13, 1);
  const end = new Date(ty, tm - 1, 1);
  const months: string[] = [];
  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

/**
 * The flow entry point. `pacing` exists for tests only — production runs take
 * the adapter's burst-safe defaults (250ms spacing) via resetKrxRunState.
 */
async function main(argv: string[] = process.argv.slice(2), pacing: { minIntervalMs?: number; retryDelayMs?: number } = {}): Promise<void> {
  const args = argv;
  const idx = args.indexOf("--project");
  const projectId = idx >= 0 ? args[idx + 1] : undefined;
  if (!projectId) {
    console.error("usage: beta-series --project <md_project.id> [--from YYYY-MM] [--to YYYY-MM] [--ticker <회사명=단축코드>]...");
    process.exit(2);
  }
  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");
  const months = monthRange(fromIdx >= 0 ? args[fromIdx + 1] : undefined, toIdx >= 0 ? args[toIdx + 1] : undefined);
  const tickers: Array<[string, string]> = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === "--ticker") {
      const [name, code] = (args[i + 1] ?? "").split("=");
      if (name && code) tickers.push([name, code]);
    }
  }

  const backfillOnly = args.includes("--backfill-market");
  const budgetIdx = args.indexOf("--budget");
  const budget = budgetIdx >= 0 ? Number(args[budgetIdx + 1]) : undefined;
  resetKrxRunState({ budget: budget && budget > 0 ? budget : undefined, minIntervalMs: pacing.minIntervalMs, retryDelayMs: pacing.retryDelayMs });
  loadPipelineKeys();
  if (!backfillOnly && !process.env.KRX_API_KEY) {
    console.error("beta-series: KRX_API_KEY is not set (.env) — nothing can be collected.");
    process.exit(1);
  }

  const db = getDb();
  const project = db.query("SELECT id, project_name, company_id, source_opportunity_id FROM md_project WHERE id = ?")
    .get(projectId) as { id: string; project_name: string; company_id: string | null; source_opportunity_id: string | null } | undefined;
  if (!project) {
    console.error(`beta-series: project '${projectId}' not found.`);
    process.exit(1);
  }

  // Companies in scope: the subject company + every shortlisted target.
  const companies = new Map<string, { id: string; nameKo: string }>();
  if (project.company_id) {
    const c = db.query("SELECT id, name_ko FROM md_company WHERE id = ?").get(project.company_id) as { id: string; name_ko: string } | undefined;
    if (c) companies.set(c.id, { id: c.id, nameKo: c.name_ko });
  }
  if (project.source_opportunity_id) {
    const rows = db.query("SELECT company_name, dart_corp_code FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted' ORDER BY rank")
      .all(project.source_opportunity_id) as Array<{ company_name: string; dart_corp_code: string | null }>;
    for (const t of rows) {
      const c = db.query("SELECT id, name_ko FROM md_company WHERE name_ko = ?").get(t.company_name) as { id: string; name_ko: string } | undefined;
      if (c) companies.set(c.id, { id: c.id, nameKo: c.name_ko });
    }
  }
  if (companies.size === 0) {
    console.error("beta-series: no subject/shortlisted company found for the project — nothing to register.");
    process.exit(1);
  }

  if (backfillOnly) {
    await backfillListingMarkets(db, [...companies.values()]);
    return;
  }

  // md_source registration (krx, grade A — official exchange data).
  if (!db.query("SELECT id FROM md_source WHERE code = 'krx'").get()) {
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)",
      [ulid(), "krx", "A", new Date().toISOString()]);
    console.log("md_source: registered 'krx' (grade A)");
  }
  const sourceId = (db.query("SELECT id FROM md_source WHERE code = 'krx'").get() as { id: string }).id;
  const indexUnitId = ensureUnit(db, "index");
  const krwUnitId = ensureUnit(db, "krw");

  const { ensureFresh } = await import("../../db/repositories/observation.repository.ts");
  const sha256Hex = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));

  async function upsertPeriod(dayIso: string): Promise<string> {
    const key = dayIso.slice(0, 10);
    // md_period CHECK allows date|month|quarter|year (no 'day'); fiscal_year is NOT NULL.
    const existing = db.query("SELECT id FROM md_period WHERE period_type = 'date' AND start_date = ? AND end_date = ?")
      .get(key, key) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = ulid();
    db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
      [id, "date", key, key, Number(key.slice(0, 4)), new Date().toISOString()]);
    return id;
  }

  let collected = 0;
  interface SeriesReport { months: number; weekdays: number; tradingDays: number; written: number; errors: number; min: string | null; max: string | null }
  const reports = new Map<string, SeriesReport>();

  async function collect(seriesId: string, unitId: string): Promise<void> {
    const rep: SeriesReport = { months: 0, weekdays: 0, tradingDays: 0, written: 0, errors: 0, min: null, max: null };
    reports.set(seriesId, rep);
    for (const month of months) {
      rep.months += 1;
      rep.weekdays += krxWeekdays(month).length;
      let rows;
      try {
        rows = await listKrxDailyRows(seriesId, month);
      } catch (err) {
        rep.errors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        krxRunStats().errors.push(msg);
        console.error(`  ${seriesId}@${month}: ${msg}`);
        if (msg.includes("budget exhausted")) return;
        continue;
      }
      rep.tradingDays += rows.length;
      for (const row of rows) {
        try {
          const periodId = await upsertPeriod(row.date);
          await ensureFresh({
            seriesId, periodId, unitId, sourceId,
            fetcher: async () => ({ value: row.value, contentHash: await sha256Hex(row.raw), raw: row.raw }),
          });
          rep.written += 1;
          if (!rep.min || row.date < rep.min) rep.min = row.date;
          if (!rep.max || row.date > rep.max) rep.max = row.date;
          collected += 1;
        } catch (err) {
          rep.errors += 1;
          krxRunStats().errors.push(err instanceof Error ? err.message : String(err));
          console.error(`  ${seriesId}@${row.date}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    console.log(`  ${seriesId}: ${rep.months} month(s), ${rep.weekdays} weekday(s) attempted, ${rep.tradingDays} trading day(s) matched, ${rep.written} row(s) written, ${rep.errors} error(s); KRX calls so far ${krxRunStats().calls}`);
  }

  // 1) Index closes (seed descriptors — registered implicitly by listKrxDailyRows).
  for (const seed of KRX_SEED_SERIES) {
    console.log(`collecting ${seed.seriesId} (${seed.title})…`);
    await collect(seed.seriesId, indexUnitId);
  }

  // 2) Per-company closes.
  const cache = loadCache();
  let cacheDirty = false;
  for (const company of companies.values()) {
    const pinned = tickers.find(([name]) => company.nameKo.includes(name));
    let shortCode = pinned?.[1];
    let market: "kospi" | "kosdaq" | undefined;
    if (pinned && cache.codes[company.id]?.shortCode === shortCode) {
      market = cache.codes[company.id].market.toLowerCase() === "kosdaq" ? "kosdaq" : "kospi";
    }
    if (!shortCode && cache.codes[company.id]) {
      const cached = cache.codes[company.id];
      shortCode = cached.shortCode;
      market = cached.market.toLowerCase() === "kosdaq" ? "kosdaq" : "kospi";
      console.log(`${company.nameKo}: 단축코드 ${shortCode} (cache)`);
    }
    if (!shortCode) {
      // Try KOSPI master first, then KOSDAQ (robotics small-caps often KOSDAQ).
      const reasons: string[] = [];
      for (const m of ["kospi", "kosdaq"] as const) {
        const res = await resolveKrxStockMaster(company.nameKo, m);
        if (res.ok) {
          shortCode = res.row.shortCode;
          market = res.row.market === "KOSDAQ" ? "kosdaq" : "kospi";
          cache.codes[company.id] = { shortCode, market: res.row.market, nameKo: res.row.nameKo, resolvedAt: new Date().toISOString() };
          cacheDirty = true;
          console.log(`${company.nameKo}: 단축코드 ${shortCode} resolved via ${res.row.market} stock master (basDd=${res.basDd})`);
          break;
        }
        reasons.push(res.reason);
        if (res.candidates) break; // ambiguous — do not fall through to the other market
      }
      if (!shortCode) console.error(`${company.nameKo}: stock master lookup failed — ${reasons.join("; ")}`);
    }
    if (!shortCode) {
      console.error(`${company.nameKo}: 단축코드 not resolved — pass --ticker ${company.nameKo}=<6-digit code> to pin it.`);
      continue;
    }
    if (market) {
      const wrote = await upsertKrxListing(db, sourceId, {
        company_id: company.id, short_code: shortCode, market: market === "kosdaq" ? "KOSDAQ" : "KOSPI",
        name_ko: cache.codes[company.id]?.nameKo ?? company.nameKo,
        resolved_at: cache.codes[company.id]?.resolvedAt ?? new Date().toISOString(),
      });
      if (wrote) console.log(`${company.nameKo}: listing market ${market.toUpperCase()} recorded (raw_payload)`);
    }
    const series = krxStockSeries(company.id, shortCode, company.nameKo, market ?? "kospi");
    registerKrxSeries(series);
    // Persist the registration (owner decision 2026-11-02, option 1): the
    // company becomes a first-class nightly series — collect.krx picks it up
    // from stock_series in every process from now on. Upsert by company_id;
    // re-registration updates and re-enables, identical rows are a no-op.
    const persisted = upsertStockSeries(db, {
      company_id: company.id,
      ticker: shortCode,
      market: market ?? "kospi",
      display_name: company.nameKo,
      registered_by: "beta-series",
    });
    if (persisted) console.log(`${company.nameKo}: registered in stock_series (nightly collection enabled)`);
    console.log(`collecting ${series.seriesId} (${series.title})…`);
    await collect(series.seriesId, krwUnitId);
  }
  if (cacheDirty) await saveCache(cache);

  const stats = krxRunStats();
  console.log(`\nbeta-series done: ${collected} observation(s) written; KRX calls ${stats.calls} (budget ${stats.budget}), cache hits ${stats.cacheHits}, empty (non-trading) day payloads ${stats.emptyDays}.`);
  for (const [seriesId, rep] of reports) {
    console.log(`  ${seriesId}: ${rep.written} obs, ${rep.min ?? "-"} ~ ${rep.max ?? "-"} (${rep.weekdays} weekdays, ${rep.tradingDays} trading days)`);
  }
  if (collected === 0) {
    console.error(`\nbeta-series: 0 observations collected. Most likely cause: ${diagnoseZero(stats)}`);
    process.exit(1);
  }
}

/**
 * One-time, idempotent: persist the listing market of already-collected
 * companies from the local stock-code cache. No KRX calls.
 */
async function backfillListingMarkets(db: ReturnType<typeof getDb>, companies: Array<{ id: string; nameKo: string }>): Promise<void> {
  const src = db.query("SELECT id FROM md_source WHERE code = 'krx'").get() as { id: string } | undefined;
  if (!src) {
    console.error("beta-series --backfill-market: md_source 'krx' is not registered — run a normal collection first.");
    process.exit(1);
  }
  const cache = loadCache();
  let written = 0;
  for (const company of companies) {
    const cached = cache.codes[company.id];
    const market = cached ? normalizeKrxMarket(cached.market) : null;
    if (!cached || !market) {
      console.log(`${company.nameKo}: no cached short code/market — skipped (run a normal collection).`);
      continue;
    }
    const wrote = await upsertKrxListing(db, src.id, {
      company_id: company.id, short_code: cached.shortCode, market, name_ko: cached.nameKo, resolved_at: cached.resolvedAt,
    });
    if (wrote) written += 1;
    console.log(`${company.nameKo}: ${cached.shortCode} ${market} — ${wrote ? "recorded" : "already recorded"}`);
  }
  console.log(`beta-series --backfill-market done: ${written} record(s) written; 0 KRX calls.`);
}

/** Explain a 0-row run from the observed KRX responses. */
function diagnoseZero(stats: Readonly<{ calls: number; emptyDays: number; errors: string[] }>): string {
  const errs = stats.errors.join(" | ");
  if (/error 401|HTTP 401/.test(errs)) return "KRX 401 — the key is valid but the service is not approved/expired (re-apply at openapi.krx.co.kr 마이페이지 → API 사용 신청).";
  if (/KRX_API_KEY is not set/.test(errs)) return "KRX_API_KEY missing from .env.";
  if (/budget exhausted/.test(errs)) return "the per-run call budget was exhausted — raise --budget.";
  if (/HTTP 5\d\d|non-JSON|fetch failed|Timeout/i.test(errs)) return `KRX service/network errors: ${errs.slice(0, 300)}`;
  if (/HTTP 403/.test(errs)) return "KRX HTTP 403 — access refused (likely rate limiting/daily quota or IP block); wait and rerun later, reruns are cache hits.";
  if (/CHECK constraint|NOT NULL constraint/.test(errs)) return `DB write rejected: ${errs.slice(0, 200)}`;
  if (stats.calls > 0 && stats.emptyDays === stats.calls) return "every KRX payload was empty (OutBlock_1: []) — wrong request params (must be basDd) or a range of only non-trading days.";
  if (stats.calls === 0) return "no KRX calls were made — no series/companies in scope or every month is in the future.";
  return `payloads returned rows but none matched the series (index name / 단축코드) — check --ticker and KRX field names. ${errs.slice(0, 200)}`;
}

// Exported for tests (import.meta.main guard: running as a script still
// executes the flow; importing it does not).
export { main as betaSeriesMain };

if (import.meta.main) await main();
