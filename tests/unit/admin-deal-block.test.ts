// Admin deal-block (role separation) — admins run the system (users, master
// data, governance) and must not read deal content, even deals they are
// members of. visibleProject returns null for admins (404-as-not-visible,
// consistent with FR-SEC-01) and deal-list endpoints return empty lists.
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-admin-deal-block.sqlite";
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
  const setCookie = res.headers.getSetCookie()[0] ?? "";
  return setCookie.split(";")[0];
}

let adminCookie: string;
let analystCookie: string;
let projectId: string;

beforeAll(async () => {
  await createUser(db, { userId: "adm", role: "admin", password: "pw-adm-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "adm", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "ana", role: "analyst", password: "pw-ana-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "ana", approvedBy: "test", now: NOW });
  adminCookie = await loginCookie("adm", "pw-adm-12345");
  analystCookie = await loginCookie("ana", "pw-ana-12345");

  const res = await req("/api/projects", {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ project_no: "ADM-BLOCK-1" }),
  });
  projectId = (await res.json()).data.id;
});

describe("admin deal-block", () => {
  test("admin gets an empty deal list", async () => {
    const res = await req("/api/projects", { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(0);
  });

  test("analyst still sees their own deal", async () => {
    const res = await req("/api/projects", { headers: { cookie: analystCookie } });
    const body = await res.json();
    expect(body.data.some((p: { project_no: string }) => p.project_no === "ADM-BLOCK-1")).toBe(true);
  });

  test("admin gets 404-as-not-visible on a deal detail route", async () => {
    const res = await req(`/api/projects/${projectId}/process`, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(404);
  });

  test("admin gets 404 on business-case (deal content)", async () => {
    const res = await req(`/api/projects/${projectId}/business-case`, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(404);
  });

  test("analyst can still read the deal detail route", async () => {
    const res = await req(`/api/projects/${projectId}/process`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
  });

  test("profitability rollup is empty for admin, populated for analyst", async () => {
    const adm = await req("/api/profitability", { headers: { cookie: adminCookie } });
    expect(((await adm.json()).data.projects) ?? []).toEqual([]);
    const ana = await req("/api/profitability", { headers: { cookie: analystCookie } });
    expect(((await ana.json()).data.projects).length).toBe(1);
  });

  test("admin console surfaces stay accessible (users list)", async () => {
    const res = await req("/api/admin/users", { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
  });
});
