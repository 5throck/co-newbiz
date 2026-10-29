// @version 1.0.0
/**
 * ADR-0146 / ADR-0191 — the admin-side group mirror routes were removed with the business-target move to /our-company; admin stays rejected on the our-company reads.
 * routes; analyst passes the role guard; viewer gets role_required where the
 * route is viewer-gated. One representative route per group, payloads chosen to
 * stop right after the role check (404/400), so no heavy fixtures are needed.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-admin-business-targets-groups.sqlite");
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
let groupId = "";

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
const get = (path: string, cookie: string) => req(path, { headers: { cookie } });

describe("ADR-0146 / ADR-0191 group reads are closed to admin", () => {
  test("setup: analyst creates a group with a member", async () => {
    const res = await req("/api/our-company/groups", {
      method: "POST", headers: { cookie: analystCookie }, body: JSON.stringify({ name: "G1" }),
    });
    expect(res.status).toBe(201);
    groupId = ((await res.json()) as { data: { id: string } }).data.id;
    db.run(
      "INSERT INTO company_group_member (id, group_id, company_name, role, created_at) VALUES ('m1', ?, 'HQ Co', 'hq', ?)",
      [groupId, NOW],
    );
  });

  test("admin: 403 role_forbidden on our-company group reads", async () => {
    for (const path of ["/api/our-company/groups", `/api/our-company/groups/${groupId}`]) {
      const res = await get(path, adminCookie);
      expect(res.status).toBe(403);
      expect(await errCode(res)).toBe("role_forbidden");
    }
  });

  test("analyst: still 200 on originals", async () => {
    expect((await get("/api/our-company/groups", analystCookie)).status).toBe(200);
    expect((await get(`/api/our-company/groups/${groupId}`, analystCookie)).status).toBe(200);
  });
});
