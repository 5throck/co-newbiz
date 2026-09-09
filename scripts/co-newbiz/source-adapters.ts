// @version 1.0.1
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
 *  - Seed statIds carry "_verified": false until confirmed against the live
 *    KOSIS API — the seed ships unverified-by-design, not as authority.
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
  adapter: "dart" | "kosis" | "opendata" | "law";
  title: string;
  unitCode: string;
  periodType: "year" | "quarter" | "month";
  /** KOSIS orgId + tblId pair for the stats API call */
  orgId?: string;
  tblId?: string;
  objL1?: string;
  itmId?: string;
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
  code: "dart" | "kosis" | "opendata" | "law";
  kSkill: string;
  credentialEnv: string;
  kind: "observations" | "catalog";
  /** Disabled when the credential is absent — the CLI reports and exits 2. */
  isEnabled(): boolean;
  /** Series catalog for observation adapters; [] for catalog-only adapters. */
  listSeries(): Promise<SeriesDescriptor[]>;
  /** Build the raw observation fetcher for one series (argument is a period key such as YYYY-MM). */
  fetcher(ctx: { seriesId: string; sourceId: string }): Fetcher;
  /** Catalog upserts for catalog adapters; [] otherwise. */
  listCatalog?(opts: { all?: boolean }): Promise<CatalogUpsert[]>;
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
    // DART corpList.xml is the one DART endpoint that is XML-only; fetch the
    // ZIP, decompress, and parse the COMPANY rows. (Full XML parsing lives in
    // the CLI case — here we produce upserts from the standard list.)
    const url = `https://opendart.fss.or.kr/api/corpList.xml?crtfc_key=${encodeURIComponent(apiKey)}`;
    const { safeFetch } = await import("../lib/ssrf.ts");
    const res = await safeFetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`DART corpList: HTTP ${res.status}`);
    const rows = parseCorpXml(Buffer.from(await res.arrayBuffer()));
    if (rows.length === 0) throw new Error("DART corpList: ZIP/XML parse yielded no company rows.");
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
    seriesId: "kosis:9012011",
    adapter: "kosis",
    orgId: "101",
    tblId: "9012011",
    title: "산업생산지수 (광공업·제조업 제외, 사업체조사 기준) — SEED, verify tblId against KOSIS before production",
    unitCode: "index",
    periodType: "month",
    _verified: false,
  },
  {
    seriesId: "kosis:2001109",
    adapter: "kosis",
    orgId: "101",
    tblId: "2001109",
    title: "광업·제조업 생산자출하지수 — SEED, verify tblId against KOSIS before production",
    unitCode: "index",
    periodType: "month",
    _verified: false,
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
        `kosis: series '${ctx.seriesId}' is not live-fetchable yet — verify objL1/itmId against KOSIS and update KOSIS_SEED_SERIES before collection.`,
      );
    }
    const apiKey = requireKey("KOSIS_API_KEY");
    return async (periodKey: string) => {
      // KOSIS stats API: one call per series returns the full period range;
      // periodKey (YYYY-MM or YYYY) narrows the parsed row.
      const compactPeriod = periodKey.replace("-", "");
      const url = `https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList&apiKey=${encodeURIComponent(apiKey)}&orgId=${encodeURIComponent(series.orgId!)}&tblId=${encodeURIComponent(series.tblId!)}&objL1=${encodeURIComponent(series.objL1!)}&itmId=${encodeURIComponent(series.itmId!)}&prdSe=M&startPrdDe=${encodeURIComponent(compactPeriod)}&endPrdDe=${encodeURIComponent(compactPeriod)}&format=json`;
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
    const keyCols = Object.keys(up.naturalKey);
    const where = keyCols.map((c) => `${c} = ?`).join(" AND ");
    const found = db.query(`SELECT id FROM ${up.table} WHERE ${where}`).get(...keyCols.map((c) => up.naturalKey[c])) as
      | { id: string }
      | undefined;
    if (found) {
      existing++;
      continue;
    }
    const cols = [...keyCols, ...Object.keys(up.values)];
    const vals = [...keyCols.map((c) => up.naturalKey[c]), ...Object.values(up.values)];
    db.run(
      `INSERT INTO ${up.table} (id, ${cols.join(", ")}, created_at) VALUES (${["?", ...cols.map(() => "?"), "?"].join(", ")})`,
      [ulid(), ...vals, now],
    );
    inserted++;
  }
  return { inserted, existing };
}
