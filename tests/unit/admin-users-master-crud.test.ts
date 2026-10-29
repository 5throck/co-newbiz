// @version 1.0.0
/**
 * Admin console CRUD routes: user display-name edit (PUT /api/admin/users/:id set_display_name) and
 * master-data PUT/DELETE. Each needs auth (401), the admin role (403), valid input (400) and an audit row.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-admin-users-master-crud.sqlite");
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
const get = (path: string, cookie: string) => req(path, { headers: { cookie } });


const json = (cookie: string | null, method: string, path: string, payload: unknown) =>
  req(path, { method, headers: cookie ? { cookie } : {}, body: JSON.stringify(payload) });
const auditCount = (action: string, target: string): number =>
  (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND target = ?").get(action, target) as { n: number }).n;

describe("PUT /api/admin/users/:userId set_display_name", () => {
  const path = "/api/admin/users/alice";
  test("401 without a session", async () => {
    expect((await json(null, "PUT", path, { action: "set_display_name", display_name: "Alice K" })).status).toBe(401);
  });
  test("403 for analyst and viewer", async () => {
    for (const cookie of [analystCookie, viewerCookie]) {
      const res = await json(cookie, "PUT", path, { action: "set_display_name", display_name: "Alice K" });
      expect(res.status).toBe(403);
      expect(await errCode(res)).toBe("admin_required");
    }
  });
  test("400 for empty or over-long names", async () => {
    for (const display_name of ["", "   ", "x".repeat(61)]) {
      expect((await json(adminCookie, "PUT", path, { action: "set_display_name", display_name })).status).toBe(400);
    }
    expect((await json(adminCookie, "PUT", path, { action: "set_display_name" })).status).toBe(400);
  });
  test("404 for an unknown user", async () => {
    expect((await json(adminCookie, "PUT", "/api/admin/users/nobody", { action: "set_display_name", display_name: "X" })).status).toBe(404);
  });
  test("200 updates the name and writes an audit row", async () => {
    const res = await json(adminCookie, "PUT", path, { action: "set_display_name", display_name: "  Alice K  " });
    expect(res.status).toBe(200);
    const row = db.query("SELECT display_name FROM app_user WHERE user_id = 'alice'").get() as { display_name: string };
    expect(row.display_name).toBe("Alice K");
    expect(auditCount("account_set_display_name", "alice")).toBe(1);
  });
});

describe("master-data PUT / DELETE", () => {
  const MD = "/api/admin/master-data";
  test("setup: admin adds a currency code", async () => {
    expect((await json(adminCookie, "POST", MD, { table: "md_currency", id: "CUR1", fields: { iso_code: "KRW" } })).status).toBe(201);
  });
  test("401 without a session, 403 for non-admin", async () => {
    expect((await json(null, "PUT", MD, { table: "md_currency", id: "CUR1", fields: { iso_code: "USD" } })).status).toBe(401);
    for (const method of ["PUT", "DELETE"]) {
      for (const cookie of [analystCookie, viewerCookie]) {
        const res = await json(cookie, method, MD, { table: "md_currency", id: "CUR1", fields: { iso_code: "USD" } });
        expect(res.status).toBe(403);
        expect(await errCode(res)).toBe("admin_required");
      }
    }
  });
  test("400 for unknown table, missing id, no editable fields, missing row", async () => {
    expect((await json(adminCookie, "PUT", MD, { table: "app_user", id: "x", fields: { a: 1 } })).status).toBe(400);
    expect((await json(adminCookie, "PUT", MD, { table: "md_currency", fields: { iso_code: "USD" } })).status).toBe(400);
    expect((await json(adminCookie, "PUT", MD, { table: "md_currency", id: "CUR1", fields: { bogus: "x" } })).status).toBe(400);
    expect((await json(adminCookie, "PUT", MD, { table: "md_currency", id: "NOPE", fields: { iso_code: "USD" } })).status).toBe(400);
    expect((await json(adminCookie, "DELETE", MD, { table: "md_currency", id: "NOPE" })).status).toBe(400);
  });
  test("200 PUT updates the row and audits; DELETE removes it and audits", async () => {
    expect((await json(adminCookie, "PUT", MD, { table: "md_currency", id: "CUR1", fields: { iso_code: "USD" } })).status).toBe(200);
    expect((db.query("SELECT iso_code FROM md_currency WHERE id = 'CUR1'").get() as { iso_code: string }).iso_code).toBe("USD");
    expect(auditCount("master_data_update", "md_currency:CUR1")).toBe(1);
    expect((await json(adminCookie, "DELETE", MD, { table: "md_currency", id: "CUR1" })).status).toBe(200);
    expect(db.query("SELECT id FROM md_currency WHERE id = 'CUR1'").get()).toBeNull();
    expect(auditCount("master_data_delete", "md_currency:CUR1")).toBe(1);
  });
});
