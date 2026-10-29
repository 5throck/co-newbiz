/**
 * GET /api/projects/[id]/wacc/beta-series — collection diagnostics (additive
 * `collection` payload). Scratch-SQLite + nextRequest pattern shared with the
 * other route tests. Tests run in order against one growing dataset:
 * empty -> none, index only -> no_stock, few overlaps -> insufficient, enough -> ready.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-beta-series-route.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { upsertKrxListing } = await import("../../db/repositories/krx-listing.repository.ts");

const NOW = new Date().toISOString();
const INDEX_SERIES = "krx:index:KOSPI:close";
let cookie: string;
let projectId: string;
const companyId = "co-beta-test";
const STOCK_SERIES = `krx:stock:${companyId}:close`;
let sourceId: string;
let unitId: string;
let dayCursor = 0;

function dateOf(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  return d.toISOString().slice(0, 10);
}
function periodFor(date: string): string {
  const existing = db.query("SELECT id FROM md_period WHERE start_date = ? AND period_type = 'date'").get(date) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = ulid();
  db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", [id, "date", date, date, 2026, NOW]);
  return id;
}
function addObs(seriesId: string, date: string, value: number) {
  db.run(
    "INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at) VALUES (?,?,?,?,?,?,?,?)",
    [seriesId, periodFor(date), 1, value, unitId, sourceId, `h-${seriesId}-${date}`, NOW],
  );
}
async function get(query = "") {
  const res = await nextRequest(`/api/projects/${projectId}/wacc/beta-series${query}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

beforeAll(async () => {
  await createUser(db, { userId: "member", role: "analyst", password: "pw-member-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "member", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "member", password: "pw-member-12345" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];

  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [companyId, "테스트전자", NOW]);
  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, company_id) VALUES (?,?,?,?)", [projectId, "PRJ-BETA-001", NOW, companyId]);
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, "member", "lead", "test", NOW, "test setup"],
  );
  sourceId = ulid();
  unitId = ulid();
  // Migration 0184 seeds the reference source codes; reuse the seeded row.
  db.run("INSERT OR IGNORE INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceId, "krx", "A", NOW]);
  sourceId = (db.query("SELECT id FROM md_source WHERE code = ?").get("krx") as { id: string }).id;
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [unitId, "pt-test", "index", 1, NOW]);
});

describe("GET /api/projects/:id/wacc/beta-series collection diagnostics", () => {
  test("nothing collected -> none / run_collection with runbook command", async () => {
    const data = await get();
    expect(data.rows).toEqual([]);
    expect(data.price_count).toBe(0);
    expect(data.collection).toMatchObject({
      subject_company_id: companyId,
      subject_company_name: "테스트전자",
      stock_series_id: STOCK_SERIES,
      index_series_id: INDEX_SERIES,
      status: "none",
      hint_code: "run_collection",
      min_rows: 63,
      source_registered: true,
      runbook_command: `bun scripts/co-newbiz/beta-series.ts --project ${projectId}`,
    });
    expect(data.collection.price).toEqual({ count: 0, first_date: null, last_date: null });
  });

  test("index only -> no_stock / ticker_unresolved", async () => {
    for (let i = 0; i < 100; i++) addObs(INDEX_SERIES, dateOf(i), 3000 + i);
    const data = await get();
    expect(data.collection.status).toBe("no_stock");
    expect(data.collection.hint_code).toBe("ticker_unresolved");
    expect(data.collection.index).toEqual({ count: 100, first_date: dateOf(0), last_date: dateOf(99) });
    expect(data.rows).toEqual([]);
  });

  test("few overlapping days -> insufficient", async () => {
    for (; dayCursor < 10; dayCursor++) addObs(STOCK_SERIES, dateOf(dayCursor), 70000 + dayCursor);
    const data = await get();
    expect(data.collection.status).toBe("insufficient");
    expect(data.collection.hint_code).toBe("insufficient_overlap");
    expect(data.collection.aligned).toEqual({ count: 10, first_date: dateOf(0), last_date: dateOf(9) });
    expect(data.aligned_count).toBe(10);
    expect(data.rows.length).toBe(10);
  });

  test("enough overlap -> ready / ok", async () => {
    for (; dayCursor < 80; dayCursor++) addObs(STOCK_SERIES, dateOf(dayCursor), 70000 + dayCursor);
    const data = await get();
    expect(data.collection.status).toBe("ready");
    expect(data.collection.hint_code).toBe("ok");
    expect(data.collection.aligned.count).toBe(80);
    expect(data.rows[0]).toEqual({ date: dateOf(0), price: 70000, index: 3000 });
  });
});

describe("index choice (listing market default, ?index override)", () => {
  const KOSDAQ_SERIES = "krx:index:KOSDAQ:close";

  test("old rows without a stored market -> KOSPI default as before", async () => {
    const data = await get();
    expect(data.listing_market).toBe("unknown");
    expect(data.default_index).toBe("KOSPI");
    expect(data.collection).toMatchObject({ index_series_id: INDEX_SERIES, index_market: "KOSPI", listing_market: "unknown", index_fallback: false, hint_code: "ok" });
    expect(data.index_options).toEqual([
      { series_id: INDEX_SERIES, label: "KOSPI", count: 100, selected: true },
      { series_id: KOSDAQ_SERIES, label: "KOSDAQ", count: 0, selected: false },
    ]);
  });

  test("KOSDAQ-listed but KOSDAQ index empty -> falls back to KOSPI with index_fallback", async () => {
    expect(await upsertKrxListing(db, sourceId, { company_id: companyId, short_code: "108490", market: "KOSDAQ", name_ko: "테스트전자", resolved_at: NOW })).toBe(true);
    // idempotent
    expect(await upsertKrxListing(db, sourceId, { company_id: companyId, short_code: "108490", market: "KOSDAQ", name_ko: "테스트전자", resolved_at: NOW })).toBe(false);
    const data = await get();
    expect(data.listing_market).toBe("KOSDAQ");
    expect(data.default_index).toBe("KOSPI");
    expect(data.collection).toMatchObject({ index_market: "KOSPI", index_fallback: true, hint_code: "index_fallback", status: "ready" });
    expect(data.rows.length).toBe(80);
  });

  test("default follows the listing market once its index has data", async () => {
    for (let i = 0; i < 100; i++) addObs(KOSDAQ_SERIES, dateOf(i), 800 + i);
    const data = await get();
    expect(data.default_index).toBe("KOSDAQ");
    expect(data.collection).toMatchObject({ index_series_id: KOSDAQ_SERIES, index_market: "KOSDAQ", listing_market: "KOSDAQ", index_fallback: false, hint_code: "ok" });
    expect(data.rows[0]).toEqual({ date: dateOf(0), price: 70000, index: 800 });
    expect(data.index_options.find((o: { label: string }) => o.label === "KOSDAQ").selected).toBe(true);
  });

  test("explicit ?index=KOSPI pairs with KOSPI; default_index stays KOSDAQ", async () => {
    const data = await get("?index=KOSPI");
    expect(data.default_index).toBe("KOSDAQ");
    expect(data.collection).toMatchObject({ index_series_id: INDEX_SERIES, index_market: "KOSPI", index_fallback: false });
    expect(data.rows[0]).toEqual({ date: dateOf(0), price: 70000, index: 3000 });
  });

  test("invalid ?index -> 400 invalid_request", async () => {
    const res = await nextRequest(`/api/projects/${projectId}/wacc/beta-series?index=NASDAQ`, { headers: { cookie } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });
});
