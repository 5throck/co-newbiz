#!/usr/bin/env bun
// @version 1.0.0
/**
 * dart-collect.ts — DART OpenAPI collector for chain-node financials
 * (ADR-0066 Phase A; the k-dart skill's retrieval discipline, wired to
 * fact_industry). Primary ingestion path for chain-node 5-year financials;
 * when DART_API_KEY is unset or a lookup fails, use the financial-imports
 * REST fallback (user-provided data) instead — progress never blocks here.
 *
 * Usage:
 *   bun scripts/co-newbiz/dart-collect.ts --corp-code <dart_corp_code> \
 *     --industry-id <md_industry_id> [--years 5] [--db-path <path>]
 *
 * Requires DART_API_KEY in env. Maps three canonical metrics from the
 * 단일회사 전체 재무제표 (fnlttSinglAcntAll, reprt_code=11011):
 *   매출액 → revenue · 영업이익 → operating_income · 당기순이익 → net_income
 * Values land in fact_industry as raw-won REAL with revision_no=1.
 */

import { getDb } from "../../db/client.ts";

const METRIC_BY_ACCOUNT: Record<string, string> = {
  "매출액": "revenue",
  "영업이익": "operating_income",
  "당기순이익": "net_income",
};

export async function collectFromDart(opts: { corpCode: string; industryId: string; years?: number; dbPath?: string }): Promise<{ inserted: number }> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    throw new Error("DART_API_KEY is not set — configure it, or use POST /api/projects/:id/financial-imports to provide data directly.");
  }
  const db = getDb(opts.dbPath);
  const years = opts.years ?? 5;
  const nowYear = new Date().getUTCFullYear();
  let inserted = 0;

  for (let y = nowYear - years + 1; y <= nowYear - 1; y++) {
    // Annual reports only (11011); the current year has no filed statement.
    const url = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?corp_code=${encodeURIComponent(opts.corpCode)}&bsns_year=${y}&reprt_code=11011&api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`DART request failed for ${y}: HTTP ${res.status}`);
    const payload = await res.json() as { status?: string; list?: Array<{ sj_nm?: string; account_nm?: string; thstrm_amount?: string; currency?: string }> };
    if (payload.status !== "000" || !Array.isArray(payload.list)) continue; // '013' = no data for year

    let periodId = (db.query("SELECT id FROM md_period WHERE period_type='year' AND fiscal_year=?").get(y) as { id: string } | undefined)?.id;
    if (!periodId) {
      periodId = ulid();
      db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
        [periodId, "year", `${y}-01-01`, `${y}-12-31`, y, new Date().toISOString()]);
    }

    for (const entry of payload.list) {
      const metricKey = METRIC_BY_ACCOUNT[entry.account_nm ?? ""];
      const amount = Number(entry.thstrm_amount);
      if (!metricKey || !Number.isFinite(amount) || amount === 0) continue;
      db.run(
        "INSERT INTO fact_industry (id, industry_id, period_id, metric_key, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), opts.industryId, periodId, metricKey, amount, 1, null, new Date().toISOString()],
      );
      inserted++;
    }
  }
  return { inserted };
}

const args = process.argv.slice(2);
if (import.meta.main) {
  const get = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const corpCode = get("--corp-code");
  const industryId = get("--industry-id");
  if (!corpCode || !industryId) {
    console.error("Usage: dart-collect --corp-code <code> --industry-id <id> [--years 5] [--db-path <path>]");
    process.exit(1);
  }
  try {
    const result = await collectFromDart({ corpCode, industryId, years: Number(get("--years") ?? 5), dbPath: get("--db-path") });
    console.log(`✅ DART collection complete: ${result.inserted} fact row(s).`);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    console.error("   Fallback: POST /api/projects/:id/financial-imports accepts user-provided rows.");
    process.exit(1);
  }
}
