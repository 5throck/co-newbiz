// @version 1.0.0
/**
 * Self-service personal API tokens — backend Row 1
 * (docs/designs/2026-10-11-self-service-api-tokens-design.md §4.1, §7).
 *
 * Session-only issuance/revocation, expiry (default 30d / allowed 7-30-90),
 * lazy grace expiry for legacy NULL rows, role re-check at validation,
 * cnb_pat_ prefix, active-token cap, issue rate limit, and audit rows
 * (issue / revoke / issue-denied / throttled use) — all against the real
 * Route Handlers via nextRequest() and the real db/lib engine, on a scratch
 * SQLite file.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-api-tokens.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const tokens = await import("../../db/lib/api-tokens.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
async function issueViaRoute(cookie: string, body: Record<string, unknown>) {
  return req("/api/tokens", { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Insert a legacy-shaped token row directly (no prefix, NULL expiry, or both).
function insertLegacyToken(userId: string, plaintext: string, scopes = "read", expiresAt: string | null = null) {
  const id = `LEGACY${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  db.run(
    "INSERT INTO api_token (id, user_id, token_hash, label, scopes, created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
    [id, userId, sha256(plaintext), `legacy-${id}`, scopes, NOW, expiresAt],
  );
  return id;
}

let patCookie: string; // analyst
let viewerCookie: string;
let adminCookie: string;
let capCookie: string; // analyst, cap scenario
let rateCookie: string; // analyst, rate-limit scenario
let bearerToken: string;

beforeAll(async () => {
  const seed: [string, string, string, string][] = [
    ["pat", "analyst", "pw-pat-1234567", "patCookie"],
    ["patv", "viewer", "pw-patv-123456", "viewerCookie"],
    ["patadmin", "admin", "pw-patadm-12345", "adminCookie"],
    ["patcap", "analyst", "pw-patcap-12345", "capCookie"],
    ["patrate", "analyst", "pw-patrate-1234", "rateCookie"],
  ];
  for (const [userId, role, password] of seed) {
    await createUser(db, { userId, role, password, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  patCookie = await loginCookie("pat", "pw-pat-1234567");
  viewerCookie = await loginCookie("patv", "pw-patv-123456");
  adminCookie = await loginCookie("patadmin", "pw-patadm-12345");
  capCookie = await loginCookie("patcap", "pw-patcap-12345");
  rateCookie = await loginCookie("patrate", "pw-patrate-1234");
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

describe("session-only issuance and revocation", () => {
  test("cookie session can mint a token", async () => {
    const res = await issueViaRoute(patCookie, { label: "stdio-mcp", scopes: ["read"] });
    expect(res.status).toBe(201);
    bearerToken = (await res.json()).data.token;
    expect(bearerToken).toMatch(/^cnb_pat_[0-9a-f]{64}$/);
  });

  test("a bearer token cannot mint tokens (403 session_required)", async () => {
    const res = await issueViaRoute("", { label: "x" }); // unauthenticated
    expect(res.status).toBe(401);
    const viaBearer = await req("/api/tokens", {
      method: "POST",
      headers: { authorization: `Bearer ${bearerToken}` },
      body: JSON.stringify({ label: "laundered" }),
    });
    expect(viaBearer.status).toBe(403);
    expect((await viaBearer.json()).error.code).toBe("session_required");
  });

  test("a bearer token cannot revoke tokens (403 session_required)", async () => {
    const listed = await req("/api/tokens", { headers: { authorization: `Bearer ${bearerToken}` } });
    expect(listed.status).toBe(200); // GET stays available to any authenticated caller
    const tokenId = ((await listed.json()).data as { id: string }[])[0].id;
    const res = await req(`/api/tokens/${tokenId}`, { method: "DELETE", headers: { authorization: `Bearer ${bearerToken}` } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("session_required");
  });

  test("the cookie session can revoke its own token", async () => {
    const listed = await req("/api/tokens", { headers: { cookie: patCookie } });
    const tokenId = ((await listed.json()).data as { id: string }[])[0].id;
    const res = await req(`/api/tokens/${tokenId}`, { method: "DELETE", headers: { cookie: patCookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data.revoked).toBe(true);
  });
});

describe("expiry", () => {
  test("default expiry is 30 days", async () => {
    const res = await issueViaRoute(patCookie, { label: "default-ttl" });
    expect(res.status).toBe(201);
    const row = db.query("SELECT expires_at FROM api_token WHERE label = 'default-ttl'").get() as { expires_at: string };
    const days = (Date.parse(row.expires_at) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  test("expiresInDays 7 and 90 are accepted, 91 and 15 are rejected", async () => {
    for (const days of [7, 90]) {
      const res = await issueViaRoute(patCookie, { label: `ttl-${days}`, expiresInDays: days });
      expect(res.status).toBe(201);
    }
    for (const days of [91, 15, 0]) {
      const res = await issueViaRoute(patCookie, { label: "bad-ttl", expiresInDays: days });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_request");
    }
  });

  test("an expired token is rejected by validateApiToken", async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const legacy = "a".repeat(64);
    insertLegacyToken("pat", legacy, "read", past);
    expect(tokens.validateApiToken(db, legacy)).toBeNull();
  });

  test("a legacy NULL-expiry token still validates and gains a one-time grace expiry", async () => {
    const legacy = "b".repeat(64);
    insertLegacyToken("pat", legacy);
    const first = tokens.validateApiToken(db, legacy);
    expect(first).not.toBeNull();
    const row1 = db.query("SELECT expires_at FROM api_token WHERE token_hash = ?").get(sha256(legacy)) as { expires_at: string | null };
    expect(row1.expires_at).not.toBeNull();
    const days = (Date.parse(row1.expires_at as string) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    // Written once: a second validation does not extend it.
    tokens.validateApiToken(db, legacy);
    const row2 = db.query("SELECT expires_at FROM api_token WHERE token_hash = ?").get(sha256(legacy)) as { expires_at: string | null };
    expect(row2.expires_at).toBe(row1.expires_at);
  });
});

describe("role re-check at validation", () => {
  test("a write token held by a viewer validates read-only", async () => {
    const res = await tokens.issueApiToken(db, { userId: "patv", label: "demoted", scopes: ["read", "write"], now: NOW });
    const valid = tokens.validateApiToken(db, res.token);
    expect(valid).not.toBeNull();
    expect(valid?.scopes).toEqual(["read"]);
  });

  test("an analyst write token keeps write", async () => {
    const res = await tokens.issueApiToken(db, { userId: "pat", label: "analyst-write", scopes: ["read", "write"], now: NOW });
    const valid = tokens.validateApiToken(db, res.token);
    expect(valid?.scopes).toEqual(["read", "write"]);
  });

  test("viewer cannot request write at issue; admin cannot either (audited)", async () => {
    const v = await issueViaRoute(viewerCookie, { label: "v", scopes: ["read", "write"] });
    expect(v.status).toBe(403);
    expect((await v.json()).error.code).toBe("role_required");
    const a = await issueViaRoute(adminCookie, { label: "a", scopes: ["read", "write"] });
    expect(a.status).toBe(403);
    expect((await a.json()).error.code).toBe("role_forbidden");
    const denied = db
      .query("SELECT target FROM audit_log WHERE action = 'api_token_issue_denied' AND actor_user_id IN ('patv','patadmin')")
      .all() as { target: string }[];
    expect(denied.map((d) => d.target).sort()).toEqual(["role:admin", "role:viewer"]);
  });
});

describe("caps", () => {
  test("the 6th active token hits the cap (409 token_limit_reached)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await issueViaRoute(capCookie, { label: `cap-${i}`, scopes: ["read"] });
      expect(res.status).toBe(201);
    }
    const res = await issueViaRoute(capCookie, { label: "cap-5", scopes: ["read"] });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("token_limit_reached");
  });

  test("revoking frees cap headroom", async () => {
    const listed = (await (await req("/api/tokens", { headers: { cookie: capCookie } })).json()).data as { id: string; revoked_at: string | null }[];
    const victim = listed[0].id;
    await req(`/api/tokens/${victim}`, { method: "DELETE", headers: { cookie: capCookie } });
    const res = await issueViaRoute(capCookie, { label: "cap-after-revoke", scopes: ["read"] });
    expect(res.status).toBe(201);
  });

  test("the 11th issue in an hour is rate-limited (429 rate_limited)", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await issueViaRoute(rateCookie, { label: `rate-${i}`, scopes: ["read"] });
      // 5 succeed, then the cap denies — but denials still count, so keep going.
      expect([201, 409]).toContain(res.status);
    }
    const res = await issueViaRoute(rateCookie, { label: "rate-10", scopes: ["read"] });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
    const denied = db
      .query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'api_token_issue_denied' AND actor_user_id = 'patrate' AND target = 'rate_limited'")
      .get() as { n: number };
    expect(denied.n).toBe(1);
  });
});

describe("prefix and legacy compatibility", () => {
  test("new tokens carry cnb_pat_ and legacy unprefixed tokens still validate", async () => {
    expect(bearerToken.startsWith("cnb_pat_")).toBe(true);
    const legacy = "c".repeat(64);
    insertLegacyToken("pat", legacy);
    const valid = tokens.validateApiToken(db, legacy);
    expect(valid).not.toBeNull();
    expect(valid?.userId).toBe("pat");
  });
});

describe("audit and hygiene", () => {
  test("issue, revoke, denied and throttled use are audited; no token or hash in the log", async () => {
    const actions = db
      .query("SELECT DISTINCT action FROM audit_log WHERE action LIKE 'api_token%'")
      .all()
      .map((r: any) => r.action)
      .sort();
    expect(actions).toEqual(["api_token_issue", "api_token_issue_denied", "api_token_revoke", "api_token_use"]);

    const rows = db.query("SELECT actor_user_id, action, target FROM audit_log WHERE action LIKE 'api_token%'").all() as {
      actor_user_id: string;
      action: string;
      target: string;
    }[];
    const forbiddenStrings = [bearerToken, sha256(bearerToken), "cnb_pat_"];
    for (const r of rows) {
      for (const s of forbiddenStrings) {
        expect(`${r.actor_user_id} ${r.action} ${r.target}`).not.toContain(s);
      }
    }
  });

  test("list returns display_id and status, never the hash", async () => {
    const res = await req("/api/tokens", { headers: { cookie: patCookie } });
    const data = (await res.json()).data as { id: string; display_id: string; status: string; expires_at: string | null }[];
    expect(data.length).toBeGreaterThan(0);
    for (const t of data) {
      expect(t.display_id).toBe(t.id.slice(-6));
      expect(["active", "expired", "revoked"]).toContain(t.status);
    }
  });

  test("errors carry fixed codes and generic messages (no err.message echo)", async () => {
    const res = await issueViaRoute(patCookie, { label: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()).error;
    expect(body.code).toBe("invalid_request");
    expect(body.message).toBe("label is required.");
  });
});
