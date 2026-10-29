// @version 1.0.0
/**
 * ADR-0146 PR3 — admin is rejected (403 role_forbidden) on business READ (GET)
 * routes; analyst and viewer are not rejected by the guard; exempt routes stay open to admin.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-admin-business-read-guard.sqlite");
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

const GUARDED: Array<{ group: string; path: string }> = [
  { group: "opportunities", path: "/api/opportunities" },
  { group: "brownfield", path: "/api/brownfield" },
  { group: "greenfield", path: "/api/greenfield" },
  { group: "companies", path: "/api/companies" },
  { group: "market-overview", path: "/api/market-overview/analyses" },
  { group: "synergy", path: "/api/synergy/analyses" },
  { group: "our-company", path: "/api/our-company/groups" },
  { group: "archive", path: "/api/archive/deals" },
  { group: "projects", path: "/api/projects" },
];

const OPEN: string[] = [
  "/api/glossary",
  "/api/market-overview/ksic",
  "/api/market-overview/value-chain-graph",
  "/api/data-changes",
  "/api/library",
  "/api/industries",
  "/api/benchmarks",
];

describe("ADR-0146 admin business read guard", () => {
  for (const r of GUARDED) {
    test(`${r.group}: admin -> 403 role_forbidden`, async () => {
      const res = await req(r.path, { headers: { cookie: adminCookie } });
      expect(res.status).toBe(403);
      expect(await errCode(res)).toBe("role_forbidden");
    });
    for (const [who, getCookie] of [["analyst", () => analystCookie], ["viewer", () => viewerCookie]] as const) {
      test(`${r.group}: ${who} is not rejected by the role guard`, async () => {
        const res = await req(r.path, { headers: { cookie: getCookie() } });
        expect(await errCode(res)).not.toBe("role_forbidden");
        expect(await errCode(res)).not.toBe("role_required");
      });
    }
  }

  test("synergy/web-search: viewer -> 403 role_required, admin -> 403 role_forbidden", async () => {
    const viewer = await req("/api/synergy/web-search", { headers: { cookie: viewerCookie } });
    expect(viewer.status).toBe(403);
    expect(await errCode(viewer)).toBe("role_required");
    const admin = await req("/api/synergy/web-search", { headers: { cookie: adminCookie } });
    expect(admin.status).toBe(403);
    expect(await errCode(admin)).toBe("role_forbidden");
  });
});

describe("ADR-0146 exempt read routes stay open to admin", () => {
  for (const path of OPEN) {
    test(`${path}: admin is not rejected with role_forbidden`, async () => {
      const res = await req(path, { headers: { cookie: adminCookie } });
      expect(await errCode(res)).not.toBe("role_forbidden");
      expect(res.status).not.toBe(403);
    });
  }
});
// Admin rejection on /api/our-company/groups* (and /business-targets) is covered in admin-business-targets-groups.test.ts and business-targets.test.ts.
