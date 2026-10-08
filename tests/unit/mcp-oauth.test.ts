// @version 1.0.0
/**
 * Wave M PR M-1 (ADR-0154) — remote MCP transport + OAuth 2.1 authorization
 * server. Exercises the real route handlers (OAuth endpoints, /api/mcp) and
 * the real SDK Streamable HTTP transport against a migrated test DB:
 * PKCE, audience binding, refresh rotation + reuse detection, per-tool scope
 * enforcement, no machine principals, Origin allowlist, the unchanged stdio
 * catalog, and connected-app revocation.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RestPort } from "../../mcp/co-newbiz/shared/rest-port.ts";
import type { Envelope } from "../../mcp/co-newbiz/shared/rest-client.ts";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-mcp-oauth.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
const ORIGIN = "http://localhost:7749";
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
const registerRoute = await import("../../app/web-next/app/api/oauth/register/route.ts");
const authorizeRoute = await import("../../app/web-next/app/api/oauth/authorize/route.ts");
const tokenRoute = await import("../../app/web-next/app/api/oauth/token/route.ts");
const revokeRoute = await import("../../app/web-next/app/api/oauth/revoke/route.ts");
const appsRoute = await import("../../app/web-next/app/api/oauth/apps/route.ts");
const appRoute = await import("../../app/web-next/app/api/oauth/apps/[clientId]/route.ts");
const mcpRoute = await import("../../app/web-next/app/api/mcp/route.ts");
const asMetaRoute = await import("../../app/web-next/app/.well-known/oauth-authorization-server/route.ts");
const prMetaRoute = await import("../../app/web-next/app/.well-known/oauth-protected-resource/[[...path]]/route.ts");
const { authenticate: restAuthenticate } = await import("../../app/web-next/lib/auth.ts");
const { matchRoute } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const { resetMcpSessionsForTest } = await import("../../app/web-next/lib/mcp/http-server.ts");

const NOW = new Date().toISOString();
const REDIRECT = "http://127.0.0.1:33418/callback";
const sessions: Record<string, string> = {};
let clientId: string;

beforeAll(async () => {
  for (const [userId, role] of [["alice", "analyst"], ["bob", "viewer"], ["carol", "analyst"]] as const) {
    await createUser(db, { userId, role, password: `pw-${userId}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const userId of ["alice", "bob", "carol"]) {
    const r = await login(db, { userId, password: `pw-${userId}-12345`, now: NOW });
    if (!r.ok) throw new Error(`login failed for ${userId}`);
    sessions[userId] = r.session.token;
  }
  const reg = await registerRoute.POST(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Test Connector", redirect_uris: [REDIRECT] }),
    }),
  );
  expect(reg.status).toBe(201);
  clientId = ((await reg.json()) as { client_id: string }).client_id;
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

async function authorize(userId: string, scope: string, challenge: string, extra: Record<string, string> = {}): Promise<Response> {
  return authorizeRoute.POST(
    new Request(`${ORIGIN}/api/oauth/authorize`, {
      method: "POST",
      headers: cookieHeaders(userId),
      body: JSON.stringify({
        decision: "approve", response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope, state: "st-1",
        code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE, ...extra,
      }),
    }),
  );
}

async function getCode(userId: string, scope: string, challenge: string): Promise<string> {
  const res = await authorize(userId, scope, challenge);
  expect(res.status).toBe(200);
  const redirect = new URL(((await res.json()) as { data: { redirect_to: string } }).data.redirect_to);
  expect(redirect.searchParams.get("state")).toBe("st-1");
  expect(redirect.searchParams.get("iss")).toBe(ORIGIN);
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

async function issueTokens(userId: string, scope: string) {
  const { verifier, challenge } = pkce();
  const code = await getCode(userId, scope, challenge);
  const r = await tokenCall({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier, resource: RESOURCE });
  expect(r.status).toBe(200);
  return { access: r.body.access_token, refresh: r.body.refresh_token, body: r.body };
}

let rpcId = 0;
function mcpRequest(token: string | null, body: unknown, opts: { sessionId?: string; origin?: string; method?: string } = {}): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.sessionId) headers["Mcp-Session-Id"] = opts.sessionId;
  if (opts.origin) headers.Origin = opts.origin;
  const method = opts.method ?? "POST";
  return new Request(RESOURCE, { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined });
}

async function readRpc(res: Response): Promise<{ result?: Record<string, unknown>; error?: { message: string } }> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data: ") && l.length > 6);
    return JSON.parse((line ?? "data: {}").slice(6));
  }
  return JSON.parse(text);
}

async function openSession(token: string): Promise<string> {
  const res = await mcpRoute.POST(
    mcpRequest(token, {
      jsonrpc: "2.0", id: ++rpcId, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    }),
  );
  expect(res.status).toBe(200);
  const sid = res.headers.get("mcp-session-id");
  await readRpc(res);
  expect(sid).toBeTruthy();
  const ack = await mcpRoute.POST(mcpRequest(token, { jsonrpc: "2.0", method: "notifications/initialized" }, { sessionId: sid ?? "" }));
  expect(ack.status).toBe(202);
  return sid ?? "";
}

async function rpc(token: string, sessionId: string, method: string, params: unknown) {
  const res = await mcpRoute.POST(mcpRequest(token, { jsonrpc: "2.0", id: ++rpcId, method, params }, { sessionId }));
  return { status: res.status, body: res.status === 200 ? await readRpc(res) : null };
}

function toolText(r: { body: { result?: Record<string, unknown> } | null }): { isError: boolean; text: string } {
  const result = r.body?.result as { content: Array<{ text: string }>; isError?: boolean };
  return { isError: result.isError === true, text: result.content[0].text };
}

// ── metadata ────────────────────────────────────────────────────────────

describe("RFC 8414 / RFC 9728 metadata", () => {
  test("authorization-server metadata advertises S256 only and no client_credentials", async () => {
    const meta = (await (await asMetaRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json()) as Record<string, string[] | string>;
    expect(meta.issuer).toBe(ORIGIN);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(meta.registration_endpoint).toBe(`${ORIGIN}/api/oauth/register`);
  });

  test("protected-resource metadata names /api/mcp at both well-known paths", async () => {
    for (const path of [[], ["api", "mcp"]]) {
      const res = await prMetaRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`), { params: Promise.resolve({ path }) });
      const meta = (await res.json()) as { resource: string; authorization_servers: string[] };
      expect(meta.resource).toBe(RESOURCE);
      expect(meta.authorization_servers).toEqual([ORIGIN]);
    }
  });

  test("unauthenticated /api/mcp gets 401 pointing at the resource metadata", async () => {
    const res = await mcpRoute.POST(mcpRequest(null, { jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
  });
});

// ── PKCE ────────────────────────────────────────────────────────────────

describe("authorization code + PKCE (S256)", () => {
  test("the right verifier yields a 15-minute access token and a refresh token", async () => {
    const { body } = await issueTokens("alice", "read write");
    expect(body.token_type).toBe("Bearer");
    expect(Number(body.expires_in)).toBe(900);
    expect(body.scope).toBe("read write");
    expect(body.refresh_token.length).toBeGreaterThan(20);
  });

  test("a wrong verifier is rejected and burns the code", async () => {
    const { verifier, challenge } = pkce();
    const code = await getCode("alice", "read", challenge);
    const bad = await tokenCall({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: pkce().verifier });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_grant");
    const retry = await tokenCall({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
    expect(retry.body.error).toBe("invalid_grant");
  });

  test("an authorization request without S256 PKCE is refused", async () => {
    const res = await authorize("alice", "read", "", { code_challenge_method: "plain" });
    expect(res.status).toBe(400);
  });

  test("a replayed code revokes the tokens it produced", async () => {
    const { verifier, challenge } = pkce();
    const code = await getCode("alice", "read", challenge);
    const form = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier };
    const first = await tokenCall(form);
    expect(first.status).toBe(200);
    expect((await tokenCall(form)).body.error).toBe("invalid_grant");
    expect(oauthLib.validateAccessToken(db, first.body.access_token, RESOURCE, new Date().toISOString())).toBeNull();
  });

  test("an unregistered redirect_uri is never redirected to", async () => {
    const res = await authorize("alice", "read", pkce().challenge, { redirect_uri: "https://evil.example/cb" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("evil.example");
  });
});

// ── audience ────────────────────────────────────────────────────────────

describe("RFC 8707 audience binding", () => {
  test("a token for another resource is rejected by /api/mcp", async () => {
    const { access } = await issueTokens("alice", "read");
    process.env.CO_NEWBIZ_PUBLIC_ORIGIN = "https://other.example";
    try {
      const res = await mcpRoute.POST(mcpRequest(access, { jsonrpc: "2.0", id: 1, method: "tools/list" }));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    } finally {
      process.env.CO_NEWBIZ_PUBLIC_ORIGIN = ORIGIN;
    }
  });

  test("a code requested for a different resource is refused", async () => {
    const res = await authorize("alice", "read", pkce().challenge, { resource: "https://other.example/api/mcp" });
    expect(res.status).toBe(400);
  });

  test("an OAuth access token is not accepted by the general REST API", async () => {
    const { access } = await issueTokens("alice", "read");
    const auth = restAuthenticate(new Request(`${ORIGIN}/api/notifications`, { headers: { Authorization: `Bearer ${access}` } }));
    expect(auth.ok).toBe(false);
  });

  test("a personal API token is not accepted by /api/mcp", async () => {
    const { token } = issueApiToken(db, { userId: "alice", label: "stdio", scopes: ["read"], now: NOW });
    const res = await mcpRoute.POST(mcpRequest(token, { jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
  });
});

// ── refresh rotation ─────────────────────────────────────────────────────

describe("refresh token rotation and reuse detection", () => {
  test("refresh rotates; replaying the old refresh token revokes the whole family", async () => {
    const first = await issueTokens("alice", "read write");
    const rotated = await tokenCall({ grant_type: "refresh_token", refresh_token: first.refresh, client_id: clientId });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(first.refresh);

    const replay = await tokenCall({ grant_type: "refresh_token", refresh_token: first.refresh, client_id: clientId });
    expect(replay.body.error).toBe("invalid_grant");

    const now = new Date().toISOString();
    expect(oauthLib.validateAccessToken(db, rotated.body.access_token, RESOURCE, now)).toBeNull();
    expect(oauthLib.validateAccessToken(db, first.access, RESOURCE, now)).toBeNull();
    const after = await tokenCall({ grant_type: "refresh_token", refresh_token: rotated.body.refresh_token, client_id: clientId });
    expect(after.body.error).toBe("invalid_grant");
  });

  test("a refresh cannot widen scopes", async () => {
    const { refresh } = await issueTokens("alice", "read");
    const r = await tokenCall({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, scope: "read write" });
    expect(r.body.error).toBe("invalid_scope");
  });

  test("RFC 7009 revocation of a refresh token revokes its family", async () => {
    const { access, refresh } = await issueTokens("alice", "read");
    const res = await revokeRoute.POST(
      new Request(`${ORIGIN}/api/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh, client_id: clientId }).toString(),
      }),
    );
    expect(res.status).toBe(200);
    expect(oauthLib.validateAccessToken(db, access, RESOURCE, new Date().toISOString())).toBeNull();
  });
});

// ── no machine principals ────────────────────────────────────────────────

describe("no agent or service-account tokens (boundary #1)", () => {
  test("client_credentials and password grants are unsupported", async () => {
    for (const grant of ["client_credentials", "password"]) {
      const r = await tokenCall({ grant_type: grant, client_id: clientId, username: "alice", password: "pw-alice-12345" });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("unsupported_grant_type");
    }
  });

  test("DCR refuses confidential clients and client_credentials registrations", async () => {
    for (const extra of [{ grant_types: ["client_credentials"] }, { token_endpoint_auth_method: "client_secret_basic" }]) {
      const res = await registerRoute.POST(
        new Request(`${ORIGIN}/api/oauth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_name: "Bot", redirect_uris: [REDIRECT], ...extra }),
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  test("a bearer token (what an agent holds) cannot approve consent", async () => {
    const { token } = issueApiToken(db, { userId: "alice", label: "agent", scopes: ["read", "write"], now: NOW });
    const res = await authorizeRoute.POST(
      new Request(`${ORIGIN}/api/oauth/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          decision: "approve", response_type: "code", client_id: clientId, redirect_uri: REDIRECT,
          code_challenge: pkce().challenge, code_challenge_method: "S256",
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("a viewer cannot grant write; an inactive user cannot redeem", async () => {
    const viewer = await authorize("bob", "read write", pkce().challenge);
    expect(viewer.status).toBe(403);
    const { verifier, challenge } = pkce();
    const code = await getCode("carol", "read", challenge);
    db.run("UPDATE app_user SET status = 'disabled' WHERE user_id = 'carol'");
    try {
      const r = await tokenCall({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier });
      expect(r.body.error).toBe("invalid_grant");
    } finally {
      db.run("UPDATE app_user SET status = 'active' WHERE user_id = 'carol'");
    }
  });
});

// ── transport ────────────────────────────────────────────────────────────

describe("Streamable HTTP /api/mcp", () => {
  test("a disallowed Origin is rejected; the public origin is accepted", async () => {
    const { access } = await issueTokens("alice", "read");
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
    const bad = await mcpRoute.POST(mcpRequest(access, init, { origin: "http://evil.example" }));
    expect(bad.status).toBe(403);
    const good = await mcpRoute.POST(mcpRequest(access, init, { origin: ORIGIN }));
    expect(good.status).toBe(200);
    await good.text();
  });

  test("tools/list hides the legacy direct-decision tools; a read tool runs in-process as the user", async () => {
    const { access } = await issueTokens("alice", "read");
    const sid = await openSession(access);
    const list = await rpc(access, sid, "tools/list", {});
    const names = (list.body?.result?.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toHaveLength(17);
    expect(names).not.toContain("record_gate_decision");
    expect(names).not.toContain("create_route_decision");
    const term = toolText(await rpc(access, sid, "tools/call", { name: "lookup_term", arguments: { term: "WACC" } }));
    expect(term.isError).toBe(false);
    expect((JSON.parse(term.text) as { data: { ko: string } }).data.ko.length).toBeGreaterThan(0);
  });

  test("a read-scoped token cannot call a write tool (insufficient_scope)", async () => {
    const { access } = await issueTokens("alice", "read");
    const sid = await openSession(access);
    const r = toolText(await rpc(access, sid, "tools/call", { name: "create_opportunity", arguments: { name: "scope probe" } }));
    expect(r.isError).toBe(true);
    expect(r.text).toContain("insufficient_scope");
    expect(db.query("SELECT COUNT(*) AS c FROM opportunity WHERE name = 'scope probe'").get()).toEqual({ c: 0 });
  });

  test("a write-scoped token writes as the human (audited with family, no token value)", async () => {
    const { access } = await issueTokens("alice", "read write");
    const sid = await openSession(access);
    const r = toolText(await rpc(access, sid, "tools/call", { name: "create_opportunity", arguments: { name: "MCP remote opp" } }));
    expect(r.isError).toBe(false);
    const audit = db.query("SELECT actor_user_id, target FROM audit_log WHERE action = 'mcp_tool_call' ORDER BY created_at DESC, id DESC LIMIT 1").get() as { actor_user_id: string; target: string };
    expect(audit.actor_user_id).toBe("alice");
    const target = JSON.parse(audit.target) as { tool: string; token_family_id: string; args_sha256: string };
    expect(target.tool).toBe("create_opportunity");
    expect(target.args_sha256).toHaveLength(64);
    const allAudit = JSON.stringify(db.query("SELECT * FROM audit_log").all());
    expect(allAudit).not.toContain(access);
    const mcpRows = JSON.stringify(db.query("SELECT target FROM audit_log WHERE action LIKE 'mcp_%' OR action LIKE 'oauth_%'").all());
    expect(mcpRows).not.toContain("MCP remote opp"); // arguments are hashed, never stored
  });

  test("a session is bound to its user and client", async () => {
    const alice = await issueTokens("alice", "read");
    const carol = await issueTokens("carol", "read");
    const sid = await openSession(alice.access);
    const r = await rpc(carol.access, sid, "tools/list", {});
    expect(r.status).toBe(404);
  });

  test("a revoked connected app loses access on the next call", async () => {
    const { access } = await issueTokens("alice", "read");
    const sid = await openSession(access);
    const listed = (await (await appsRoute.GET(new Request(`${ORIGIN}/api/oauth/apps`, { headers: cookieHeaders("alice") }))).json()) as { data: Array<{ client_id: string }> };
    expect(listed.data.some((a) => a.client_id === clientId)).toBe(true);
    const del = await appRoute.DELETE(
      new Request(`${ORIGIN}/api/oauth/apps/${clientId}`, { method: "DELETE", headers: cookieHeaders("alice") }),
      { params: Promise.resolve({ clientId }) },
    );
    expect(del.status).toBe(200);
    const after = await rpc(access, sid, "tools/list", {});
    expect(after.status).toBe(401);
  });
});

// ── stdio parity ────────────────────────────────────────────────────────

describe("shared registry", () => {
  test("the stdio tool list is unchanged (same 19 names, same order)", async () => {
    const { TOOLS } = await import("../../mcp/co-newbiz/index.ts");
    expect(TOOLS.map((t) => t.name)).toEqual([
      "search_interpretations", "get_procedure", "lookup_term", "list_notifications", "get_pipeline_status",
      "search_series", "get_observations", "list_data_changes", "list_opportunities", "create_opportunity",
      "get_process_evaluation", "get_gate_decisions", "record_gate_decision", "create_route_decision",
      "list_committee_sessions", "get_committee_session", "get_project_ic_package", "get_portfolio_scorecard",
      "get_project_dd_workspace",
    ]);
  });

  test("every registry tool's REST path resolves in the in-process route table", async () => {
    const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
    const seen: string[] = [];
    const record = async <T,>(p: string): Promise<Envelope<T>> => {
      seen.push(p);
      return { data: null as T, meta: {}, error: null };
    };
    const recorder: RestPort = { get: record, post: record, delete: record };
    const sample = {
      procedure: "x", term: "x", opportunityId: "o1", seriesId: "s1", name: "n", projectId: "p1", sessionId: "c1",
      gate: "screening", decision: "go", rationale: "r", track: "greenfield",
    };
    for (const tool of REGISTRY) {
      seen.length = 0;
      await tool.run({ port: recorder }, sample);
      expect(seen.length).toBeGreaterThan(0);
      for (const p of seen) expect(matchRoute(new URL(p, "http://x").pathname)).not.toBeNull();
    }
  });
});
