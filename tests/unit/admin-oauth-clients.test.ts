// @version 1.0.0
/**
 * Admin START/STOP for connected OAuth clients (design
 * 2026-11-27-admin-oauth-client-stop-start). Exercises the real route
 * handlers against a migrated test DB: the stop→revoke cascade, the four
 * enforcement gates (G1 consent entry, G2 code redemption, G3 refresh at a
 * stopped client, G4 bearer validation), the admin routes' auth and 404/409
 * edge cases, audit completeness (exactly one row per accepted command,
 * zero for refusals), and the kill-switch latency criterion — a live MCP
 * call 401s within one request cycle of the stop.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-admin-oauth-clients.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
const ORIGIN = "http://localhost:7748";
process.env.CO_NEWBIZ_PUBLIC_ORIGIN = ORIGIN;
const RESOURCE = `${ORIGIN}/api/mcp`;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser, authenticate: login } = await import("../../db/lib/accounts.ts");
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");
const oauthLib = await import("../../db/lib/oauth.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const authorizeRoute = await import("../../app/web-next/app/api/oauth/authorize/route.ts");
const tokenRoute = await import("../../app/web-next/app/api/oauth/token/route.ts");
const mcpRoute = await import("../../app/web-next/app/api/mcp/route.ts");
const { resetMcpSessionsForTest } = await import("../../app/web-next/lib/mcp/http-server.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

const NOW = new Date().toISOString();
const NOW2 = new Date(Date.parse(NOW) + 1000).toISOString();
const REDIRECT = "http://127.0.0.1:33419/callback";
const PW: Record<string, string> = {
  root: "pw-root-12345",
  alice: "pw-alice-12345",
  bob: "pw-bob-123456",
  carol: "pw-carol-12345",
};
const sessions: Record<string, string> = {};
let alphaId: string;
let betaId: string;
// pre-stop live material, captured before the stops
const alphaTokens: Record<string, { access: string; refresh: string }> = {};
let betaPreStopCode: { code: string; verifier: string };
let personalToken: string;

beforeAll(async () => {
  for (const [userId, role] of [
    ["root", "admin"],
    ["alice", "analyst"],
    ["carol", "analyst"],
    ["bob", "viewer"],
  ] as const) {
    await createUser(db, { userId, role, password: PW[userId], createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const userId of Object.keys(PW)) {
    const r = await login(db, { userId, password: PW[userId], now: NOW });
    if (!r.ok) throw new Error(`login failed for ${userId}`);
    sessions[userId] = r.session.token;
  }
  const alpha = oauthLib.registerClient(db, {
    name: "Alpha",
    redirectUris: [REDIRECT],
    registeredByUserId: "alice",
    now: NOW,
  });
  if (!alpha.ok) throw new Error("alpha registration failed");
  alphaId = alpha.client.client_id;
  const beta = oauthLib.registerClient(db, {
    name: "Beta",
    redirectUris: [REDIRECT],
    registeredByUserId: "carol",
    now: NOW2,
  });
  if (!beta.ok) throw new Error("beta registration failed");
  betaId = beta.client.client_id;

  for (const userId of ["alice", "carol"]) alphaTokens[userId] = await issueTokens(userId, alphaId, "read write");
  await issueTokens("alice", betaId, "read"); // Beta's pre-stop family (revoked at the Beta stop)
  const { verifier, challenge } = pkce();
  betaPreStopCode = { code: await getCode("alice", betaId, "read", challenge), verifier };
  ({ token: personalToken } = issueApiToken(db, { userId: "alice", label: "personal", scopes: ["read"], now: NOW }));
});

afterAll(() => {
  resetMcpSessionsForTest();
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// ── helpers ─────────────────────────────────────────────────────────────

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function cookieHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    cookie: `co_newbiz_session=${sessions[userId]}; co_newbiz_csrf=csrf-test`,
    "x-csrf-token": "csrf-test",
  };
}

async function authorize(userId: string, clientId: string, scope: string, challenge: string): Promise<Response> {
  return authorizeRoute.POST(
    new Request(`${ORIGIN}/api/oauth/authorize`, {
      method: "POST",
      headers: cookieHeaders(userId),
      body: JSON.stringify({
        decision: "approve",
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        scope,
        state: "st-1",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: RESOURCE,
      }),
    }),
  );
}

async function getCode(userId: string, clientId: string, scope: string, challenge: string): Promise<string> {
  const res = await authorize(userId, clientId, scope, challenge);
  expect(res.status).toBe(200);
  const redirect = new URL(((await res.json()) as { data: { redirect_to: string } }).data.redirect_to);
  return redirect.searchParams.get("code") ?? "";
}

async function tokenCall(form: Record<string, string>): Promise<{ status: number; body: Record<string, string> }> {
  const res = await tokenRoute.POST(
    new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

async function issueTokens(userId: string, clientId: string, scope: string) {
  const { verifier, challenge } = pkce();
  const code = await getCode(userId, clientId, scope, challenge);
  const r = await tokenCall({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  expect(r.status).toBe(200);
  return { access: r.body.access_token, refresh: r.body.refresh_token };
}

async function consentGet(userId: string, clientId: string): Promise<Response> {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: "read",
    state: "st-1",
    code_challenge: pkce().challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  });
  return authorizeRoute.GET(new Request(`${ORIGIN}/api/oauth/authorize?${q}`, { headers: cookieHeaders(userId) }));
}

function mcpRequest(token: string): Request {
  return new Request(RESOURCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      Authorization: `Bearer ${token}`,
      Origin: ORIGIN,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

/** Hand-insert a live token row — simulates a token written outside the engine (the race G4/G3 exist to close). */
function handInsertToken(
  userId: string,
  clientId: string,
  familyId: string,
  kind: "oauth_access" | "oauth_refresh",
): string {
  const token = randomBytes(32).toString("base64url");
  const inOneHour = new Date(Date.parse(NOW) + 3600_000).toISOString();
  db.run(
    `INSERT INTO api_token (id, user_id, token_hash, label, scopes, created_at, kind, client_id, family_id, audience, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ulid(),
      userId,
      oauthLib.sha256Hex(token),
      `oauth:${clientId}`,
      "read",
      NOW,
      kind,
      clientId,
      familyId,
      RESOURCE,
      inOneHour,
    ],
  );
  return token;
}

function auditRows(action: string): Array<{ actor: string; target: Record<string, unknown> }> {
  return (
    db.query("SELECT actor_user_id, target FROM audit_log WHERE action = ? ORDER BY id").all(action) as Array<{
      actor_user_id: string;
      target: string;
    }>
  ).map((r) => ({ actor: r.actor_user_id, target: JSON.parse(r.target) as Record<string, unknown> }));
}

interface Envelope {
  data: Record<string, unknown> | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
}

function adminPut(userId: string, clientId: string, action: string): Promise<Response> {
  return nextRequest(`/api/admin/oauth-clients/${clientId}`, {
    method: "PUT",
    headers: cookieHeaders(userId),
    body: JSON.stringify({ action }),
  });
}

// ── fleet inventory ─────────────────────────────────────────────────────

describe("GET /api/admin/oauth-clients", () => {
  test("lists every client with counts; redirect_uris are a count, not contents", async () => {
    const res = await nextRequest("/api/admin/oauth-clients", { headers: cookieHeaders("root") });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { clients: Array<Record<string, unknown>> } };
    const clients = data?.clients ?? [];
    expect(clients.map((c) => c.client_id)).toEqual([betaId, alphaId]); // created_at DESC
    const alpha = clients.find((c) => c.client_id === alphaId) as Record<string, unknown>;
    expect(alpha.name).toBe("Alpha");
    expect(alpha.verified).toBe(false);
    expect(alpha.registered_by_user_id).toBe("alice");
    expect(alpha.stopped_at).toBeNull();
    expect(alpha.authorized_users).toBe(2);
    expect(alpha.live_tokens).toBe(4);
    expect(alpha.redirect_uri_count).toBe(1);
    expect(JSON.stringify(clients)).not.toContain(REDIRECT); // presence, not contents
    const beta = clients.find((c) => c.client_id === betaId) as Record<string, unknown>;
    expect(beta.authorized_users).toBe(1);
    expect(beta.live_tokens).toBe(2);
  });

  test("is admin-only: no session is 401, a viewer session is 403", async () => {
    expect((await nextRequest("/api/admin/oauth-clients")).status).toBe(401);
    expect((await nextRequest("/api/admin/oauth-clients", { headers: cookieHeaders("bob") })).status).toBe(403);
  });
});

// ── unknown client / bad action (before any stop) ───────────────────────

describe("PUT /api/admin/oauth-clients/[clientId] refusals", () => {
  test("unknown clientId is 404 for both actions and writes no audit row", async () => {
    const before = auditRows("oauth_app_stop").length + auditRows("oauth_app_start").length;
    const stop = await adminPut("root", "mcp_nosuchclient", "stop");
    expect(stop.status).toBe(404);
    expect(((await stop.json()) as Envelope).error?.code).toBe("not_found");
    const start = await adminPut("root", "mcp_nosuchclient", "start");
    expect(start.status).toBe(404);
    expect(auditRows("oauth_app_stop").length + auditRows("oauth_app_start").length).toBe(before);
  });

  test("a body without stop|start is 400 invalid_request", async () => {
    const res = await adminPut("root", alphaId, "restart");
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).error?.code).toBe("invalid_request");
  });

  test("non-admin mutation is 403", async () => {
    expect((await adminPut("bob", alphaId, "stop")).status).toBe(403);
  });
});

// ── kill switch: STOP Alpha (primary criterion 1) ────────────────────────

describe("stop: stamp + fleet-wide revoke + all four gates", () => {
  test("a live MCP call 401s within one request cycle of the stop; every live oauth token is revoked; personal tokens untouched", async () => {
    // everything is live right before the stop
    expect(oauthLib.validateAccessToken(db, alphaTokens.alice.access, RESOURCE, NOW)).not.toBeNull();
    const res = await adminPut("root", alphaId, "stop");
    expect(res.status).toBe(200);
    const body = ((await res.json()) as Envelope).data as { status: string; stopped_at: string; revoked: number };
    expect(body.status).toBe("stopped");
    expect(body.stopped_at).toBeTruthy();
    expect(body.revoked).toBe(4); // alice + carol, access + refresh each

    // G4 — same request cycle, no wait: the previously live token validates to null ...
    expect(oauthLib.validateAccessToken(db, alphaTokens.alice.access, RESOURCE, new Date().toISOString())).toBeNull();
    expect(oauthLib.validateAccessToken(db, alphaTokens.carol.access, RESOURCE, new Date().toISOString())).toBeNull();
    // ... and an in-flight-scoped MCP call with the old token gets the existing 401 + WWW-Authenticate path
    const mcp = await mcpRoute.POST(mcpRequest(alphaTokens.alice.access));
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("www-authenticate")).toContain("resource_metadata=");
    // personal tokens are out of the blast radius entirely
    const personal = db
      .query("SELECT revoked_at FROM api_token WHERE token_hash = ?")
      .get(oauthLib.sha256Hex(personalToken)) as {
      revoked_at: string | null;
    };
    expect(personal.revoked_at).toBeNull();
  });

  test("G1: consent entry answers client_stopped locally, never as a redirect", async () => {
    const get = await consentGet("alice", alphaId);
    expect(get.status).toBe(400);
    const getBody = (await get.json()) as Envelope;
    expect(getBody.error?.code).toBe("client_stopped");
    expect(JSON.stringify(getBody)).not.toContain("redirect_to");
    const post = await authorize("alice", alphaId, "read", pkce().challenge);
    expect(post.status).toBe(400);
    expect(((await post.json()) as Envelope).error?.code).toBe("client_stopped");
  });

  test("audit: exactly one oauth_app_stop row with {client_id, revoked} and the admin actor", () => {
    const rows = auditRows("oauth_app_stop");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("root");
    expect(rows[0].target).toEqual({ client_id: alphaId, revoked: 4 });
  });

  test("double-stop is 409 oauth_client_already_stopped with the current stamp; no re-revoke, no second audit row", async () => {
    const res = await adminPut("root", alphaId, "stop");
    expect(res.status).toBe(409);
    const err = ((await res.json()) as Envelope).error;
    expect(err?.code).toBe("oauth_client_already_stopped");
    expect(typeof err?.details?.stopped_at).toBe("string");
    expect(auditRows("oauth_app_stop")).toHaveLength(1); // refusal wrote nothing
  });
});

// ── STOP Beta: issuance refusal (G2/G3) ─────────────────────────────────

describe("stopped client refuses token issuance", () => {
  test("stop Beta audits once and reports its own revoke count", async () => {
    const res = await adminPut("root", betaId, "stop");
    expect(res.status).toBe(200);
    const body = ((await res.json()) as Envelope).data as { revoked: number };
    expect(body.revoked).toBe(2); // alice's beta access + refresh
    expect(auditRows("oauth_app_stop")).toHaveLength(2); // alpha + beta, one row each
  });

  test("G2: an outstanding pre-stop code cannot be redeemed (unauthorized_client)", async () => {
    const r = await tokenCall({
      grant_type: "authorization_code",
      code: betaPreStopCode.code,
      client_id: betaId,
      redirect_uri: REDIRECT,
      code_verifier: betaPreStopCode.verifier,
      resource: RESOURCE,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("unauthorized_client");
    expect(r.body.error_description).toBe("client is stopped by an administrator.");
  });

  test("G3: a refresh token that survived the revoke (race / out-of-engine write) is rejected and its family revoked", async () => {
    // simulate the missed revoke: a LIVE refresh+access pair for the stopped client
    const familyId = ulid();
    const liveAccess = handInsertToken("carol", betaId, familyId, "oauth_access");
    const liveRefresh = handInsertToken("carol", betaId, familyId, "oauth_refresh");
    const revokedAt = (hash: string) =>
      (db.query("SELECT revoked_at FROM api_token WHERE token_hash = ?").get(hash) as { revoked_at: string | null })
        .revoked_at;
    expect(revokedAt(oauthLib.sha256Hex(liveAccess))).toBeNull(); // live in the DB (G4's JOIN still refuses to validate it — the client is stopped)

    const r = await tokenCall({
      grant_type: "refresh_token",
      refresh_token: liveRefresh,
      client_id: betaId,
      resource: RESOURCE,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("unauthorized_client");
    // G3 revoked the presented family, as reuse detection does
    expect(revokedAt(oauthLib.sha256Hex(liveAccess))).not.toBeNull();
    expect(revokedAt(oauthLib.sha256Hex(liveRefresh))).not.toBeNull();
    const rows = auditRows("oauth_refresh_stopped_client_family_revoked");
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toEqual({ client_id: betaId, family_id: familyId, revoked: 2 });
  });
});

// ── START Alpha ─────────────────────────────────────────────────────────

describe("start: re-opens the door without resurrecting keys", () => {
  test("start clears stopped_at, answers users_must_reconnect, audits exactly once", async () => {
    const res = await adminPut("root", alphaId, "start");
    expect(res.status).toBe(200);
    const body = ((await res.json()) as Envelope).data as { status: string; users_must_reconnect: boolean };
    expect(body.status).toBe("operating");
    expect(body.users_must_reconnect).toBe(true);
    const row = db.query("SELECT stopped_at FROM oauth_client WHERE client_id = ?").get(alphaId) as {
      stopped_at: string | null;
    };
    expect(row.stopped_at).toBeNull();
    const rows = auditRows("oauth_app_start");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("root");
    expect(rows[0].target).toEqual({ client_id: alphaId });
  });

  test("tokens are NOT restored: the old grant stays dead; the inventory shows 0/0; consent entry works again", async () => {
    expect(oauthLib.validateAccessToken(db, alphaTokens.alice.access, RESOURCE, new Date().toISOString())).toBeNull();
    const res = await nextRequest("/api/admin/oauth-clients", { headers: cookieHeaders("root") });
    const clients = ((await res.json()) as { data: { clients: Array<Record<string, unknown>> } }).data.clients;
    const alpha = clients.find((c) => c.client_id === alphaId) as Record<string, unknown>;
    expect(alpha.stopped_at).toBeNull();
    expect(alpha.authorized_users).toBe(0);
    expect(alpha.live_tokens).toBe(0);
    const get = await consentGet("alice", alphaId);
    expect(get.status).toBe(200);
    expect(((await get.json()) as Envelope).data?.valid).toBe(true);
  });

  test("start-on-active is 409 oauth_client_already_running; no audit row", async () => {
    const res = await adminPut("root", alphaId, "start");
    expect(res.status).toBe(409);
    expect(((await res.json()) as Envelope).error?.code).toBe("oauth_client_already_running");
    expect(auditRows("oauth_app_start")).toHaveLength(1);
  });
});
