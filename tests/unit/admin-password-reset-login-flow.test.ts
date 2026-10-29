// @version 1.0.0
/**
 * End-to-end admin password reset -> temp-password login -> forced change
 * -> new-password login, through the real Route Handlers with the browser's
 * CSRF double-submit. Also pins the earlier-temp-password invalidation and
 * the UI userAction() guard (a delete click must never fall into reset).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-admin-pw-reset-flow.sqlite");
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
const HOST = "localhost:7748";

/** Collapse Set-Cookie headers into a browser-style Cookie header + csrf token. */
function jar(res: Response, prior: Record<string, string> = {}) {
  const c = { ...prior };
  for (const line of res.headers.getSetCookie()) {
    const [kv] = line.split(";");
    const i = kv.indexOf("=");
    c[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return c;
}
const cookieHeader = (c: Record<string, string>) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join("; ");
const browserHeaders = (c: Record<string, string>) => ({
  cookie: cookieHeader(c),
  "x-csrf-token": c["co_newbiz_csrf"] ?? "",
  origin: `http://${HOST}`,
  host: HOST,
  "content-type": "application/json",
});
// The login route throttles failures per x-forwarded-for in a module-level map
// shared by every test file in the bun process; a unique address per request
// keeps this file's deliberate failures from throttling unrelated suites.
let addr = 0;
const login = (userId: string, password: string) =>
  nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }), headers: { host: HOST, origin: `http://${HOST}`, "content-type": "application/json", "x-forwarded-for": `10.99.${Math.floor(addr / 250)}.${(addr++ % 250) + 1}` } });

let admin: Record<string, string>;

beforeAll(async () => {
  await createUser(db, { userId: "root", role: "admin", password: "pw-root-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "root", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = 'root'");
  await createUser(db, { userId: "wan8028", role: "analyst", password: "pw-initial-1234", createdBy: "test", now: NOW });
  approveUser(db, { userId: "wan8028", approvedBy: "test", now: NOW });
  admin = jar(await login("root", "pw-root-12345"));
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

async function reset(userId: string): Promise<string> {
  const res = await nextRequest(`/api/admin/users/${userId}`, { method: "PUT", body: JSON.stringify({ action: "reset_password" }), headers: browserHeaders(admin) });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { temporary_password: string; must_change_password: boolean } };
  expect(body.data.must_change_password).toBe(true);
  return body.data.temporary_password;
}

describe("admin reset_password -> login -> forced change", () => {
  test("full browser-style flow works with the exact issued temp password", async () => {
    const temp = await reset("wan8028");
    expect(temp).toMatch(/^tmp-[a-z0-9]{8}!A$/);

    const res = await login("wan8028", temp);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { mustChangePassword: boolean; userId: string } };
    expect(body.data.mustChangePassword).toBe(true);
    const user = jar(res);
    expect(user["co_newbiz_session"]).toBeTruthy();
    expect(user["co_newbiz_csrf"]).toBeTruthy();

    // /me works for the must-change session (AppShell redirects on this flag), other APIs are gated.
    const me = await nextRequest("/api/auth/me", { headers: { cookie: cookieHeader(user) } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { data: { mustChangePassword: boolean } }).data.mustChangePassword).toBe(true);
    const gated = await nextRequest("/api/opportunities", { headers: { cookie: cookieHeader(user) } });
    expect(gated.status).toBe(403);

    // password-change with current = temp, over CSRF + origin like the page does.
    const change = await nextRequest("/api/auth/password-change", {
      method: "POST",
      body: JSON.stringify({ currentPassword: temp, newPassword: "NewPass-98765" }),
      headers: browserHeaders(user),
    });
    expect(change.status).toBe(200);
    const after = jar(change, user);

    // The old (pre-change) session is revoked; the fresh one is clear of must-change.
    const me2 = await nextRequest("/api/auth/me", { headers: { cookie: cookieHeader(after) } });
    expect(((await me2.json()) as { data: { mustChangePassword: boolean } }).data.mustChangePassword).toBe(false);

    expect((await login("wan8028", "NewPass-98765")).status).toBe(200);
    expect((await login("wan8028", temp)).status).toBe(401);
  });

  test("only the latest temp password is valid after repeated resets", async () => {
    const first = await reset("wan8028");
    const second = await reset("wan8028");
    const third = await reset("wan8028");
    expect(new Set([first, second, third]).size).toBe(3);
    expect((await login("wan8028", first)).status).toBe(401);
    expect((await login("wan8028", second)).status).toBe(401);
    expect((await login("wan8028", third)).status).toBe(200);
  });

  test("a reset revokes the session of the user, and failed attempts are cleared", async () => {
    const t1 = await reset("wan8028");
    const sess = jar(await login("wan8028", t1));
    await login("wan8028", "wrong-password-1");
    const t2 = await reset("wan8028");
    const me = await nextRequest("/api/auth/me", { headers: { cookie: cookieHeader(sess) } });
    expect(me.status).toBe(401);
    expect((db.query("SELECT failed_attempts FROM app_user WHERE user_id='wan8028'").get() as { failed_attempts: number }).failed_attempts).toBe(0);
    expect((await login("wan8028", t2)).status).toBe(200);
  });

  test("unknown user id (typo such as a leading letter) never touches any account counter", async () => {
    const t = await reset("wan8028");
    const res = await login("dwan8028", t);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_credentials");
    expect((db.query("SELECT failed_attempts FROM app_user WHERE user_id='wan8028'").get() as { failed_attempts: number }).failed_attempts).toBe(0);
    // user id is matched exactly: no trimming/case folding on the server.
    expect((await login("WAN8028", t)).status).toBe(401); // case-sensitive by design
  });
});

describe("login user-id normalization", () => {
  test("surrounding whitespace on the id is trimmed; the password is not", async () => {
    const t = await reset("wan8028");
    const padded = await login("  wan8028 \t", t);
    expect(padded.status).toBe(200);
    expect(((await padded.json()) as { data: { userId: string } }).data.userId).toBe("wan8028");
    // A password with trailing space is a different password.
    expect((await login("wan8028", `${t} `)).status).toBe(401);
    expect((await login("wan8028", ` ${t}`)).status).toBe(401);
    expect((await login("   ", t)).status).toBe(400);
  });
  test("createUser stores the trimmed id", async () => {
    await createUser(db, { userId: "  padded1  ", role: "viewer", password: "pw-padded-1234", createdBy: "test", now: NOW });
    expect(db.query("SELECT user_id FROM app_user WHERE user_id = 'padded1'").get()).toBeTruthy();
    expect(db.query("SELECT 1 FROM app_user WHERE user_id != trim(user_id)").get()).toBeNull();
  });
});

describe("admin console UI guards (source pins)", () => {
  const actions = readFileSync(join(PROJECT_ROOT, "app/web-next/components/admin/console/useAdminActions.ts"), "utf8");
  test("userAction only enters the delete branch for action === 'delete'", () => {
    const fn = actions.slice(actions.indexOf("function userAction"), actions.indexOf("async function resetPassword"));
    expect(fn).toContain('if (action === "delete")');
    expect(fn).not.toContain("archive_then_delete");
  });
  test("reset is single-flight and the button is disabled while in flight", () => {
    expect(actions).toContain("if (resettingUser) return;");
    const section = readFileSync(join(PROJECT_ROOT, "app/web-next/components/admin/console/UsersSection.tsx"), "utf8");
    expect(section).toContain("disabled={resettingUser !== null}");
  });
});
