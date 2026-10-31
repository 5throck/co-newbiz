// @version 1.0.0
/**
 * Admin master-data redesign: server-generated ids, referenced-row delete guard, idempotent reference seed
 * (migration 0184), and the read-only KSIC browser search (alias hit) with the SI factor formatter.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-master-data-admin.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { browseKsic, formatSiFactor, ksicLevel } = await import("../../app/web-next/lib/master-data-view.ts");

const MD = "/api/admin/master-data";
let cookie = "";

beforeAll(async () => {
  const now = new Date().toISOString();
  await createUser(db, { userId: "root", role: "admin", password: "pw-root-12345", createdBy: "test", now });
  approveUser(db, { userId: "root", approvedBy: "test", now });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "root", password: "pw-root-12345" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const send = (method: string, payload: unknown) => nextRequest(MD, { method, headers: { cookie }, body: JSON.stringify(payload) });
const count = (table: string) => (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("id auto-generation", () => {
  test("POST without an id returns a generated ULID, distinct per row", async () => {
    const a = await send("POST", { table: "md_unit", fields: { code: "zz_a", dimension: "count", si_coefficient: 1 } });
    const b = await send("POST", { table: "md_unit", fields: { code: "zz_b", dimension: "count", si_coefficient: 1 } });
    expect(a.status).toBe(201);
    const idA = ((await a.json()) as { data: { id: string } }).data.id;
    const idB = ((await b.json()) as { data: { id: string } }).data.id;
    expect(idA).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(idA).not.toBe(idB);
    expect((db.query("SELECT code FROM md_unit WHERE id = ?").get(idA) as { code: string }).code).toBe("zz_a");
  });
  test("POST with no fields is rejected, and md_industry is no longer managed here", async () => {
    expect((await send("POST", { table: "md_unit", fields: {} })).status).toBe(400);
    expect((await send("POST", { table: "md_industry", fields: { name_ko: "x" } })).status).toBe(400);
  });
});

describe("referenced-row delete guard", () => {
  test("a used code cannot be deleted; the response lists the usage; it deletes once unused", async () => {
    db.run("CREATE TABLE zz_ref (id TEXT PRIMARY KEY, cur TEXT REFERENCES md_currency(id))");
    const res = await send("POST", { table: "md_currency", fields: { iso_code: "ZZZ" } });
    const id = ((await res.json()) as { data: { id: string } }).data.id;
    db.run("INSERT INTO zz_ref (id, cur) VALUES ('r1', ?), ('r2', ?)", [id, id]);

    const blocked = await send("DELETE", { table: "md_currency", id });
    expect(blocked.status).toBe(400);
    const body = (await blocked.json()) as {
      error: { code: string; details: { references: { table: string; column: string; count: number }[] } };
    };
    expect(body.error.code).toBe("referenced_row");
    expect(body.error.details.references).toEqual([{ table: "zz_ref", column: "cur", count: 2 }]);
    expect(db.query("SELECT id FROM md_currency WHERE id = ?").get(id)).not.toBeNull();

    db.run("DELETE FROM zz_ref");
    expect((await send("DELETE", { table: "md_currency", id })).status).toBe(200);
    expect(db.query("SELECT id FROM md_currency WHERE id = ?").get(id)).toBeNull();
  });
});

describe("reference seed migration 0184", () => {
  test("seeds currencies, countries and the six sources", () => {
    const iso = (t: string) => (db.query(`SELECT iso_code FROM ${t}`).all() as { iso_code: string }[]).map((r) => r.iso_code);
    for (const c of ["KRW", "USD", "EUR", "JPY", "CNY", "GBP"]) expect(iso("md_currency")).toContain(c);
    for (const c of ["KR", "US", "CN", "JP", "DE"]) expect(iso("md_country")).toContain(c);
    const sources = db.query("SELECT code, reliability_grade FROM md_source").all() as { code: string; reliability_grade: string }[];
    expect(sources.map((s) => s.code).sort()).toEqual(["dart", "ecos", "kosis", "krx", "law", "opendata"]);
    expect(sources.find((s) => s.code === "law")?.reliability_grade).toBe("A");
  });
  test("re-running the seed changes nothing and keeps pre-existing rows", () => {
    db.run("UPDATE md_source SET reliability_grade = 'B' WHERE code = 'kosis'");
    const before = [count("md_currency"), count("md_country"), count("md_source")];
    const sql = readFileSync(join(PROJECT_ROOT, "db/migrations/0184_master_data_reference_seed.sql"), "utf8");
    for (const stmt of splitSqlStatements(sql)) db.run(stmt);
    expect([count("md_currency"), count("md_country"), count("md_source")]).toEqual(before);
    expect((db.query("SELECT reliability_grade AS g FROM md_source WHERE code = 'kosis'").get() as { g: string }).g).toBe("B");
  });
});

describe("KSIC browser", () => {
  test("an alias term finds the mapped codes and says so", () => {
    const hits = browseKsic("조선");
    expect(hits[0].matched_by).toBe("alias");
    expect(hits[0].alias).toBe("조선");
    expect(hits.map((h) => h.code)).toContain("31111");
  });
  test("a code prefix, an industry name and the empty query all work", () => {
    expect(browseKsic("311").every((h) => h.code.startsWith("311"))).toBe(true);
    expect(browseKsic("선박").length).toBeGreaterThan(0);
    expect(browseKsic("").length).toBe(2000);
    expect(browseKsic("zzzz-no-such-industry")).toEqual([]);
  });
  test("levels follow the code length", () => {
    expect([ksicLevel("31"), ksicLevel("311"), ksicLevel("3111"), ksicLevel("31111")]).toEqual(["mid", "sub", "detail", "leaf"]);
  });
  test("SI factor reads naturally in Korean and English", () => {
    const names = { man: "만", eok: "억", jo: "조" };
    expect(formatSiFactor(1e8, "ko", names)).toBe("1억");
    expect(formatSiFactor(3.6e12, "ko", names)).toBe("3.6조");
    expect(formatSiFactor(0.01, "ko", names)).toBe("0.01");
    expect(formatSiFactor(1e8, "en")).toBe("100,000,000");
  });
});
