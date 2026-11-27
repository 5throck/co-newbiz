// @version 1.0.0
/**
 * ADR-0208 slice 4 - GET /api/projects/[id]/wacc/bond-evidence (FSC bond APIs as cross-check evidence). Real route handler +
 * scratch SQLite; the portal is a stubbed global fetch over the recorded fixtures (tests/fixtures/fsc-bond), so NO live network.
 * Covers: authorization (member incl. viewer 200, outsider/admin 404, anonymous 401), 400 without a subject company or with an
 * invalid target_id, 503 data_go_kr_api_key_missing, the evidence payload (cross_check_only, issuer matched by name, bonds in
 * KRW millions, latest price yield, KOGL attribution), graceful 'unavailable' while the key is not yet registered (HTTP 200),
 * and that the evidence never reaches GET .../wacc/suggestions or apply-all.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = "db/data/test-wacc-bond-evidence-route.sqlite";
const ENV_ORIGINALS: Record<string, string | undefined> = {
  CO_NEWBIZ_DB_PATH: process.env.CO_NEWBIZ_DB_PATH,
  DATA_GO_KR_API_KEY: process.env.DATA_GO_KR_API_KEY,
};
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
const { resetFscBondCacheForTests } = await import("../../app/web-next/lib/fsc-bond-client.ts");
const { loadPipelineKeys } = await import("../../scripts/lib/env-keys.ts");

const NOW = new Date().toISOString();
const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "fsc-bond", name), "utf8");

// Make the pipeline-key load a no-op first, so setting/removing DATA_GO_KR_API_KEY below is authoritative.
loadPipelineKeys();

const realFetch = globalThis.fetch;
let portal: ((url: URL) => Response) | null = null;
const fetched: URL[] = [];
beforeEach(() => {
  resetFscBondCacheForTests();
  fetched.length = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (u.host !== "apis.data.go.kr") throw new Error(`test: unexpected network access to ${u.host}`);
    fetched.push(u);
    if (!portal) throw new Error("test: install a portal stub first");
    return portal(u);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  portal = null;
});
const happyPortal = (u: URL) =>
  new Response(u.pathname.endsWith("getBondBasiInfo_V2") ? fx("basic-info.json") : fx("price-info.json"), {
    status: 200,
  });

let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let adminCookie = "";
let projectWithCompany = "";
let projectNoCompany = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
async function mkUser(userId: string, role: "analyst" | "viewer" | "admin"): Promise<string> {
  await createUser(db, { userId, role, password: `pw-${userId}-12345`, createdBy: "test", now: NOW });
  approveUser(db, { userId, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [userId]);
  return loginCookie(userId, `pw-${userId}-12345`);
}
function mkProject(no: string, companyId: string | null): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, company_id, status) VALUES (?,?,?,?, 'open')", [
    id,
    no,
    NOW,
    companyId,
  ]);
  for (const [userId, role] of [
    ["be-analyst", "lead"],
    ["be-viewer", "member"],
  ]) {
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [id, userId, role, "test", NOW, "bond evidence test"],
    );
  }
  return id;
}
const get = (projectId: string, cookie: string | null, query = "") =>
  nextRequest(`/api/projects/${projectId}/wacc/bond-evidence${query}`, { headers: cookie ? { cookie } : {} });

beforeAll(async () => {
  analystCookie = await mkUser("be-analyst", "analyst");
  viewerCookie = await mkUser("be-viewer", "viewer");
  outsiderCookie = await mkUser("be-outsider", "analyst");
  adminCookie = await mkUser("be-admin", "admin");
  const company = ulid();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [company, "한화솔루션", NOW]);
  projectWithCompany = mkProject("PRJ-BE-A", company);
  projectNoCompany = mkProject("PRJ-BE-B", null);
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [key, value] of Object.entries(ENV_ORIGINALS)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("authorization and preflight", () => {
  test("outsider and admin 404, anonymous 401; a member (even a viewer) may look up", async () => {
    process.env.DATA_GO_KR_API_KEY = "k";
    portal = happyPortal;
    expect((await get(projectWithCompany, outsiderCookie)).status).toBe(404);
    expect((await get(projectWithCompany, adminCookie)).status).toBe(404);
    expect((await get(projectWithCompany, null)).status).toBe(401);
    expect(fetched).toHaveLength(0);
    expect((await get(projectWithCompany, viewerCookie)).status).toBe(200);
  }, 60000);

  test("no subject company -> 400 no_subject_company; an invalid target_id -> 400", async () => {
    process.env.DATA_GO_KR_API_KEY = "k";
    portal = happyPortal;
    const none = await get(projectNoCompany, analystCookie);
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe("no_subject_company");
    const bad = await get(projectWithCompany, analystCookie, "?target_id=nope");
    expect(bad.status).toBe(400);
    expect(fetched).toHaveLength(0);
  }, 60000);

  test("missing DATA_GO_KR_API_KEY -> 503 data_go_kr_api_key_missing, no portal call", async () => {
    process.env.DATA_GO_KR_API_KEY = "  ";
    portal = happyPortal;
    const res = await get(projectWithCompany, analystCookie);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { data: unknown; error: { code: string; message: string } };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("data_go_kr_api_key_missing");
    expect(body.error.message).toContain("DATA_GO_KR_API_KEY");
    expect(fetched).toHaveLength(0);
  }, 60000);
});

describe("evidence", () => {
  test("the issuer's outstanding bonds with latest price yield, matched by name, reference only, with the KOGL notice", async () => {
    process.env.DATA_GO_KR_API_KEY = "ab%2Bcd";
    portal = happyPortal;
    const res = await get(projectWithCompany, analystCookie);
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: Record<string, any> }).data;
    expect(data.project_id).toBe(projectWithCompany);
    expect(data.company.name_ko).toBe("한화솔루션");
    const ev = data.evidence;
    expect(ev).toMatchObject({
      cross_check_only: true,
      status: "ok",
      issuer: { query_name: "한화솔루션", matched_name: "한화솔루션", crno: "1101110360935", match_basis: "name" },
    });
    expect(ev.bonds[0]).toMatchObject({
      isin: "KR6009831E88",
      coupon_pct: 5.95,
      matures_on: "2054-08-14",
      balance_krw_million: 700000, // ADR-0061: INTEGER KRW millions
      price_status: "traded",
      last_price: { as_of: "2022-04-14", yield_pct: 3.997 },
    });
    expect(ev.attribution.basic.license).toBe("공공누리 제2유형");
    expect(ev.attribution.price.terms).toBe("attribution_required_no_commercial_use_no_modification");
    // the key never leaves the server
    expect(JSON.stringify(data)).not.toContain("serviceKey");
    expect(JSON.stringify(data)).not.toContain("ab%2Bcd");
  }, 60000);

  test("key not yet registered: HTTP 200 with status 'unavailable' and the reason code (graceful)", async () => {
    process.env.DATA_GO_KR_API_KEY = "k";
    portal = () => new Response(fx("error-key-not-registered.json"), { status: 403 });
    const res = await get(projectWithCompany, analystCookie);
    expect(res.status).toBe(200);
    const ev = ((await res.json()) as { data: { evidence: Record<string, unknown> } }).data.evidence;
    expect(ev).toMatchObject({ status: "unavailable", reason_code: "service_key_not_registered", bonds: [] });
  }, 60000);

  test("never applied: the suggestions payload and apply-all carry no bond evidence", async () => {
    process.env.DATA_GO_KR_API_KEY = "k";
    portal = happyPortal;
    const res = await nextRequest(`/api/projects/${projectWithCompany}/wacc/suggestions`, {
      headers: { cookie: analystCookie },
    });
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("KR6009831E88");
    expect(text).not.toContain("bond_evidence");
    expect(fetched).toHaveLength(0); // the suggestions GET never calls the portal
  }, 60000);
});
