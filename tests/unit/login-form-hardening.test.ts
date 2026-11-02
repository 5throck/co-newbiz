// @version 1.1.0
/**
 * T-20261022-020 — the login form used to submit natively before hydration and
 * leak userId/password into the URL query (login?userId=..&password=..,
 * reproduced 2026-10-21). Hardening: the form declares method="post" with
 * action="/api/auth/login" so a pre-hydration submit POSTs (credentials never
 * reach a URL), the submit button stays disabled until hydration, and the
 * hydrated fetch flow is unchanged. The route side never grows a GET handler
 * and never parses the form-encoded native POST.
 *
 * T-20261022-034 — the same defect class existed on the two sibling pages:
 * /register (userId + chosen password) and /password-change (currentPassword +
 * newPassword). Both now follow the login pattern (method/action + !hydrated
 * gate); this file covers their markup contract and route behavior too — the
 * form-encoded native POST is 4xx with no session cookie and no credential
 * echo, while the legit JSON path still works.
 *
 * T-20261102 (owner decision, access tightening "Option A") — self-registration
 * is CLOSED: /api/auth/register refuses with 403 registration_disabled unless
 * CO_NEWBIZ_ALLOW_REGISTER=1, the login page no longer links to /register, and
 * the /register page renders a short disabled notice (no form, no API call)
 * so stale bookmarks get an explanation instead of a 404.
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
// T-20261022-034: dedicated user for the password-change route tests, so the
// new-password rotation below cannot disturb the login tests' USER/PW pair.
const PW_USER = "login-harden-pw-user";
const PW_USER_PW = "pw-harden-current-123";
const PW_USER_NEW = "pw-harden-rotated-456";

beforeAll(async () => {
  await createUser(db, { userId: USER, role: "analyst", password: PW, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  await createUser(db, { userId: PW_USER, role: "viewer", password: PW_USER_PW, createdBy: "test", now: NOW });
  approveUser(db, { userId: PW_USER, approvedBy: "test", now: NOW });
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
    expect(src).toContain("await login(userId.trim(), password)");
    expect(src).toContain("e.preventDefault()");
  });
  test("T-20261102 the register affordance is removed — no /register link, no register copy (accounts are admin-issued)", () => {
    expect(src).not.toContain('href="/register"');
    expect(src).not.toContain("registerPrompt");
    expect(src).not.toContain("registerHint");
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
    const res = await nextRequest(
      `/api/auth/login?userId=${encodeURIComponent(USER)}&password=${encodeURIComponent(PW)}`,
    );
    expect(res.status).toBe(405);
  });

  test("the JSON contract is intact — a real login still succeeds (auth not weakened)", async () => {
    const res = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: USER, password: PW }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join(";")).toContain("co_newbiz_session=");
  });
});

describe("T-20261102 register page — closed-registration notice (SSR source contract)", () => {
  const src = readFileSync(join(PROJECT_ROOT, "app/web-next/app/register/page.tsx"), "utf8");
  test("the page renders no account-request form and never calls the register API", () => {
    expect(src).not.toContain("<form");
    expect(src).not.toContain('action="/api/auth/register"');
    expect(src).not.toContain('api.post("/api/auth/register"');
  });
  test("it explains the closure and links back to the sign-in screen (stale bookmarks never 404)", () => {
    expect(src).toContain('t("disabledHeading")');
    expect(src).toContain('t("disabledMessage")');
    expect(src).toContain('href="/login"');
  });
});

describe("T-20261022-034 password-change form markup (SSR source contract)", () => {
  const src = readFileSync(join(PROJECT_ROOT, "app/web-next/app/password-change/page.tsx"), "utf8");
  test("the form declares a native POST to the password-change route — a pre-hydration submit never GETs", () => {
    expect(src).toContain('method="post"');
    expect(src).toContain('action="/api/auth/password-change"');
  });
  test("the submit button stays disabled until the JS handler is attached", () => {
    expect(src).toContain("disabled={busy || !hydrated}");
    expect(src).toContain("setHydrated(true)");
  });
  test("the hydrated flow still submits through the JSON password-change call", () => {
    expect(src).toContain('api.post("/api/auth/password-change"');
    expect(src).toContain("e.preventDefault()");
  });
});

describe("POST /api/auth/register — closed by default (T-20261102); the native-form fallback cannot register or leak", () => {
  test("while closed, a form-encoded native POST (what a pre-hydration submit sends) is 403 registration_disabled — echoes no credential, sets no session", async () => {
    const res = await nextRequest("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `userId=${encodeURIComponent("native-leak@example.com")}&password=${encodeURIComponent("leaked-pw-12345")}`,
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("registration_disabled");
    const body = JSON.stringify(json);
    expect(body).not.toContain("native-leak@example.com");
    expect(body).not.toContain("leaked-pw-12345");
    expect(res.headers.getSetCookie().join(";")).not.toContain("co_newbiz_session=");
    // The closed gate precedes the throttle counter — repeated native submits fill no quota and create nothing.
    const again = await nextRequest("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `userId=${encodeURIComponent("native-leak-2@example.com")}&password=${encodeURIComponent("leaked-pw-67890")}`,
    });
    expect(again.status).toBe(403);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("registration_disabled");
  });

  test("GET /api/auth/register has no handler — a native GET submit can never create an account", async () => {
    const res = await nextRequest(
      `/api/auth/register?userId=${encodeURIComponent("native-leak@example.com")}&password=${encodeURIComponent("leaked-pw-12345")}`,
    );
    expect(res.status).toBe(405);
    expect(JSON.stringify(await res.json())).not.toContain("native-leak@example.com");
  });

  test("the JSON contract survives behind CO_NEWBIZ_ALLOW_REGISTER=1 — a deliberate re-enable still creates a pending account (capability kept testable, auth not weakened)", async () => {
    process.env.CO_NEWBIZ_ALLOW_REGISTER = "1";
    try {
      const res = await nextRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ userId: "register-harden-user@example.com", password: "pw-register-harden-123" }),
      });
      expect(res.status).toBe(201);
      expect(((await res.json()) as { data: { status: string } }).data.status).toBe("pending");
      expect(res.headers.getSetCookie().join(";")).not.toContain("co_newbiz_session=");
    } finally {
      delete process.env.CO_NEWBIZ_ALLOW_REGISTER;
    }
  });

  test("with the flag removed the endpoint is closed again — a re-enable is per-process state, not a sticky toggle", async () => {
    const res = await nextRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ userId: "closed-again@example.com", password: "pw-closed-again-123" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("registration_disabled");
  });
});

describe("POST /api/auth/password-change — the native-form fallback cannot change or leak", () => {
  test("a form-encoded native POST without a session is 401 (session-gated), echoes no credential, sets no session", async () => {
    const res = await nextRequest("/api/auth/password-change", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `currentPassword=${encodeURIComponent(PW_USER_PW)}&newPassword=${encodeURIComponent(PW_USER_NEW)}`,
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
    expect(res.headers.getSetCookie().join(";")).not.toContain("co_newbiz_session=");
  });

  test("a form-encoded native POST WITH a session is still 400 — the route only parses JSON, so no rotation happens", async () => {
    const login = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: PW_USER, password: PW_USER_PW }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    expect(cookie).toContain("co_newbiz_session=");
    const res = await nextRequest("/api/auth/password-change", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: `currentPassword=${encodeURIComponent(PW_USER_PW)}&newPassword=${encodeURIComponent(PW_USER_NEW)}`,
    });
    expect(res.status).toBe(400);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(PW_USER_PW);
    expect(body).not.toContain(PW_USER_NEW);
    // No session rotation for the refused submit — the pre-change session stays the only one.
    expect(res.headers.getSetCookie().join(";")).not.toContain("co_newbiz_session=");
  });

  test("GET /api/auth/password-change has no handler — credentials can never be accepted via the query string", async () => {
    const res = await nextRequest(
      `/api/auth/password-change?currentPassword=${encodeURIComponent(PW_USER_PW)}&newPassword=${encodeURIComponent(PW_USER_NEW)}`,
    );
    expect(res.status).toBe(405);
  });

  test("the JSON contract is intact — a real password change still succeeds and rotates the session (auth not weakened)", async () => {
    const login = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: PW_USER, password: PW_USER_PW }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    const res = await nextRequest("/api/auth/password-change", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ currentPassword: PW_USER_PW, newPassword: PW_USER_NEW }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { ok: boolean } }).data.ok).toBe(true);
    expect(res.headers.getSetCookie().join(";")).toContain("co_newbiz_session=");
    // The old password no longer authenticates — the change really took effect.
    const oldPw = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: PW_USER, password: PW_USER_PW }),
    });
    expect(oldPw.status).toBe(401);
    const newPw = await nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: PW_USER, password: PW_USER_NEW }),
    });
    expect(newPw.status).toBe(200);
  });
});
