// @version 1.0.0
/**
 * T-20261022-020 — the login form used to submit natively before hydration and
 * leak userId/password into the URL query (login?userId=..&password=..,
 * reproduced 2026-10-21). Hardening: the form declares method="post" with
 * action="/api/auth/login" so a pre-hydration submit POSTs (credentials never
 * reach a URL), the submit button stays disabled until hydration, and the
 * hydrated fetch flow is unchanged. The route side never grows a GET handler
 * and never parses the form-encoded native POST.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-login-form-hardening.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const NOW = "2026-10-22T09:00:00Z";
const USER = "login-harden-user";
const PW = "pw-login-harden-123";

beforeAll(async () => {
  await createUser(db, { userId: USER, role: "analyst", password: PW, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("login form markup (SSR source contract)", () => {
  const src = readFileSync(join(PROJECT_ROOT, "app/web-next/app/login/page.tsx"), "utf8");
  test("the form declares a native POST to the auth route — a pre-hydration submit never GETs", () => {
    expect(src).toContain('method="post"');
    expect(src).toContain('action="/api/auth/login"');
  });
  test("the submit button stays disabled until the JS handler is attached", () => {
    expect(src).toContain("disabled={busy || !hydrated}");
    expect(src).toContain("setHydrated(true)");
  });
  test("the hydrated flow still authenticates through the JSON login call", () => {
    expect(src).toContain("await login(userId, password)");
    expect(src).toContain("e.preventDefault()");
  });
});

describe("POST /api/auth/login — the native-form fallback cannot log in or leak", () => {
  test("a form-encoded native POST (what a pre-hydration submit sends) is 400 and sets no session", async () => {
    const res = await nextRequest("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `userId=${encodeURIComponent(USER)}&password=${encodeURIComponent(PW)}`,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
    expect(res.headers.getSetCookie().join(";")).not.toContain("co_newbiz_session=");
    // The 400 happens before the credential check — the failed-login throttle must stay untouched.
    expect((db.query("SELECT COUNT(*) n FROM audit_log WHERE action LIKE '%login%'").get() as { n: number }).n).toBe(0);
  });

  test("GET /api/auth/login has no handler — credentials can never be accepted via the query string", async () => {
    const res = await nextRequest(`/api/auth/login?userId=${encodeURIComponent(USER)}&password=${encodeURIComponent(PW)}`);
    expect(res.status).toBe(405);
  });

  test("the JSON contract is intact — a real login still succeeds (auth not weakened)", async () => {
    const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: USER, password: PW }) });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join(";")).toContain("co_newbiz_session=");
  });
});
