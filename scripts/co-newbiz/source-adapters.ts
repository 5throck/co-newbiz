// @version 1.0.3
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
  adapter: "dart" | "kosis" | "opendata" | "law";
  title: string;
  unitCode: string;
  periodType: "year" | "quarter" | "month";
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
