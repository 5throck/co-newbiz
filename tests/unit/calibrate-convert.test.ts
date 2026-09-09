/**
 * Wave A2 — calibrate + convert regression tests against real scratch SQLite
 * and the REAL python/correlation.py (pandas required, same as fin-pipeline).
 *
 * calibrate: a perfect linear to-series (to = 3 × from) must produce
 * beta ≈ 3, R² ≈ 1, grade B, and recalibration REPLACES the previous hop
 * (never accumulates duplicates). convert: same-dimension math through
 * md_unit.si_coefficient, cross-dimension refusal (FR-DATA-03), known-unit
 * auto-seeding, and proxy-chain conversion with the chain's compounded band.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-calibrate-convert.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { runCalibrate } = await import("../../scripts/co-newbiz/calibrate.ts");
const { convertUnits, convertViaProxyChain } = await import("../../scripts/co-newbiz/convert.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();
let fromIndustryId = "";
let toIndustryId = "";
let fromSeries = "cal:from";
let toSeries = "cal:to";

function seedPeriod(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  const startDate = `${periodKey}-01`;
  const endDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const found = db
    .query("SELECT id FROM md_period WHERE period_type='month' AND start_date=?")
    .get(startDate) as { id: string } | undefined;
  if (found) return found.id;
  const id = ulid();
  db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
    [id, "month", startDate, endDate, y, NOW]);
  return id;
}

beforeAll(() => {
  fromIndustryId = ulid();
  toIndustryId = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
    [fromIndustryId, "10001", "원료 산업", "Upstream", NOW]);
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
    [toIndustryId, "10002", "완제품 산업", "Downstream", NOW]);
  const unitId = ulid();
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)",
    [unitId, "index", "index", 1, NOW]);
  const sourceId = ulid();
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)",
    [sourceId, "test", "A", NOW]);

  // 24 months: from = 100 + i, to = 3 × from (perfectly linear)
  const year = 2025;
  let i = 0;
  for (let m = 1; m <= 24; m++) {
    const mm = String(m).padStart(2, "0");
    const yy = m <= 12 ? year : year + 1;
    const mm2 = m <= 12 ? mm : String(m - 12).padStart(2, "0");
    const yy2 = m <= 12 ? year : year + 1;
    const periodKey = `${yy}-${mm2}`;
    void mm; void yy;
    const periodId = seedPeriod(`${yy2}-${mm2}`);
    const fromVal = 100 + i;
    for (const [seriesId, value] of [[fromSeries, fromVal], [toSeries, 3 * fromVal]] as const) {
      db.run(
        `INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [seriesId, periodId, 1, value, unitId, sourceId, `hash-${seriesId}-${periodId}`, NOW],
      );
    }
    i++;
  }
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("convert (Wave A2)", () => {
  test("same-dimension conversion via si_coefficient (억원 → 조원)", () => {
    const r = convertUnits(100, "krw_100m", "krw_1t");
    expect(r.converted).toBeCloseTo(0.01, 10);
  });

  test("known units auto-seed on a fresh database", () => {
    const r = convertUnits(5, "ton", "ton");
    expect(r.converted).toBe(5);
  });

  test("cross-dimension conversion is refused (FR-DATA-03)", () => {
    expect(() => convertUnits(1, "krw_100m", "persons")).toThrow(/cross-dimension conversion refused/);
  });

  test("proxy-chain conversion multiplies betas and carries the compounded band", () => {
    const linkId = ulid();
    db.run(
      `INSERT INTO proxy_link (id, from_industry_id, to_industry_id, hop_type, beta, r2, lag_months, ci_low, ci_high, evidence_ref, calibrated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [linkId, fromIndustryId, toIndustryId, "statistical", 2.5, 0.9, 0, 2.3, 2.7, "test", NOW],
    );
    const chainId = ulid();
    db.run(
      `INSERT INTO proxy_chain (id, target_industry_id, hop_ids, reliability_grade, grade_rationale, compounded_ci_low, compounded_ci_high, calibrated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [chainId, toIndustryId, JSON.stringify([linkId]), "B", "single statistical hop, R² eligible", 2.3, 2.7, NOW],
    );
    const r = convertViaProxyChain(10, chainId);
    expect(r.converted).toBe(25);
    expect(r.ciLow).toBe(23);
    expect(r.ciHigh).toBe(27);
    expect(r.grade).toBe("B");
    expect(r.hops).toBe(1);
  });
});

describe("calibrate (Wave A2)", () => {
  test("perfect linear series → beta≈3, R²≈1, grade B; recalibration replaces the hop", async () => {
    const r = await runCalibrate({
      fromIndustryId, toIndustryId, fromSeriesId: fromSeries, toSeriesId: toSeries,
      periodFrom: "2025-01", periodTo: "2026-12",
    });
    expect(r.beta).toBeCloseTo(3, 3);
    expect(r.r2).toBeGreaterThan(0.999);
    expect(r.grade).toBe("B");
    const linkCount = (db
      .query("SELECT COUNT(*) c FROM proxy_link WHERE from_industry_id=? AND to_industry_id=? AND hop_type='statistical'")
      .get(fromIndustryId, toIndustryId) as { c: number }).c;
    expect(linkCount).toBe(1);

    // Recalibration replaces, not accumulates.
    await runCalibrate({
      fromIndustryId, toIndustryId, fromSeriesId: fromSeries, toSeriesId: toSeries,
      periodFrom: "2025-01", periodTo: "2026-12",
    });
    const after = (db
      .query("SELECT COUNT(*) c FROM proxy_link WHERE from_industry_id=? AND to_industry_id=? AND hop_type='statistical'")
      .get(fromIndustryId, toIndustryId) as { c: number }).c;
    expect(after).toBe(1);
  });

  test("insufficient history fails with a clear message (never a silent calibration)", async () => {
    await expect(runCalibrate({
      fromIndustryId, toIndustryId, fromSeriesId: fromSeries, toSeriesId: toSeries,
      periodFrom: "2030-01", periodTo: "2030-12",
    })).rejects.toThrow(/need >= 8 aligned observations/);
  });
});
