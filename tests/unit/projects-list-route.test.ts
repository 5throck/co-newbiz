/**
 * GET /api/projects — deny-by-default list surface backing the /projects
 * nav entry point (S8-S12 project screens previously had no list-level
 * entry point). Mirrors the scratch-SQLite + nextRequest pattern used by
 * tests/unit/api.test.ts, kept minimal since this is a nav/list addition
 * rather than a new feature surface.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-projects-list-route.sqlite";
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

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  const setCookie = res.headers.getSetCookie()[0] ?? "";
  return setCookie.split(";")[0];
}

let memberCookie: string;
let outsiderCookie: string;
let projectId: string;

beforeAll(async () => {
  await createUser(db, { userId: "member", role: "analyst", password: "pw-member-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "member", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "outsider", role: "analyst", password: "pw-outsider-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "outsider", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");

  memberCookie = await loginCookie("member", "pw-member-12345");
  outsiderCookie = await loginCookie("outsider", "pw-outsider-12345");

  projectId = ulid();
  db.run(
    "INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)",
    [projectId, "PRJ-TEST-001", NOW],
  );
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, "member", "lead", "test", NOW, "test setup"],
  );
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

describe("GET /api/projects", () => {
  test("anonymous request is rejected", async () => {
    const res = await req("/api/projects");
    expect(res.status).toBe(401);
  });

  test("a member sees their project", async () => {
    const res = await req("/api/projects", { headers: { cookie: memberCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((p) => p.id === projectId)).toBe(true);
  });

  test("a non-member (deny-by-default) sees nothing", async () => {
    const res = await req("/api/projects", { headers: { cookie: outsiderCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((p) => p.id === projectId)).toBe(false);
  });
});
