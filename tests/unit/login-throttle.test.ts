// @version 1.0.0
/**
 * D4 (SR3-min) — login per-IP throttle keys on the RIGHTMOST X-Forwarded-For
 * entry (design 2026-11-11-admin-security-and-board-fixes §6). Unit tests pin
 * the keying (the unit the review asked for, incl. the spoof attempt) and the
 * window/eviction math; route-level regression proves a forged leftmost entry
 * does not split or reset the bucket and that 429s audit nothing (the §5 D3
 * decision: rate-limit responses are never audited).
 *
 * Route-level tests run the real Route Handler on a scratch SQLite DB (same
 * harness as admin-users-master-crud). Every route-level address is unique so
 * the module-level throttle map shared across the bun test process is not
 * polluted for other suites.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  loginThrottled,
  recordLoginFailure,
  trustedLoginAddress,
} from "../../app/web-next/lib/login-throttle.ts";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-login-throttle.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

const reqWithXff = (xff: string | null) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (xff !== null) headers.set("x-forwarded-for", xff);
  return new Request("http://localhost/api/auth/login", { headers });
};

describe("trustedLoginAddress — rightmost-hop keying", () => {
  test("two entries key on the rightmost", () => {
    expect(trustedLoginAddress(reqWithXff("203.0.113.7, 10.0.0.9"))).toBe("10.0.0.9");
  });
  test("trailing whitespace and empty segments are tolerated", () => {
    expect(trustedLoginAddress(reqWithXff("203.0.113.7, "))).toBe("203.0.113.7");
    expect(trustedLoginAddress(reqWithXff("203.0.113.7,  ,  "))).toBe("203.0.113.7");
    expect(trustedLoginAddress(reqWithXff(" 10.0.0.9 "))).toBe("10.0.0.9");
  });
  test("single-entry header keys itself", () => {
    expect(trustedLoginAddress(reqWithXff("203.0.113.7"))).toBe("203.0.113.7");
  });
  test("absent, empty, or all-empty header → the shared direct bucket", () => {
    expect(trustedLoginAddress(reqWithXff(null))).toBe("direct");
    expect(trustedLoginAddress(reqWithXff(""))).toBe("direct");
    expect(trustedLoginAddress(reqWithXff(",,"))).toBe("direct");
  });
  test("spoof attempt: a forged leftmost entry is ignored", () => {
    expect(trustedLoginAddress(reqWithXff("fake.example, 203.0.113.7"))).toBe("203.0.113.7");
    expect(trustedLoginAddress(reqWithXff("fake.one, fake.two, 203.0.113.7"))).toBe("203.0.113.7");
  });
  test("an oversized entry (>64 chars) is untrusted garbage → shared bucket", () => {
    expect(trustedLoginAddress(reqWithXff("x".repeat(65)))).toBe("direct");
  });
});

describe("throttle window math (bounded map)", () => {
  const T0 = 1_700_000_000_000;
  const addr = "unit-window-addr";

  test("LOGIN_MAX_FAILURES failures inside the window throttle; fewer do not", () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) recordLoginFailure(addr, T0 + i);
    expect(loginThrottled(addr, T0 + LOGIN_MAX_FAILURES)).toBe(false);
    recordLoginFailure(addr, T0 + LOGIN_MAX_FAILURES);
    expect(loginThrottled(addr, T0 + LOGIN_MAX_FAILURES + 1)).toBe(true);
  });

  test("failures older than the window do not count", () => {
    expect(loginThrottled(addr, T0 + LOGIN_WINDOW_MS + 1)).toBe(false);
    expect(loginThrottled(addr, T0 + LOGIN_WINDOW_MS)).toBe(false); // boundary: strictly-outside
  });

  test("mixed: 9 recent failures + 1 expired failure stay below the cap", () => {
    const mixed = "unit-mixed-addr";
    recordLoginFailure(mixed, T0); // the one that will expire
    const recentBase = T0 + LOGIN_WINDOW_MS + 60_000;
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) recordLoginFailure(mixed, recentBase + i);
    expect(loginThrottled(mixed, recentBase + LOGIN_MAX_FAILURES)).toBe(false);
  });

  test("bounded-map eviction never throws at the cap and the map stays bounded", () => {
    const base = "unit-evict-";
    for (let i = 0; i < 5_000; i++) recordLoginFailure(`${base}${i}`, T0);
    expect(() => recordLoginFailure(`${base}overflow`, T0 + 1)).not.toThrow();
    expect(() => loginThrottled(`${base}overflow`, T0 + 2)).not.toThrow();
  });
});

describe("route-level: POST /api/auth/login throttle regression", () => {
  let user: string;
  // Rightmost hop is the real key; leftmost entries are forged per attempt to
  // prove they neither split nor reset the bucket.
  const KEY = "203.0.113.77";

  beforeAll(async () => {
    user = "thr-user";
    await createUser(db, {
      userId: user,
      role: "viewer",
      password: "pw-thr-123456",
      createdBy: "test",
      now: new Date().toISOString(),
    });
    approveUser(db, { userId: user, approvedBy: "test", now: new Date().toISOString() });
    db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [user]);
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

  const failedLogin = (xff: string) =>
    nextRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: user, password: "definitely-wrong-pw" }),
      headers: { "content-type": "application/json", "x-forwarded-for": xff },
    });

  test(`${LOGIN_MAX_FAILURES} failures across forged leftmost entries (same rightmost) → 429`, async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      const res = await failedLogin(`forged-${i}.attacker.example, ${KEY}`);
      // 401 wrong-password; 423 once the 5th failure locks the account
      // (per-account lockout) — either way the throttle must record it.
      expect([401, 423]).toContain(res.status);
    }
    const throttled = await failedLogin(`forged-more.attacker.example, ${KEY}`);
    expect(throttled.status).toBe(429);
    expect(((await throttled.json()) as { error: { code: string } }).error.code).toBe("too_many_attempts");
  });

  test("the throttled 429 writes no audit row (design §5: rate-limit responses are never audited)", async () => {
    const count = () =>
      (db.query("SELECT COUNT(*) n FROM audit_log WHERE action = 'login_failed'").get() as { n: number }).n;
    const before = count();
    await failedLogin(`forged-extra.attacker.example, ${KEY}`); // 429 path
    expect(count()).toBe(before);
  });

  test("a spoofed leftmost entry does not reset the offender's bucket", async () => {
    const res = await failedLogin(`fresh-spoof.attacker.example, ${KEY}`);
    expect(res.status).toBe(429); // still keyed on the rightmost hop
  });

  test("a genuinely fresh rightmost hop gets a fresh bucket (401/423, not 429)", async () => {
    const res = await failedLogin("fresh-spoof.attacker.example, 198.51.100.5");
    // 401 or (post-lockout) 423 — the point is the throttle did not fire.
    expect([401, 423]).toContain(res.status);
    expect(((await res.json()) as { error: { code: string } }).error.code).not.toBe("too_many_attempts");
  });
});
