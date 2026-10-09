// @version 1.0.0
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
 * 단축코드 (short code) resolution: the stock-master services
 * (sto/stk_isu_base_info / sto/ksq_isu_base_info — k-krx skill catalog) are
 * called WITHOUT params and filtered by abbreviated name in-process; the
 * per-service param spec (개발 명세서) is not public, so this resolution is
 * UNVERIFIED — a resolved code is cached in db/data/krx-stock-code-cache.json
 * keyed by md_company.id so it only has to work once. Pass --ticker to pin a
 * code explicitly.
 *
 * Scheduling: there is no host scheduler running locally — run this manually
 * (monthly, or more often; ensure_fresh makes reruns cache-hit), or wire it
 * into the host cron when one exists. See docs/runbooks/beta-series-collection.md.
 *
 * Usage:
 *   bun scripts/co-newbiz/beta-series.ts --project <md_project.id> [--from YYYY-MM] [--to YYYY-MM] [--ticker <companyName=code>]...
 *
 * Authorization note: writes ONLY market data (md_source/md_unit/md_period/
 * fact_market_observation) to the production DB — nothing else.
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
  type KrxStockMasterRow,
} from "./source-adapters.ts";

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

/**
 * Best-effort 단축코드 resolution via the stock-base-info services. These are
 * attempted param-less (per-service params are not public — see header); the
 * resulting row shape follows the KRX envelope convention and is UNVERIFIED.
 * Failure here is non-fatal: pin the code with --ticker <이름=코드> instead.
 */
async function resolveStockMaster(companyName: string, market: "kospi" | "kosdaq"): Promise<KrxStockMasterRow | null> {
  loadPipelineKeys();
  const apiKey = process.env.KRX_API_KEY;
  if (!apiKey) return null;
  const service = market === "kospi" ? "sto/stk_isu_base_info" : "sto/ksq_isu_base_info";
  const res = await fetch(`https://data-dbg.krx.co.kr/svc/apis/${service}.json`, {
    headers: { AUTH_KEY: apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as { OutBlock_1?: Array<Record<string, string>> };
  const rows = payload.OutBlock_1 ?? [];
  // Field names follow the KRX envelope convention — treat as unverified.
  const hit = rows.find((r) => (r.ISU_ABBRV ?? r.ISU_NM ?? "").includes(companyName));
  if (!hit) return null;
  const shortCode = hit.ISU_SRT_CD ?? "";
  if (!/^\d{6}$/.test(shortCode)) return null;
  const rawMarket = (hit.MKT_NM ?? (market === "kospi" ? "KOSPI" : "KOSDAQ")).toUpperCase();
  const resolvedMarket = rawMarket === "KOSDAQ" ? "KOSDAQ" : rawMarket === "KONEX" ? "KONEX" : "KOSPI";
  return { shortCode, isin: hit.ISIN_CD ?? null, nameKo: hit.ISU_ABBRV ?? companyName, market: resolvedMarket };
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
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
    const existing = db.query("SELECT id FROM md_period WHERE period_type = 'day' AND start_date = ? AND end_date = ?")
      .get(key, key) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = ulid();
    db.run("INSERT INTO md_period (id, period_type, start_date, end_date, created_at) VALUES (?,?,?,?,?)",
      [id, "day", key, key, new Date().toISOString()]);
    return id;
  }

  let collected = 0;
  const ranges = new Map<string, { count: number; min: string | null; max: string | null }>();

  async function collect(seriesId: string, unitId: string): Promise<void> {
    for (const month of months) {
      let rows;
      try {
        rows = await listKrxDailyRows(seriesId, month);
      } catch (err) {
        console.error(`  ${seriesId}@${month}: ${err instanceof Error ? err.message : err}`);
        continue;
      }
      for (const row of rows) {
        try {
          const periodId = await upsertPeriod(row.date);
          await ensureFresh({
            seriesId, periodId, unitId, sourceId,
            fetcher: async () => ({ value: row.value, contentHash: await sha256Hex(row.raw), raw: row.raw }),
          });
          const stat = ranges.get(seriesId) ?? { count: 0, min: null, max: null };
          stat.count += 1;
          if (!stat.min || row.date < stat.min) stat.min = row.date;
          if (!stat.max || row.date > stat.max) stat.max = row.date;
          ranges.set(seriesId, stat);
          collected += 1;
        } catch (err) {
          console.error(`  ${seriesId}@${row.date}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
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
    if (!shortCode && cache.codes[company.id]) {
      const cached = cache.codes[company.id];
      shortCode = cached.shortCode;
      market = cached.market.toLowerCase() === "kosdaq" ? "kosdaq" : "kospi";
      console.log(`${company.nameKo}: 단축코드 ${shortCode} (cache)`);
    }
    if (!shortCode) {
      // Try KOSPI master first, then KOSDAQ (robotics small-caps often KOSDAQ).
      for (const m of ["kospi", "kosdaq"] as const) {
        const row = await resolveStockMaster(company.nameKo, m).catch(() => null);
        if (row) {
          shortCode = row.shortCode;
          market = m;
          cache.codes[company.id] = { shortCode, market: row.market, nameKo: row.nameKo, resolvedAt: new Date().toISOString() };
          cacheDirty = true;
          console.log(`${company.nameKo}: 단축코드 ${shortCode} resolved via ${row.market} stock master (unverified shape)`);
          break;
        }
      }
    }
    if (!shortCode) {
      console.error(`${company.nameKo}: 단축코드 not resolved — pass --ticker ${company.nameKo}=<6-digit code> to pin it.`);
      continue;
    }
    const series = krxStockSeries(company.id, shortCode, company.nameKo, market ?? "kospi");
    registerKrxSeries(series);
    console.log(`collecting ${series.seriesId} (${series.title})…`);
    await collect(series.seriesId, krwUnitId);
  }
  if (cacheDirty) await saveCache(cache);

  console.log(`\nbeta-series done: ${collected} observation(s) written.`);
  for (const [seriesId, stat] of ranges) {
    console.log(`  ${seriesId}: ${stat.count} obs, ${stat.min} ~ ${stat.max}`);
  }
  if (collected === 0) {
    console.error("\nbeta-series: 0 observations collected — see errors above (KRX service approval 401 means re-apply at openapi.krx.co.kr).");
    process.exit(1);
  }
}

await main();
