// @version 1.5.0
// 1.5.0: per-deal KRX stock series are table-backed (stock_series, migration 0187, owner decision 2026-11-02
// option 1) — loadStockSeriesDescriptors(db) builds descriptors from enabled rows and BOTH enumeration points
// merge them: krx listSeries (seeds < table rows < in-process registry) and listKrxDailyRows resolution (the
// SourceAdapter listSeries/listDailyRows ctx now carries the caller's db handle, passed by fetchSource). The
// nightly collect.krx job therefore collects stock_series rows without any beta-series process having run in
// the collector's own process; the in-process registry (registerKrxSeries) still wins on conflict.
// 1.4.0: md_statute natural-key idempotency is DB-enforced (0186 idx_md_statute_code, data-architect review
// 2026-11-01) — the md_statute catalog insert uses ON CONFLICT DO NOTHING and upsertCatalog counts a conflicted
// row as existing, never as a phantom insert (intra-batch duplicates / losing races).
/**
 * source-adapters.ts — the pluggable data-source adapter framework
 * (design: docs/designs/2026-09-09-source-adapter-framework-design.md).
 *
 * Each adapter maps 1:1 to a k-* skill (k-dart / k-kosis / k-opendata /
 * k-law): the skill is the adapter's operating manual (sources, grades,
 * rate limits), the adapter is the executable. All observation-series
 * ingestion funnels through ensure_fresh()'s Fetcher contract — revision
 * preservation and the change log are the shared engine's job, never an
 * adapter's. Catalog sources produce natural-key upserts instead.
 *
 * Honesty rules (fail-closed):
 *  - A missing credential makes the adapter report disabled; the CLI exits
 *    nonzero rather than silently returning empty results.
 *  - An unknown KOSIS unit is quarantined (kosis-units.ts), never guessed.
 *  - New seed statIds carry "_verified": false until confirmed against the
 *    live KOSIS API — future seeds ship unverified-by-design, not as authority.
 */

import { ulid } from "../../db/lib/ulid.ts";
import { listEnabledStockSeries } from "../../db/repositories/stock-series.repository.ts";
import { parseCorpXml } from "../../app/web-next/lib/dart-client.ts";
import type { Fetcher } from "../../db/repositories/observation.repository.ts";
import { loadPipelineKeys } from "../lib/env-keys.ts";
import { resolveKosisUnit } from "./kosis-units.ts";

// ── Shared types ────────────────────────────────────────────────────────────

export interface SeriesDescriptor {
  /** KOSIS stat_tbl_id (or adapter-equivalent natural series key) */
  seriesId: string;
  adapter: "dart" | "ecos" | "krx" | "kosis" | "opendata" | "law";
  title: string;
  unitCode: string;
  periodType: "year" | "quarter" | "month" | "day";
  /** KOSIS orgId + tblId pair for the stats API call */
  orgId?: string;
  tblId?: string;
  objL1?: string;
  objL2?: string;
  objL3?: string;
  objL4?: string;
  objL5?: string;
  objL6?: string;
  objL7?: string;
  objL8?: string;
  itmId?: string;
  /** ECOS (k-ecos): BOK statistic table + item code for StatisticSearch */
  statCode?: string;
  itemCode?: string;
  /** KRX (k-krx): stock short code for daily trading lookup */
  ticker?: string;
  /** KRX (k-krx): listing market of a stock series (service family selector) */
  market?: "kospi" | "kosdaq" | "konex";
  /** Seed entries ship unverified; flip after a live-API confirmation */
  _verified?: boolean;
}

export type CatalogTable = "md_company" | "md_statute" | "md_industry" | "md_source";

export interface CatalogUpsert {
  table: CatalogTable;
  /** natural-key column → value (e.g. { dart_corp_code: "00126380" }) */
  naturalKey: Record<string, string>;
  /** non-key columns to set on insert (updates keep the row's other fields) */
  values: Record<string, string | null>;
}

export interface AdapterFetchSummary {
  adapter: string;
  ok: number;
  revised: number;
  unchanged: number;
  quarantined: Array<{ key: string; reason: string }>;
}

export interface SourceAdapter {
  code: "dart" | "ecos" | "krx" | "kosis" | "opendata" | "law";
  kSkill: string;
  credentialEnv: string;
  kind: "observations" | "catalog";
  /** Disabled when the credential is absent — the CLI reports and exits 2. */
  isEnabled(): boolean;
  /**
   * Series catalog for observation adapters. The caller's db handle rides in
   * ctx (optional — fixtures and the pre-0187 callers omit it): the krx
   * adapter merges its table-backed stock series (stock_series, migration
   * 0187) into the enumerated set when a handle is present.
   */
  listSeries(ctx?: { db?: unknown }): Promise<SeriesDescriptor[]>;
  /**
   * Day-grain collection hook (KRX). Iterates one month's trading days from a
   * single API call per (series × month); the caller upserts a day period per
   * row and runs ensure_fresh per day. Absent = month-grain adapter. ctx.db is
   * the caller's handle, used to resolve table-backed stock series
   * (stock_series) the in-process registry does not know.
   */
  listDailyRows?(ctx: { seriesId: string; sourceId: string; db?: unknown }, month: string): Promise<KrxDailyRow[]>;
  /**
   * Build the raw observation fetcher for one series (argument is a period key
   * such as YYYY-MM). Month-grain adapters (KOSIS/ECOS) honor it; day-grain
   * series (KRX) collect through listDailyRows instead.
   */
  fetcher(ctx: { seriesId: string; sourceId: string }): Fetcher;
  /** Catalog upserts for catalog-kind adapters (dart/law/opendata). */
  listCatalog?(opts: { all: boolean }): Promise<CatalogUpsert[]>;
}

// ── HTTP helper (SSRF-guarded) ──────────────────────────────────────────────

async function getJson(url: string): Promise<unknown> {
  const { safeFetch } = await import("../lib/ssrf.ts");
  const res = await safeFetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const text = await res.text();
  // Some Korean open-data endpoints answer JSON requests with XML/HTML on
  // auth failure — detect and surface the marker instead of a parse error.
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    throw new Error(`non-JSON response (auth/service-key problem?) from ${new URL(url).host}: ${trimmed.slice(0, 120)}`);
  }
  return JSON.parse(text);
}

function requireKey(env: string): string {
  loadPipelineKeys();
  const v = process.env[env];
  if (!v) throw new Error(`${env} is not set — the ${env.replace("_API_KEY", "")} adapter is disabled until configured.`);
  return v;
}

// ── dart adapter (k-dart) ───────────────────────────────────────────────────

const dartAdapter: SourceAdapter = {
  code: "dart",
  kSkill: "k-dart",
  credentialEnv: "DART_API_KEY",
  kind: "catalog",
  isEnabled: () => {
    loadPipelineKeys();
    return Boolean(process.env.DART_API_KEY);
  },
  async listSeries() {
    return []; // observation-series extension lands with the valuation wave
  },
  fetcher() {
    throw new Error("dart adapter is catalog-kind — observation fetching is not provided (use fin:pipeline / dart-collect for financials).");
  },
  async listCatalog() {
    const apiKey = requireKey("DART_API_KEY");
    const upserts: CatalogUpsert[] = [];
    // DART corpCode.xml is the one DART endpoint that is XML-only; fetch the
    // ZIP, decompress, and parse the COMPANY rows. (Full XML parsing lives in
    // the CLI case — here we produce upserts from the standard list.)
    const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(apiKey)}`;
    const { safeFetch } = await import("../lib/ssrf.ts");
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(60_000),
      headers: {
        accept: "application/zip, application/octet-stream, application/x-msdownload, */*",
        "user-agent": "co-newbiz-source-adapter/1.0",
      },
    });
    if (!res.ok) throw new Error(`DART corpCode: HTTP ${res.status}`);
    const rows = parseCorpXml(Buffer.from(await res.arrayBuffer()));
    if (rows.length === 0) throw new Error("DART corpCode: ZIP/XML parse yielded no company rows.");
    for (const row of rows) {
      const corpCode = row.corp_code;
      const nameKo = row.corp_name;
      upserts.push({
        table: "md_company",
        naturalKey: { dart_corp_code: corpCode },
        values: { name_ko: nameKo, name_en: null },
      });
    }
    return upserts;
  },
};

// ── kosis adapter (k-kosis) ─────────────────────────────────────────────────

/** Seed stat list — ships UNVERIFIED by design (design doc §2.2/§8-q1).
 *  Confirm each orgId/tblId against the live KOSIS OpenAPI before relying on
 *  a series; fetch --list shows the _verified flag. Extend freely. */
const KOSIS_SEED_SERIES: SeriesDescriptor[] = [
  {
    seriesId: "kosis:2011011:DT_1JH20201:T1:0",
    adapter: "kosis",
    orgId: "101",
    tblId: "DT_1JH20201",
    itmId: "T1",
    objL1: "0",
    title: "전산업생산지수(원지수, 농림어업 제외, 2020=100) — KOSIS verified 2026-09-09",
    unitCode: "index",
    periodType: "month",
    _verified: true,
  },
  {
    seriesId: "kosis:1970002:DT_1F02011:T11:10",
    adapter: "kosis",
    orgId: "101",
    tblId: "DT_1F02011",
    itmId: "T11",
    objL1: "10",
    title: "기본분류 일부항목 제외 광공업 생산자제품 출하지수(원지수, 2020=100) — KOSIS verified 2026-09-09",
    unitCode: "index",
    periodType: "month",
    _verified: true,
  },
];

const kosisAdapter: SourceAdapter = {
  code: "kosis",
  kSkill: "k-kosis",
  credentialEnv: "KOSIS_API_KEY",
  kind: "observations",
  isEnabled: () => {
    loadPipelineKeys();
    return Boolean(process.env.KOSIS_API_KEY);
  },
  async listSeries() {
    return KOSIS_SEED_SERIES;
  },
  fetcher(ctx) {
    // Series validation precedes the credential check — an unknown series is
    // a programmer error and must surface regardless of key availability.
    const series = KOSIS_SEED_SERIES.find((s) => s.seriesId === ctx.seriesId);
    if (!series?.orgId || !series?.tblId) {
      throw new Error(`kosis: unknown series '${ctx.seriesId}' — fetch --list shows the seeded catalog.`);
    }
    if (!series.objL1 || !series.itmId) {
      throw new Error(
        `kosis: series '${ctx.seriesId}' is not live-fetchable yet — verify objL*/itmId against KOSIS and update KOSIS_SEED_SERIES before collection.`,
      );
    }
    const apiKey = requireKey("KOSIS_API_KEY");
    return async (periodKey: string) => {
      // KOSIS stats API: one call per series returns the full period range;
      // periodKey (YYYY-MM or YYYY) narrows the parsed row.
      const compactPeriod = periodKey.replace("-", "");
      const params = new URLSearchParams({
        method: "getList",
        apiKey,
        orgId: series.orgId!,
        tblId: series.tblId!,
        itmId: series.itmId!,
        prdSe: "M",
        startPrdDe: compactPeriod,
        endPrdDe: compactPeriod,
        format: "json",
        jsonVD: "Y",
      });
      for (const [key, value] of Object.entries({
        objL1: series.objL1,
        objL2: series.objL2,
        objL3: series.objL3,
        objL4: series.objL4,
        objL5: series.objL5,
        objL6: series.objL6,
        objL7: series.objL7,
        objL8: series.objL8,
      })) {
        if (value) params.set(key, value);
      }
      const url = `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params.toString()}`;
      const payload = await getJson(url);
      if (!Array.isArray(payload)) {
        const err = payload as { err?: string; errMsg?: string; errMessage?: string };
        throw new Error(`kosis API error${err.err ? ` ${err.err}` : ""}: ${err.errMsg ?? err.errMessage ?? "non-array response"}`);
      }
      const rows = payload as Array<{ TBL_NM?: string; UNIT_NM?: string; UNIT?: string; DT?: string; PRD_DE?: string; PERIOD?: string }>;
      const row = rows.find((d) => d.PRD_DE === compactPeriod || d.PERIOD === periodKey) ?? rows[0];
      if (!row?.DT) throw new Error(`kosis: no data point for ${ctx.seriesId}@${periodKey}`);
      const value = Number(row.DT);
      if (!Number.isFinite(value)) throw new Error(`kosis: non-numeric value '${row.DT}' for ${ctx.seriesId}@${periodKey}`);
      const unit = resolveKosisUnit(row.UNIT_NM ?? row.UNIT);
      if (!unit) throw new Error(`kosis: unknown unit '${row.UNIT_NM ?? row.UNIT}' — quarantined per kosis-units.ts (add the mapping to onboard).`);
      const raw = JSON.stringify(row);
      return { value, contentHash: await hash(raw), raw };
    };
  },
};

// ── ecos adapter (k-ecos) ───────────────────────────────────────────────────

/** Seed stat list — 721Y001 (시장금리, 월별). Item codes live-verified against
 *  StatisticItemList 2026-09-11; a wrong item code surfaces the available
 *  codes in the fetch error (self-documenting discovery). Monthly grain fits
 *  the pipeline's resolveMonthlyPeriods — month-end/market-close values. */
const ECOS_SEED_SERIES: SeriesDescriptor[] = [
  {
    seriesId: "ecos:721Y001:5020000",
    adapter: "ecos",
    statCode: "721Y001",
    itemCode: "5020000",
    title: "국고채(3년) 월별금리 — ECOS 721Y001 live-verified 2026-09-11 (item 5020000)",
    unitCode: "percent",
    periodType: "month",
    _verified: true,
  },
  {
    seriesId: "ecos:721Y001:7020000",
    adapter: "ecos",
    statCode: "721Y001",
    itemCode: "7020000",
    title: "회사채(3년, AA-) 월별금리 — ECOS 721Y001 live-verified 2026-09-11 (item 7020000)",
    unitCode: "percent",
    periodType: "month",
    _verified: true,
  },
];

const ecosAdapter: SourceAdapter = {
  code: "ecos",
  kSkill: "k-ecos",
  credentialEnv: "ECOS_API_KEY",
  kind: "observations",
  isEnabled: () => {
    loadPipelineKeys();
    return Boolean(process.env.ECOS_API_KEY);
  },
  async listSeries() {
    return ECOS_SEED_SERIES;
  },
  fetcher(ctx) {
    const series = ECOS_SEED_SERIES.find((s) => s.seriesId === ctx.seriesId);
    if (!series?.statCode || !series?.itemCode) {
      throw new Error(`ecos: unknown series '${ctx.seriesId}' — fetch --list shows the seeded catalog.`);
    }
    const apiKey = requireKey("ECOS_API_KEY");
    return async (periodKey: string) => {
      // BOK ECOS Open API — URL template per the k-ecos skill (service name
      // FIRST, then the key; cycle M; dates YYYYMM). One call per series-month.
      const compact = periodKey.replace("-", "");
      const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(apiKey)}/json/kr/1/10/${series.statCode}/M/${compact}/${compact}/${series.itemCode}`;
      // Success envelope: {"StatisticSearch":{"list_total_count":N,"row":[…]}}
      // Error envelope: a bare {"RESULT":{"CODE","MESSAGE"}} — per the k-ecos
      // skill's response policy.
      const payload = await getJson(url) as {
        StatisticSearch?: { row?: Array<{ ITEM_CODE1?: string; DATA_VALUE?: string; TIME?: string }> };
        RESULT?: { CODE?: string; MESSAGE?: string };
      };
      if (payload.RESULT && !payload.StatisticSearch) {
        throw new Error(`ecos API error ${payload.RESULT.CODE}: ${payload.RESULT.MESSAGE}`);
      }
      const rows = (payload.StatisticSearch?.row ?? []).filter((r) => r.ITEM_CODE1 === series.itemCode);
      const row = rows.find((r) => r.TIME === compact) ?? rows[rows.length - 1];
      if (!row?.DATA_VALUE) throw new Error(`ecos: no data point for ${ctx.seriesId}@${periodKey}`);
      const value = Number(row.DATA_VALUE);
      if (!Number.isFinite(value)) throw new Error(`ecos: non-numeric value '${row.DATA_VALUE}' for ${ctx.seriesId}@${periodKey}`);
      const raw = JSON.stringify(row);
      return { value, contentHash: await hash(raw), raw };
    };
  },
};

// ── krx adapter (k-krx) ─────────────────────────────────────────────────────

const KRX_BASE = "https://data-dbg.krx.co.kr/svc/apis";

/**
 * KRX daily-close series for beta regression (k-krx skill, ADR-0115).
 *
 * seriesId conventions:
 *   krx:index:<CODE>:close      — market index daily close (CODE: KOSPI|KOSDAQ),
 *                                 served by the idx/ daily-quote services.
 *   krx:stock:<companyId>:close — a listed company's daily close. The key is
 *                                 md_company.id (NOT the KRX short code):
 *                                 md_company has no ISIN/short-code column and
 *                                 a schema change would need an ADR, so the
 *                                 resolved KRX 단축코드 lives in the ticker
 *                                 registry below and in the code cache
 *                                 (db/data/krx-stock-code-cache.json, written
 *                                 by beta-series.ts). This keeps the WACC
 *                                 beta-series API resolvable from a project
 *                                 row alone.
 *
 * Request shape (verified live 2026-10-12 against data-dbg.krx.co.kr): every
 * daily service takes ONE reference date `basDd=YYYYMMDD` and returns all rows
 * of that day (every index of the family, or every listed stock of the
 * market). A date range (bgnDd/endDd) is NOT supported — KRX answers HTTP 200
 * with an empty OutBlock_1. Weekends/holidays also return an empty
 * OutBlock_1. Collection therefore iterates weekdays and shares one call per
 * (service, day) across every series of that service (see krxDayRows).
 */
export const KRX_SEED_SERIES: SeriesDescriptor[] = [
  {
    seriesId: "krx:index:KOSPI:close",
    adapter: "krx",
    title: "코스피 지수 일별종가 — idx/kospi_dd_trd (basDd per day)",
    unitCode: "index",
    periodType: "day",
    _verified: true,
  },
  {
    seriesId: "krx:index:KOSDAQ:close",
    adapter: "krx",
    title: "코스닥 지수 일별종가 — idx/kosdaq_dd_trd (basDd per day)",
    unitCode: "index",
    periodType: "day",
    _verified: true,
  },
];

/**
 * Runtime registry for per-deal company series (krx:stock:<companyId>:close).
 * The static seeds cannot carry them (company ids are project data), so
 * beta-series.ts registers each company's descriptor — including the resolved
 * KRX 단축코드 as ticker — before collecting. Since source-adapters 1.5.0 this
 * registry is the in-process LAYER on top of the persisted stock_series table
 * (migration 0187): enumeration and resolution merge seeds < table rows <
 * registry, the registry winning on conflict (a beta run's freshly resolved
 * descriptor is the most current view of the company). Keep using it for
 * in-process needs (tests, the beta flow's own run); persistence goes through
 * db/repositories/stock-series.repository.ts.
 */
const KRX_DYNAMIC_SERIES = new Map<string, SeriesDescriptor>();

/** Register a per-deal KRX company series descriptor for this process. */
export function registerKrxSeries(series: SeriesDescriptor): void {
  KRX_DYNAMIC_SERIES.set(series.seriesId, series);
}

/** Build the daily-close series descriptor for a listed company. */
export function krxStockSeries(companyId: string, ticker: string, companyName: string, market: "kospi" | "kosdaq"): SeriesDescriptor {
  return {
    seriesId: `krx:stock:${companyId}:close`,
    adapter: "krx",
    ticker,
    market,
    title: `${companyName} 일별종가 — KRX 단축코드 ${ticker} (basDd per day)`,
    unitCode: "krw",
    periodType: "day",
    _verified: true,
  };
}

/**
 * Table-backed per-deal stock series (stock_series, migration 0187; owner
 * decision 2026-11-02, option 1) as series descriptors. Disabled rows
 * (disabled_at set) are skipped — collection stops for them but their
 * observation history stays. This is the merge source for BOTH enumeration
 * points: the krx adapter's listSeries (what the nightly collect.krx job and
 * the CLI fetch loop collect) and the single-series resolution in
 * listKrxDailyRows/krxResolveSeries — so a company registered by a beta-series
 * run in ANY process (persisted by beta-series.ts since 1.3.0, backfilled by
 * migration 0187 for the two already-flowing series) is collected without that
 * process having registered anything in-memory.
 */
export function loadStockSeriesDescriptors(
  // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite Database handle (upsertCatalog's db typing)
  db: any,
): SeriesDescriptor[] {
  return listEnabledStockSeries(db).map((row) =>
    krxStockSeries(row.company_id, row.ticker, row.display_name, row.market),
  );
}

/** One trading day's close from a KRX daily service payload row. */
export interface KrxDailyRow {
  /** ISO date (YYYY-MM-DD), from the row's BAS_DD. */
  date: string;
  value: number;
  raw: string;
}

/** Output FIELD names per service family (verified live 2026-10-12). */
const KRX_INDEX_FIELDS = { date: "BAS_DD", close: "CLSPRC_IDX", name: "IDX_NM" } as const;

/**
 * EXACT IDX_NM of the headline index row. The idx services return every index
 * of the family per day, including '코스피 (외국주포함)' style rows whose close
 * is empty — those must never be picked.
 */
const KRX_INDEX_NAME: Record<string, string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
};

/** sto/*_bydd_trd rows: ISU_CD carries the 6-digit 단축코드, close is TDD_CLSPRC. */
const KRX_STOCK_FIELDS = { date: "BAS_DD", close: "TDD_CLSPRC", code: "ISU_CD", name: "ISU_NM" } as const;

/** Stock-master lookup result (단축코드 resolution). */
export interface KrxStockMasterRow {
  /** KRX 단축코드 (6-digit code, e.g. 058050 for 샘) — example only. */
  shortCode: string;
  isin: string | null;
  nameKo: string;
  /** KOSPI | KOSDAQ | KONEX — decides the daily-trading service family. */
  market: "KOSPI" | "KOSDAQ" | "KONEX";
}

/** HTTP-level KRX failure — status kept so callers can decide retry/diagnosis. */
export class KrxHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function krxGetJson(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { AUTH_KEY: apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new KrxHttpError(`KRX API HTTP ${res.status} from ${new URL(url).host}`, res.status);
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) throw new Error(`KRX API non-JSON response: ${trimmed.slice(0, 120)}`);
  return JSON.parse(text);
}

/** KRX error envelope (k-krx skill §Error Handling) — respCode without data. */
function krxRequireRows(payload: unknown, service: string): Array<Record<string, string>> {
  const env = payload as { respCode?: string; respMsg?: string; OutBlock_1?: Array<Record<string, string>> };
  if (env.respCode && !env.OutBlock_1) {
    throw new Error(
      `KRX ${service} error ${env.respCode}: ${env.respMsg}` +
        (env.respCode === "401" ? " — key valid but service not approved/expired (k-krx skill: re-apply via 마이페이지 → API 사용 신청)" : ""),
    );
  }
  return env.OutBlock_1 ?? [];
}

function krxServiceFor(series: SeriesDescriptor): { path: string; indexCode: string | null } {
  if (series.seriesId.startsWith("krx:index:")) {
    const code = series.seriesId.split(":")[2];
    if (code === "KOSDAQ") return { path: "idx/kosdaq_dd_trd", indexCode: "KOSDAQ" };
    return { path: "idx/kospi_dd_trd", indexCode: "KOSPI" };
  }
  // Stock series: the listing market selects the service family — stk for
  // KOSPI listings, ksq for KOSDAQ (KONEX/knx is out of scope for beta).
  const stockMarket = series.market ?? "kospi";
  return { path: stockMarket === "kospi" ? "sto/stk_bydd_trd" : "sto/ksq_bydd_trd", indexCode: null };
}

// ── per-run call accounting + per-day payload cache ────────────────────────

/** Per-process KRX call statistics (read by beta-series.ts for its report). */
export interface KrxRunStats {
  /** HTTP calls actually issued (retries included). */
  calls: number;
  /** Weekdays whose payload was empty (holiday / non-trading day / future). */
  emptyDays: number;
  /** Distinct (service, day) payloads served from the in-process cache. */
  cacheHits: number;
  /** Failure messages by kind, for the 0-rows diagnosis. */
  errors: string[];
  /** Call budget for this run; exceeding it throws. */
  budget: number;
}

const KRX_DEFAULT_BUDGET = 2000;
// Concurrency 4 with no pacing tripped KRX burst throttling (HTTP 403 after
// ~150 calls, live 2026-10-12); 2 workers + a minimum spacing stays under it.
const KRX_CONCURRENCY = 2;
const krxDayCache = new Map<string, Promise<Array<Record<string, string>>>>();
let krxStats: KrxRunStats = { calls: 0, emptyDays: 0, cacheHits: 0, errors: [], budget: KRX_DEFAULT_BUDGET };
let krxRetryDelayMs = 800;
let krxMinIntervalMs = 250;
let krxNextSlot = 0;

/** Reset the day cache and statistics (new run / tests). */
export function resetKrxRunState(opts: { budget?: number; retryDelayMs?: number; minIntervalMs?: number } = {}): void {
  krxDayCache.clear();
  krxStats = { calls: 0, emptyDays: 0, cacheHits: 0, errors: [], budget: opts.budget ?? KRX_DEFAULT_BUDGET };
  krxRetryDelayMs = opts.retryDelayMs ?? 800;
  krxMinIntervalMs = opts.minIntervalMs ?? 250;
  krxNextSlot = 0;
}

export function krxRunStats(): Readonly<KrxRunStats> {
  return krxStats;
}

function krxApiKey(): string {
  loadPipelineKeys();
  const apiKey = process.env.KRX_API_KEY;
  if (!apiKey) throw new Error("KRX_API_KEY is not set — the krx adapter is disabled until configured.");
  return apiKey;
}

/** Global pacing: calls start at least krxMinIntervalMs apart across workers. */
async function krxPace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, krxNextSlot);
  krxNextSlot = slot + krxMinIntervalMs;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

/**
 * One HTTP call with a single retry on network errors / 5xx, and on KRX
 * throttling (403/429) with a 5x longer backoff.
 */
async function krxCall(path: string, basDd: string, apiKey: string): Promise<Array<Record<string, string>>> {
  const url = `${KRX_BASE}/${path}.json?${new URLSearchParams({ basDd }).toString()}`;
  for (let attempt = 0; ; attempt++) {
    if (krxStats.calls >= krxStats.budget) {
      throw new Error(`KRX call budget exhausted (${krxStats.budget} calls) — raise --budget or narrow --from/--to.`);
    }
    await krxPace();
    krxStats.calls += 1;
    try {
      return krxRequireRows(await krxGetJson(url, apiKey), path);
    } catch (err) {
      const throttled = err instanceof KrxHttpError && (err.status === 403 || err.status === 429);
      const retryable = err instanceof KrxHttpError ? err.status >= 500 || throttled : err instanceof TypeError || (err as Error)?.name === "TimeoutError";
      if (!retryable || attempt >= 1) throw err;
      await new Promise((r) => setTimeout(r, krxRetryDelayMs * (attempt + 1) * (throttled ? 5 : 1)));
    }
  }
}

/**
 * All rows of one service for one day, cached per (service, day) for the
 * process — the KOSPI index series and every KOSPI stock series share the
 * same call per day. Errors are not cached.
 */
async function krxDayRows(path: string, basDd: string, apiKey: string): Promise<Array<Record<string, string>>> {
  const key = `${path}|${basDd}`;
  const hit = krxDayCache.get(key);
  if (hit) {
    krxStats.cacheHits += 1;
    return hit;
  }
  const p = krxCall(path, basDd, apiKey).then((rows) => {
    if (rows.length === 0) krxStats.emptyDays += 1;
    return rows;
  });
  krxDayCache.set(key, p);
  p.catch(() => krxDayCache.delete(key));
  return p;
}

/** Weekdays (YYYYMMDD) of a month, excluding dates after `today`. */
export function krxWeekdays(month: string, today: Date = new Date()): string[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) throw new Error(`krx: month must be YYYY-MM (got '${month}')`);
  const todayKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const days: string[] = [];
  const last = new Date(y, m, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow === 0 || dow === 6) continue;
    const key = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
    if (key > todayKey) continue;
    days.push(key);
  }
  return days;
}

async function krxPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function krxNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const v = Number(raw.replaceAll(",", ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function krxIsoDate(raw: string): string | null {
  const d = raw.replaceAll("/", "").replaceAll("-", "").replaceAll(".", "");
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
}

/** Pick the series' row out of one day's payload, or null. */
export function krxPickRow(
  rows: Array<Record<string, string>>,
  pick: { indexCode: string } | { ticker: string },
): KrxDailyRow | null {
  let row: Record<string, string> | undefined;
  let close: number | null = null;
  if ("indexCode" in pick) {
    const name = KRX_INDEX_NAME[pick.indexCode];
    row = rows.find((r) => r[KRX_INDEX_FIELDS.name] === name && krxNumber(r[KRX_INDEX_FIELDS.close]) !== null);
    close = row ? krxNumber(row[KRX_INDEX_FIELDS.close]) : null;
  } else {
    row = rows.find((r) => (r[KRX_STOCK_FIELDS.code] ?? r.ISU_SRT_CD) === pick.ticker);
    close = row ? krxNumber(row[KRX_STOCK_FIELDS.close]) : null;
  }
  if (!row || close === null) return null;
  const date = krxIsoDate(row[KRX_INDEX_FIELDS.date] ?? "");
  if (!date) return null;
  return { date, value: close, raw: JSON.stringify(row) };
}

/**
 * Fetch one month's daily rows for a KRX series: one basDd call per weekday
 * (cached per service/day and shared across series), concurrency
 * KRX_CONCURRENCY with global pacing. Empty weekday payloads are non-trading days and are
 * skipped (counted in krxRunStats().emptyDays). This is the collection unit
 * both newbiz.ts fetch (day-grain series) and beta-series.ts consume.
 */
export async function listKrxDailyRows(
  seriesId: string,
  month: string,
  today: Date = new Date(),
  // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite Database handle (optional — in-process-only callers omit it)
  db?: any,
): Promise<KrxDailyRow[]> {
  const apiKey = krxApiKey();
  const series = krxResolveSeries(seriesId, db);
  if (!series) throw new Error(`krx: unknown series '${seriesId}'`);
  const { path, indexCode } = krxServiceFor(series);
  if (indexCode === null && !series.ticker) throw new Error(`krx: stock series '${seriesId}' has no ticker (단축코드)`);
  const pick = indexCode !== null ? { indexCode } : { ticker: series.ticker! };
  const days = krxWeekdays(month, today);
  const picked = await krxPool(days, KRX_CONCURRENCY, async (day) => krxPickRow(await krxDayRows(path, day, apiKey), pick));
  return picked.filter((r): r is KrxDailyRow => r !== null).sort((a, b) => a.date.localeCompare(b.date));
}

export type KrxMasterResult =
  | { ok: true; row: KrxStockMasterRow; basDd: string }
  | { ok: false; reason: string; candidates?: string[] };

/**
 * Resolve a company's 단축코드 from the stock master (sto/stk_isu_base_info or
 * sto/ksq_isu_base_info, basDd = most recent weekday with a non-empty
 * payload, looking back up to 10 weekdays). Name match on ISU_ABBRV / ISU_NM:
 * exact, then startsWith, then includes; more than one candidate at the first
 * matching tier is reported as ambiguous. Failures return the real reason.
 */
export async function resolveKrxStockMaster(
  companyName: string,
  market: "kospi" | "kosdaq",
  today: Date = new Date(),
): Promise<KrxMasterResult> {
  let apiKey: string;
  try {
    apiKey = krxApiKey();
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const service = market === "kospi" ? "sto/stk_isu_base_info" : "sto/ksq_isu_base_info";
  const label = market === "kospi" ? "KOSPI" : "KOSDAQ";
  const candidatesDays: string[] = [];
  for (let back = 0; candidatesDays.length < 10 && back < 20; back++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    candidatesDays.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`);
  }
  let rows: Array<Record<string, string>> = [];
  let basDd = "";
  for (const day of candidatesDays) {
    try {
      rows = await krxDayRows(service, day, apiKey);
    } catch (err) {
      return { ok: false, reason: `${service} basDd=${day}: ${(err as Error).message}` };
    }
    if (rows.length > 0) {
      basDd = day;
      break;
    }
  }
  if (rows.length === 0) {
    return { ok: false, reason: `${service}: empty payload for the last ${candidatesDays.length} weekdays` };
  }
  const target = companyName.trim();
  const names = (r: Record<string, string>) => [r.ISU_ABBRV ?? "", r.ISU_NM ?? ""];
  const tiers: Array<(n: string) => boolean> = [(n) => n === target, (n) => n.startsWith(target), (n) => n.includes(target)];
  let hits: Array<Record<string, string>> = [];
  for (const tier of tiers) {
    hits = rows.filter((r) => names(r).some((n) => n !== "" && tier(n)));
    if (hits.length > 0) break;
  }
  if (hits.length === 0) return { ok: false, reason: `'${target}' not found in ${label} master (${service} basDd=${basDd})` };
  if (hits.length > 1) {
    const candidates = hits.map((r) => `${r.ISU_ABBRV ?? r.ISU_NM}=${r.ISU_SRT_CD}`);
    return { ok: false, reason: `'${target}' is ambiguous in ${label} master: ${candidates.join(", ")} — pin with --ticker`, candidates };
  }
  const hit = hits[0];
  const shortCode = hit.ISU_SRT_CD ?? "";
  if (!/^[0-9A-Z]{6}$/.test(shortCode)) return { ok: false, reason: `${label} master row for '${target}' has no 6-char ISU_SRT_CD` };
  const rawMarket = (hit.MKT_TP_NM ?? label).toUpperCase();
  const resolvedMarket = rawMarket === "KOSDAQ" ? "KOSDAQ" : rawMarket === "KONEX" ? "KONEX" : "KOSPI";
  return { ok: true, basDd, row: { shortCode, isin: hit.ISU_CD ?? null, nameKo: hit.ISU_ABBRV ?? target, market: resolvedMarket } };
}

/**
 * Single-series resolution precedence: the in-process registry wins, then the
 * static seeds, then the persisted stock_series table (db omitted →
 * registry/seeds only, the pre-0187 behavior). Seeds-vs-table precedence is
 * unobservable — the id namespaces are disjoint (krx:index:* seeds never
 * collide with krx:stock:* table rows) — so this is a lookup order, not a
 * merge order to keep in step with listSeries.
 */
function krxResolveSeries(
  seriesId: string,
  // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite Database handle (optional — in-process-only callers omit it)
  db?: any,
): SeriesDescriptor | undefined {
  const dynamic = KRX_DYNAMIC_SERIES.get(seriesId);
  if (dynamic) return dynamic;
  const seed = KRX_SEED_SERIES.find((s) => s.seriesId === seriesId);
  if (seed) return seed;
  if (db) return loadStockSeriesDescriptors(db).find((s) => s.seriesId === seriesId);
  return undefined;
}

const krxAdapter: SourceAdapter = {
  code: "krx",
  kSkill: "k-krx",
  credentialEnv: "KRX_API_KEY",
  kind: "observations",
  isEnabled: () => {
    loadPipelineKeys();
    return Boolean(process.env.KRX_API_KEY);
  },
  async listSeries(ctx?: { db?: unknown }) {
    // Merge order: seeds < table-backed stock_series rows < in-process
    // registry (registry wins — a beta run in THIS process holds the freshest
    // descriptor). A db handle is passed by fetchSource since 1.5.0; without
    // one (old callers, bare fixtures) this is the pre-0187 seed-only catalog.
    const merged = new Map<string, SeriesDescriptor>();
    for (const s of KRX_SEED_SERIES) merged.set(s.seriesId, s);
    if (ctx?.db) {
      for (const s of loadStockSeriesDescriptors(ctx.db)) merged.set(s.seriesId, s);
    }
    for (const s of KRX_DYNAMIC_SERIES.values()) merged.set(s.seriesId, s);
    return [...merged.values()];
  },
  async listDailyRows(ctx, month) {
    return listKrxDailyRows(ctx.seriesId, month, new Date(), ctx.db);
  },
  fetcher(ctx) {
    const series = krxResolveSeries(ctx.seriesId);
    if (!series) {
      throw new Error(`krx: unknown series '${ctx.seriesId}' — fetch --list shows the seeded catalog.`);
    }
    requireKey("KRX_API_KEY");
    return async (_periodKey: string) => {
      // Day-grain series never run the monthly Fetcher contract — newbiz fetch
      // and beta-series.ts collect through the adapter's listDailyRows hook
      // (listKrxDailyRows). A monthly call here means a day-grain series was
      // misconfigured; fail loudly rather than return a wrong grain.
      throw new Error(`krx: series '${ctx.seriesId}' is day-grain — collect via listKrxDailyRows, not the monthly fetch loop.`);
    };
  },
};

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── law adapter (k-law, via 법제처 OC credential) ─────────────────────────

/** Operating whitelist (design decision 2026-09-09): only deal-review-relevant
 *  statutes sync by default; `law --all` removes the filter. */
export const LAW_WHITELIST = [
  "상법",
  "독점규제 및 공정거래에 관한 법률",
  "자본시장과 금융투자업에 관한 법률",
  "전자거래기본법",
];

const lawAdapter: SourceAdapter = {
  code: "law",
  kSkill: "k-law",
  credentialEnv: "LAW_API_OC",
  kind: "catalog",
  isEnabled: () => {
    loadPipelineKeys();
    return Boolean(process.env.LAW_API_OC);
  },
  async listSeries() {
    return [];
  },
  fetcher() {
    throw new Error("law adapter is catalog-kind — no observation series.");
  },
  async listCatalog(opts) {
    const serviceKey = requireKey("LAW_API_OC");
    const names = opts.all
      ? null // full sweep — thousands of statutes, slow by design
      : LAW_WHITELIST;
    const upserts: CatalogUpsert[] = [];
    const queries = names ?? [""];
    for (const query of queries) {
      const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(serviceKey)}&target=law&type=JSON${query ? `&query=${encodeURIComponent(query)}` : ""}`;
      let payload: unknown;
      try {
        payload = await getJson(url);
      } catch (err) {
        throw new Error(`law search failed for '${query || "(all)"}': ${err instanceof Error ? err.message : String(err)}`);
      }
      const lawSearch = (payload as { LawSearch?: Array<Record<string, string>> | { law?: Array<Record<string, string>> } })?.LawSearch;
      const rows = Array.isArray(lawSearch) ? lawSearch : lawSearch?.law ?? [];
      for (const row of rows) {
        const statuteId = row["법령일련번호"] ?? row["법령ID"];
        const nameKo = row["법령명한글"] ?? row["법령명"];
        if (!statuteId || !nameKo) continue;
        upserts.push({
          table: "md_statute",
          naturalKey: { korea_statute_id: statuteId },
          values: { foreign_framework_key: nameKo },
        });
      }
    }
    return upserts;
  },
};

// ── opendata adapter (k-opendata) — extension point ────────────────────────

const opendataAdapter: SourceAdapter = {
  code: "opendata",
  kSkill: "k-opendata",
  credentialEnv: "DATA_GO_KR_API_KEY",
  kind: "catalog",
  isEnabled: () => {
    loadPipelineKeys();
    return Boolean(process.env.DATA_GO_KR_API_KEY);
  },
  async listSeries() {
    return [];
  },
  fetcher() {
    throw new Error("opendata adapter is catalog-kind.");
  },
  async listCatalog() {
    // Extension point: a data.go.kr dataset becomes an adapter entry here
    // when one is onboarded. The serviceKey transport (getJson + safeFetch)
    // is shared with the law adapter, so onboarding is listCatalog-only.
    throw new Error("opendata adapter has no catalogs onboarded yet — the transport is ready (see design doc §2.2); add a dataset to extend.");
  },
};

// ── registry ────────────────────────────────────────────────────────────────

export const SOURCE_ADAPTERS: Record<string, SourceAdapter> = {
  dart: dartAdapter,
  ecos: ecosAdapter,
  krx: krxAdapter,
  kosis: kosisAdapter,
  law: lawAdapter,
  opendata: opendataAdapter,
};

/** Natural-key upsert for catalog rows — idempotent by construction. */
export function upsertCatalog(
  db: { query: (sql: string, ...args: unknown[]) => { get: (...args: unknown[]) => unknown }; run: (sql: string, ...args: unknown[]) => { changes: number } },
  upserts: CatalogUpsert[],
): { inserted: number; existing: number } {
  let inserted = 0;
  let existing = 0;
  const now = new Date().toISOString();
  for (const up of upserts) {
    const found = findCatalogByNaturalKey(db, up) as { id: string } | undefined;
    if (found) {
      existing++;
      continue;
    }
    const changes = insertCatalogByNaturalKey(db, up, ulid(), now);
    // ON CONFLICT DO NOTHING (md_statute natural-key index, 0186): an intra-batch
    // duplicate or a losing concurrent sync counts as existing, never as a
    // phantom insert.
    if (changes > 0) inserted++;
    else existing++;
  }
  return { inserted, existing };
}

function findCatalogByNaturalKey(
  db: { query: (sql: string, ...args: unknown[]) => { get: (...args: unknown[]) => unknown } },
  up: CatalogUpsert,
): unknown {
  switch (up.table) {
    case "md_company":
      return db.query("SELECT id FROM md_company WHERE dart_corp_code = ?").get(up.naturalKey.dart_corp_code);
    case "md_statute":
      return db.query("SELECT id FROM md_statute WHERE korea_statute_id = ?").get(up.naturalKey.korea_statute_id);
    case "md_industry":
      return db.query("SELECT id FROM md_industry WHERE code = ?").get(up.naturalKey.code);
    case "md_source":
      return db.query("SELECT id FROM md_source WHERE code = ?").get(up.naturalKey.code);
  }
}

/** Insert one catalog row; returns the number of rows actually inserted
 * (0 when the md_statute natural-key index (0186) absorbs the write via
 * ON CONFLICT DO NOTHING). */
function insertCatalogByNaturalKey(
  db: { run: (sql: string, ...args: unknown[]) => { changes: number } },
  up: CatalogUpsert,
  id: string,
  now: string,
): number {
  switch (up.table) {
    case "md_company":
      db.run(
        "INSERT INTO md_company (id, dart_corp_code, name_ko, name_en, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, up.naturalKey.dart_corp_code, up.values.name_ko ?? null, up.values.name_en ?? null, now],
      );
      return 1;
    case "md_statute":
      // ON CONFLICT DO NOTHING (no target): absorbs any partial-unique violation
      // — idx_md_statute_code (0186) makes the natural key DB-enforced.
      return db
        .run(
          "INSERT INTO md_statute (id, korea_statute_id, foreign_framework_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
          [id, up.naturalKey.korea_statute_id, up.values.foreign_framework_key ?? null, now],
        )
        .changes;
    case "md_industry":
      db.run(
        "INSERT INTO md_industry (id, code, name_ko, name_en, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, up.naturalKey.code, up.values.name_ko ?? null, up.values.name_en ?? null, now],
      );
      return 1;
    case "md_source":
      db.run(
        "INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?, ?, ?, ?)",
        [id, up.naturalKey.code, up.values.reliability_grade ?? "C", now],
      );
      return 1;
  }
}
