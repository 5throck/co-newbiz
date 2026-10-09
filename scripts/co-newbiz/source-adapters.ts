// @version 1.2.0
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
  /** Series catalog for observation adapters with MONTH grain (KOSIS/ECOS). */
  listSeries(): Promise<SeriesDescriptor[]>;
  /**
   * Day-grain collection hook (KRX). Iterates one month's trading days from a
   * single API call per (series × month); the caller upserts a day period per
   * row and runs ensure_fresh per day. Absent = month-grain adapter.
   */
  listDailyRows?(ctx: { seriesId: string; sourceId: string }, month: string): Promise<KrxDailyRow[]>;
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
 * ⚠ Per-service request PARAMETER and output FIELD names ship UNVERIFIED: the
 * k-krx skill publishes the API IDs and the AUTH_KEY transport (verified
 * 2026-09-11), but field names live in each service's 개발 명세서 behind a
 * portal login, and the workspace key had no services approved at
 * implementation time (2026-10-09 — every service call returned 401
 * Unauthorized API Call), so they could not be confirmed live. They follow
 * the documented openapi.krx.co.kr examples; on first approved use, confirm
 * against the spec and update KRX_FIELD/params maps if the API disagrees.
 */
export const KRX_SEED_SERIES: SeriesDescriptor[] = [
  {
    seriesId: "krx:index:KOSPI:close",
    adapter: "krx",
    title: "코스피 지수 일별종가 — idx/kospi_dd_trd (params unverified — k-krx 개발 명세서)",
    unitCode: "index",
    periodType: "day",
    _verified: false,
  },
  {
    seriesId: "krx:index:KOSDAQ:close",
    adapter: "krx",
    title: "코스닥 지수 일별종가 — idx/kosdaq_dd_trd (params unverified — k-krx 개발 명세서)",
    unitCode: "index",
    periodType: "day",
    _verified: false,
  },
];

/**
 * Runtime registry for per-deal company series (krx:stock:<companyId>:close).
 * The static seeds cannot carry them (company ids are project data), so
 * beta-series.ts registers each company's descriptor — including the resolved
 * KRX 단축코드 as ticker — before collecting. The adapter's fetcher and the
 * daily-row listing resolve through this registry first, then the seeds.
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
    title: `${companyName} 일별종가 — KRX 단축코드 ${ticker} (params unverified — k-krx 개발 명세서)`,
    unitCode: "krw",
    periodType: "day",
    _verified: false,
  };
}

/** One trading day's close from a KRX daily service payload row. */
export interface KrxDailyRow {
  /** ISO date (YYYY-MM-DD), from the row's BAS_DD. */
  date: string;
  value: number;
  raw: string;
}

/** Output FIELD names per service family — see the unverified note above. */
interface KrxFieldMap {
  /** date field (BAS_DD = 기준일자). */
  date: string;
  /** close-price/index field. */
  close: string;
  /** instrument-name filter field (idx services). */
  name?: string;
}

const KRX_INDEX_FIELDS: Record<string, KrxFieldMap> = {
  KOSPI: { date: "BAS_DD", close: "IDX_CLPRC", name: "IDX_NM" },
  KOSDAQ: { date: "BAS_DD", close: "IDX_CLPRC", name: "IDX_NM" },
};

/** KOSPI/KOSDAQ index row match — the idx services return multiple series per day. */
const KRX_INDEX_NAME_MATCH: Record<string, string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
};

const KRX_STOCK_FIELDS: KrxFieldMap = { date: "BAS_DD", close: "TDD_CLPRC" };

/** Request PARAMETER names per service — see the unverified note above. */
const KRX_PARAMS = {
  bgnDd: "bgnDd",
  endDd: "endDd",
};

/** Stock-master lookup result (단축코드 resolution). */
export interface KrxStockMasterRow {
  /** KRX 단축코드 (6-digit code, e.g. 058050 for 샘) — example only. */
  shortCode: string;
  isin: string | null;
  nameKo: string;
  /** KOSPI | KOSDAQ | KONEX — decides the daily-trading service family. */
  market: "KOSPI" | "KOSDAQ" | "KONEX";
}

async function krxGetJson(url: string, apiKey: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { AUTH_KEY: apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`KRX API HTTP ${res.status} from ${new URL(url).host}`);
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

/**
 * Fetch one month's daily rows for a KRX series — ONE API call per
 * (series × month), reused across the month's trading days. This is the
 * collection unit both newbiz.ts fetch (day-grain series) and
 * beta-series.ts consume; the per-day Fetcher closures read from it.
 */
export async function listKrxDailyRows(seriesId: string, month: string): Promise<KrxDailyRow[]> {
  loadPipelineKeys();
  const apiKey = process.env.KRX_API_KEY;
  if (!apiKey) throw new Error("KRX_API_KEY is not set — the krx adapter is disabled until configured.");
  const series = KRX_DYNAMIC_SERIES.get(seriesId) ?? KRX_SEED_SERIES.find((s) => s.seriesId === seriesId);
  if (!series) throw new Error(`krx: unknown series '${seriesId}'`);
  const { path, indexCode } = krxServiceFor(series);
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) throw new Error(`krx: month must be YYYY-MM (got '${month}')`);
  const from = `${y}${String(m).padStart(2, "0")}01`;
  const to = `${y}${String(m).padStart(2, "0")}${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const params = new URLSearchParams({ [KRX_PARAMS.bgnDd]: from, [KRX_PARAMS.endDd]: to });
  const payload = await krxGetJson(`${KRX_BASE}/${path}.json?${params.toString()}`, apiKey);
  const rows = krxRequireRows(payload, path);
  const isIndex = indexCode !== null;
  const fields = isIndex ? KRX_INDEX_FIELDS[indexCode] : KRX_STOCK_FIELDS;
  const matched = rows.filter((r) => {
    if (isIndex && fields.name) {
      const nm = r[fields.name] ?? "";
      return nm.includes(KRX_INDEX_NAME_MATCH[indexCode]);
    }
    if (!isIndex) return series.ticker ? r.ISU_SRT_CD === series.ticker : true;
    return true;
  });
  const out: KrxDailyRow[] = [];
  for (const r of matched) {
    const dateRaw = r[fields.date] ?? "";
    const closeRaw = r[fields.close] ?? "";
    const date = dateRaw.replaceAll("/", "-").replaceAll(".", "-");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || closeRaw === "") continue;
    const value = Number(closeRaw.replaceAll(",", ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({ date, value, raw: JSON.stringify(r) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function krxResolveSeries(seriesId: string): SeriesDescriptor | undefined {
  return KRX_DYNAMIC_SERIES.get(seriesId) ?? KRX_SEED_SERIES.find((s) => s.seriesId === seriesId);
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
  async listSeries() {
    return KRX_SEED_SERIES;
  },
  async listDailyRows(ctx, month) {
    return listKrxDailyRows(ctx.seriesId, month);
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
  db: { query: (sql: string, ...args: unknown[]) => { get: (...args: unknown[]) => unknown }; run: (sql: string, ...args: unknown[]) => void },
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
    insertCatalogByNaturalKey(db, up, ulid(), now);
    inserted++;
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

function insertCatalogByNaturalKey(
  db: { run: (sql: string, ...args: unknown[]) => void },
  up: CatalogUpsert,
  id: string,
  now: string,
): void {
  switch (up.table) {
    case "md_company":
      db.run(
        "INSERT INTO md_company (id, dart_corp_code, name_ko, name_en, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, up.naturalKey.dart_corp_code, up.values.name_ko ?? null, up.values.name_en ?? null, now],
      );
      return;
    case "md_statute":
      db.run(
        "INSERT INTO md_statute (id, korea_statute_id, foreign_framework_key, created_at) VALUES (?, ?, ?, ?)",
        [id, up.naturalKey.korea_statute_id, up.values.foreign_framework_key ?? null, now],
      );
      return;
    case "md_industry":
      db.run(
        "INSERT INTO md_industry (id, code, name_ko, name_en, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, up.naturalKey.code, up.values.name_ko ?? null, up.values.name_en ?? null, now],
      );
      return;
    case "md_source":
      db.run(
        "INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?, ?, ?, ?)",
        [id, up.naturalKey.code, up.values.reliability_grade ?? "C", now],
      );
      return;
  }
}
