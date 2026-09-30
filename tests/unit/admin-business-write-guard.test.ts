// @version 1.0.0
/**
 * ADR-0146 PR2 — admin is rejected (403 role_forbidden) on business WRITE
 * routes; analyst passes the role guard; viewer gets role_required where the
 * route is viewer-gated. One representative route per group, payloads chosen to
 * stop right after the role check (404/400), so no heavy fixtures are needed.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-admin-business-write-guard.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const PASSWORDS: Record<string, string> = { root: "pw-root-12345", alice: "pw-alice-12345", bob: "pw-bob-123456" };
let adminCookie: string;
let analystCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  for (const [userId, role] of [["root", "admin"], ["alice", "analyst"], ["bob", "viewer"]] as const) {
    await createUser(db, { userId, role, password: PASSWORDS[userId], createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  adminCookie = await loginCookie("root", "pw-root-12345");
  analystCookie = await loginCookie("alice", "pw-alice-12345");
  viewerCookie = await loginCookie("bob", "pw-bob-123456");
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

async function errCode(res: Response): Promise<string | undefined> {
  const body = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code;
}

const ROUTES: Array<{ group: string; path: string; body: unknown }> = [
  { group: "opportunities", path: "/api/opportunities", body: {} },
  { group: "brownfield", path: "/api/brownfield/NO_SUCH_OPP/eval-criteria", body: {} },
  { group: "greenfield", path: "/api/greenfield/NO_SUCH_OPP", body: {} },
  { group: "companies", path: "/api/companies/NO_SUCH_CO/analyze", body: {} },
  { group: "market-overview", path: "/api/market-overview/analyses", body: {} },
  { group: "synergy", path: "/api/synergy/analyses", body: {} },
  { group: "our-company", path: "/api/our-company/groups", body: {} },
  { group: "agents/query", path: "/api/agents/query", body: {} },
  { group: "comments", path: "/api/comments", body: {} },
];

describe("ADR-0146 admin business write guard", () => {
  for (const r of ROUTES) {
    test(`${r.group}: admin -> 403 role_forbidden`, async () => {
      const res = await req(r.path, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify(r.body) });
      expect(res.status).toBe(403);
      expect(await errCode(res)).toBe("role_forbidden");
    });
    test(`${r.group}: analyst is not rejected by the role guard`, async () => {
      const res = await req(r.path, { method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify(r.body) });
      expect(await errCode(res)).not.toBe("role_forbidden");
      expect(await errCode(res)).not.toBe("role_required");
    });
  }

  test("comments: viewer -> 403 role_required", async () => {
    const res = await req("/api/comments", { method: "POST", headers: { cookie: viewerCookie }, body: "{}" });
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("role_required");
  });

  test("GET /api/opportunities: admin -> 403 role_forbidden; analyst and viewer -> 200", async () => {
    const admin = await req("/api/opportunities", { headers: { cookie: adminCookie } });
    expect(admin.status).toBe(403);
    expect(await errCode(admin)).toBe("role_forbidden");
    expect((await req("/api/opportunities", { headers: { cookie: analystCookie } })).status).toBe(200);
    expect((await req("/api/opportunities", { headers: { cookie: viewerCookie } })).status).toBe(200);
  });
});

describe("ADR-0146 token issuance", () => {
  const issue = (cookie: string, scopes: string[]) =>
    req("/api/tokens", { method: "POST", headers: { cookie }, body: JSON.stringify({ label: "t", scopes }) });

  test("admin + write scope -> 403 role_forbidden", async () => {
    const res = await issue(adminCookie, ["write"]);
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("role_forbidden");
  });
  test("admin + read scope -> 201", async () => {
    expect((await issue(adminCookie, ["read"])).status).toBe(201);
  });
  test("viewer + write scope -> 403 role_required (unchanged)", async () => {
    const res = await issue(viewerCookie, ["write"]);
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("role_required");
  });
  test("viewer + read scope -> 201 (unchanged)", async () => {
    expect((await issue(viewerCookie, ["read"])).status).toBe(201);
  });
});
