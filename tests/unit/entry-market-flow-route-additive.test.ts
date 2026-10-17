// @version 1.0.0
/**
 * Additive fields on GET /api/opportunities/[id]/entry-market-derivation
 * (2026-10-17 entry-market flow redesign, design SS5.1): scope_set /
 * scope_unit_basis / legacy_anchor ride the 200 payload AND the not-linked
 * 409 body's data (error unchanged). ASCII-only source (Korean via \u).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-em-flow-route.sqlite");
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

const NOW = new Date().toISOString();
const ANALYST = "em-route-analyst";
let cookie = "";
const json = JSON.stringify;

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function seedIndustryAndVersion() {
  const ind = "ind-em-" + ulid().slice(-6);
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [ind, ind, "t", "Test Industry", NOW]);
  db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    ["ana-" + ind, ind, "completed", ANALYST, NOW, NOW]);
  db.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade) VALUES (?,?,?,?,?,?,?)",
    ["ver-" + ind, "ana-" + ind, 1, json({ anchor: { sources: [], total: 90000 }, scope: { regions: ["kr"], segments: ["Stage V"], unit_basis: "usd_m_year" } }), ANALYST, NOW, "B"]);
  return ind;
}

function makeOpp(industryId: string | null): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, industry_id) VALUES (?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ANALYST, NOW, industryId]);
  return oppId;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-em-route-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-em-route-1");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("entry-market GET additive fields", () => {
  test("200 payload carries scope_set, scope_unit_basis and legacy_anchor", async () => {
    const ind = seedIndustryAndVersion();
    const oppId = makeOpp(ind);
    // Person-set scope so scope_set/scope_unit_basis are non-default.
    const putScope = await nextRequest(`/api/opportunities/${oppId}/target-scope`, {
      method: "PUT", headers: { cookie }, body: json({ regions: ["kr"], segments: ["Stage V"], unit_basis: "usd_m_year" }),
    });
    expect(putScope.status).toBe(200);
    // Pin the S1 version through the human-only sizing-link PUT.
    const putLink = await nextRequest(`/api/opportunities/${oppId}/sizing-link`, {
      method: "PUT", headers: { cookie }, body: json({ version_id: "ver-" + ind }),
    });
    expect(putLink.status).toBe(200);
    const res = await nextRequest(`/api/opportunities/${oppId}/entry-market-derivation`, { method: "GET", headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scope_set).toBe(true);
    expect(body.data.scope_unit_basis).toBe("usd_m_year");
    expect(body.data.legacy_anchor).toEqual({ market_size_krw_m: null, growth_rate: null });
  });

  test("not-linked 409 keeps its error and now carries the additive data", async () => {
    const oppId = makeOpp(null);
    // Legacy anchor fields so legacy_anchor is non-null.
    db.run("UPDATE opportunity SET market_size_krw_m = 77000, growth_rate = 0.05 WHERE id = ?", [oppId]);
    const res = await nextRequest(`/api/opportunities/${oppId}/entry-market-derivation`, { method: "GET", headers: { cookie } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("not_linked");
    expect(body.data.scope_set).toBe(false);
    expect(body.data.scope_unit_basis).toBeNull();
    expect(body.data.legacy_anchor).toEqual({ market_size_krw_m: 77000, growth_rate: 0.05 });
  });
});
