// @version 1.0.0
/**
 * D5 (B-2) — rsc-session: the Server Component session gate
 * (design 2026-11-11-admin-security-and-board-fixes §7).
 *
 * The server pages cannot read a Request object, so the session cookie comes
 * from next/headers' cookies() and the token is resolved with
 * db/lib/accounts.ts's validateSession UNCHANGED. The cookie-store seam
 * (sessionFromCookieStore) is the injectable unit surface; these tests pin
 * the four outcomes the flat shells rely on: absent cookie, unknown token,
 * expired token and a valid token (→ the full ValidSession). Read-only: the
 * module must never write (no audit rows, no session mutation) — asserted
 * below over the audit_log/session tables.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-rsc-session.sqlite";
const NOW = "2026-11-11T00:00:00Z";
// CO_NEWBIZ_DB_PATH must be set BEFORE the db client module loads.
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { createUser, approveUser, issueSession, revokeSessions } = await import("../../db/lib/accounts.ts");
const { sessionFromCookieStore } = await import("../../app/web-next/lib/rsc-session.ts");
const { SESSION_COOKIE } = await import("../../app/web-next/lib/auth.ts");

type Db = ReturnType<typeof getDb>;
let db: Db;

const store = (cookie?: string) => ({
  get: (name: string) => (name === SESSION_COOKIE && cookie !== undefined ? { value: cookie } : undefined),
});

beforeAll(() => {
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
}, 60000);

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("sessionFromCookieStore", () => {
  test("absent cookie → null (the page renders its picker fallback, never throws)", () => {
    expect(sessionFromCookieStore(store())).toBeNull();
    expect(sessionFromCookieStore(store(undefined))).toBeNull();
  });

  test("unknown token → null", () => {
    expect(sessionFromCookieStore(store("deadbeef"))).toBeNull();
  });

  test("valid token → the full ValidSession (userId, role, sessionId)", async () => {
    const userId = "rsc-user";
    await createUser(db, { userId, role: "analyst", password: "pw-rsc-123456", createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [userId]);
    const issued = issueSession(db, { userId, now: NOW });
    const session = sessionFromCookieStore(store(issued.token));
    expect(session).not.toBeNull();
    expect(session?.userId).toBe(userId);
    expect(session?.role).toBe("analyst");
    expect(session?.sessionId).toBe(issued.sessionId);
    expect(session?.mustChangePassword).toBe(false);
  });

  test("expired token → null (session window validated at read time)", () => {
    const userId = "rsc-expired";
    db.run(
      "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), userId, "viewer", "active", "salt", "hash", 1, NOW],
    );
    const staleToken = "stale-token";
    const staleHash = createHash("sha256").update(staleToken).digest("hex");
    db.run("INSERT INTO session (id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)", [
      ulid(),
      userId,
      staleHash,
      "2020-01-01T00:00:00Z",
      "2020-01-16T00:00:00Z",
    ]);
    expect(sessionFromCookieStore(store(staleToken))).toBeNull();
  });

  test("revoked session → null", async () => {
    const userId = "rsc-revoked";
    await createUser(db, { userId, role: "viewer", password: "pw-rsc-987654", createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
    const issued = issueSession(db, { userId, now: NOW });
    revokeSessions(db, { userId, now: NOW });
    expect(sessionFromCookieStore(store(issued.token))).toBeNull();
  });

  test("disabled account → null even with a live session row", async () => {
    const userId = "rsc-disabled";
    await createUser(db, { userId, role: "viewer", password: "pw-rsc-555555", createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
    const issued = issueSession(db, { userId, now: NOW });
    db.run("UPDATE app_user SET status = 'disabled' WHERE user_id = ?", [userId]);
    expect(sessionFromCookieStore(store(issued.token))).toBeNull();
  });

  test("read-only: resolution writes no audit rows and mutates no session rows", async () => {
    const auditBefore = (db.query("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
    const sessionBefore = (
      db.query("SELECT id, token_hash, revoked_at, expires_at FROM session ORDER BY created_at").all() as unknown[]
    ).length;
    sessionFromCookieStore(store("another-guess"));
    const auditAfter = (db.query("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
    const sessionAfter = (
      db.query("SELECT id, token_hash, revoked_at, expires_at FROM session ORDER BY created_at").all() as unknown[]
    ).length;
    expect(auditAfter).toBe(auditBefore);
    expect(sessionAfter).toBe(sessionBefore);
  });
});
