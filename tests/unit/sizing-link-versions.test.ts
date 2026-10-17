// @version 1.0.0
/**
 * Additive GET /api/opportunities/[id]/sizing-link/versions (2026-10-17
 * decider feedback): the dropdown listing of COMPLETED S1 sizing versions
 * for the opportunity's industry, newest first. Shape (id, version_no,
 * industry_name, scope via the tolerant extractor, confidence_grade,
 * completed_at), newest-first ordering, 404 unknown opportunity, empty
 * list without an industry, and that a listed version pins through the
 * SAME human-only sizing-link PUT. ASCII-only source (Korean via \u).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-sizing-link-versions.sqlite");
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
const ANALYST = "sizing-versions-analyst";
let cookie = "";
const json = JSON.stringify;

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function seedSizing(industryId: string, versions: Array<{ id: string; no: number; grade: string | null; at: string; scoped: boolean }>) {
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryId, industryId, "t", "Test Industry", NOW]);
  db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    ["ana-" + industryId, industryId, "completed", ANALYST, NOW, NOW]);
  for (const v of versions) {
    const payload = v.scoped
      ? json({ anchor: { sources: [], total: 123 }, scope: { regions: ["we"], segments: ["Stage V"], unit_basis: "usd_m_year" } })
      : json({ anchor: { sources: [], total: 5 } });
    db.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at, data_confidence_grade) VALUES (?,?,?,?,?,?,?)",
      [v.id, "ana-" + industryId, v.no, payload, ANALYST, v.at, v.grade]);
  }
}

function makeOpp(industryId: string | null): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, industry_id) VALUES (?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ANALYST, NOW, industryId]);
  return oppId;
}

const getVersions = (id: string, headers: Record<string, string> = { cookie }) =>
  nextRequest(`/api/opportunities/${id}/sizing-link/versions`, { method: "GET", headers });

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-sizing-versions-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-sizing-versions-1");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("sizing-link versions listing (additive GET)", () => {
  test("shape: id, version_no, industry_name, tolerant scope, confidence_grade, completed_at", async () => {
    const ind = "ind-v-" + ulid().slice(-6);
    seedSizing(ind, [{ id: "ver-1", no: 1, grade: "C", at: NOW, scoped: true }]);
    const oppId = makeOpp(ind);
    const res = await getVersions(oppId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeTruthy();
    expect(body.error).toBeNull();
    expect(body.data.versions).toHaveLength(1);
    expect(body.meta.count).toBe(1);
    const v = body.data.versions[0];
    expect(v.id).toBe("ver-1");
    expect(v.version_no).toBe(1);
    expect(v.industry_name).toBe("t");
    expect(v.scope).toEqual({ regions: ["we"], segments: ["Stage V"], unit_basis: "usd_m_year" });
    expect(v.confidence_grade).toBe("C");
    expect(typeof v.completed_at).toBe("string");
  });

  test("newest first (created_at desc, then version_no desc); unscoped payload -> scope null", async () => {
    const ind = "ind-v-" + ulid().slice(-6);
    seedSizing(ind, [
      { id: "ver-old", no: 1, grade: "C", at: "2026-01-01T00:00:00.000Z", scoped: false },
      { id: "ver-new", no: 2, grade: "B", at: "2026-02-01T00:00:00.000Z", scoped: true },
    ]);
    const oppId = makeOpp(ind);
    const body = await (await getVersions(oppId)).json();
    expect(body.data.versions.map((v: { id: string }) => v.id)).toEqual(["ver-new", "ver-old"]);
    expect(body.data.versions[1].scope).toBeNull();
  });

  test("unknown opportunity 404; opportunity without industry -> empty list", async () => {
    expect((await getVersions("no-such-opp")).status).toBe(404);
    const oppId = makeOpp(null);
    const body = await (await getVersions(oppId)).json();
    expect(body.data.versions).toEqual([]);
  });

  test("selection writes through the SAME human-only sizing-link PUT; clear still works", async () => {
    const ind = "ind-v-" + ulid().slice(-6);
    seedSizing(ind, [{ id: "ver-pin", no: 1, grade: "B", at: NOW, scoped: true }]);
    const oppId = makeOpp(ind);
    const listed = await (await getVersions(oppId)).json();
    const versionId = listed.data.versions[0].id;
    const pin = await nextRequest(`/api/opportunities/${oppId}/sizing-link`, { method: "PUT", headers: { cookie }, body: json({ version_id: versionId }) });
    expect(pin.status).toBe(200);
    const link = await (await nextRequest(`/api/opportunities/${oppId}/sizing-link`, { method: "GET", headers: { cookie } })).json();
    expect(link.data.link).toEqual({ analysis_id: "ana-" + ind, version_id: "ver-pin" });
    const clear = await nextRequest(`/api/opportunities/${oppId}/sizing-link`, { method: "PUT", headers: { cookie }, body: json({ analysis_id: null, version_id: null }) });
    expect(clear.status).toBe(200);
    const after = await (await nextRequest(`/api/opportunities/${oppId}/sizing-link`, { method: "GET", headers: { cookie } })).json();
    expect(after.data.link).toBeNull();
  });

  test("unauthenticated GET is 401", async () => {
    const oppId = makeOpp(null);
    expect((await getVersions(oppId, {})).status).toBe(401);
  });
});
