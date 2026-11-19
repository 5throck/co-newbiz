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

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-mcp-oauth.sqlite");
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
const registerRoute = await import("../../app/web-next/app/api/oauth/register/route.ts");
const authorizeRoute = await import("../../app/web-next/app/api/oauth/authorize/route.ts");
const tokenRoute = await import("../../app/web-next/app/api/oauth/token/route.ts");
const revokeRoute = await import("../../app/web-next/app/api/oauth/revoke/route.ts");
const appsRoute = await import("../../app/web-next/app/api/oauth/apps/route.ts");
const appRoute = await import("../../app/web-next/app/api/oauth/apps/[clientId]/route.ts");
const mcpRoute = await import("../../app/web-next/app/api/mcp/route.ts");
const asMetaRoute = await import("../../app/web-next/app/.well-known/oauth-authorization-server/[[...path]]/route.ts");
const oidcMetaRoute = await import("../../app/web-next/app/.well-known/openid-configuration/[[...path]]/route.ts");
const prMetaRoute = await import("../../app/web-next/app/.well-known/oauth-protected-resource/[[...path]]/route.ts");
const { authenticate: restAuthenticate } = await import("../../app/web-next/lib/auth.ts");
const { matchRoute } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const { resetMcpSessionsForTest } = await import("../../app/web-next/lib/mcp/http-server.ts");

const NOW = new Date().toISOString();
const REDIRECT = "http://127.0.0.1:33418/callback";
const sessions: Record<string, string> = {};
let clientId: string;

beforeAll(async () => {
  for (const [userId, role] of [
    ["alice", "analyst"],
    ["bob", "viewer"],
    ["carol", "analyst"],
  ] as const) {
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

async function authorize(
  userId: string,
  scope: string,
  challenge: string,
  extra: Record<string, string> = {},
): Promise<Response> {
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
        ...extra,
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
  const r = await tokenCall({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
    resource: RESOURCE,
  });
  expect(r.status).toBe(200);
  return { access: r.body.access_token, refresh: r.body.refresh_token, body: r.body };
}

let rpcId = 0;
function mcpRequest(
  token: string | null,
  body: unknown,
  opts: { sessionId?: string; origin?: string; method?: string } = {},
): Request {
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
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    }),
  );
  expect(res.status).toBe(200);
  const sid = res.headers.get("mcp-session-id");
  await readRpc(res);
  expect(sid).toBeTruthy();
  const ack = await mcpRoute.POST(
    mcpRequest(token, { jsonrpc: "2.0", method: "notifications/initialized" }, { sessionId: sid ?? "" }),
  );
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
    const meta = (await (
      await asMetaRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), {
        params: Promise.resolve({}),
      })
    ).json()) as Record<string, string[] | string>;
    expect(meta.issuer).toBe(ORIGIN);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(meta.registration_endpoint).toBe(`${ORIGIN}/api/oauth/register`);
  });

  test("protected-resource metadata names /api/mcp at both well-known paths", async () => {
    for (const path of [[], ["api", "mcp"]]) {
      const res = await prMetaRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`), {
        params: Promise.resolve({ path }),
      });
      const meta = (await res.json()) as { resource: string; authorization_servers: string[] };
      expect(meta.resource).toBe(RESOURCE);
      expect(meta.authorization_servers).toEqual([ORIGIN]);
    }
  });

  test("unauthenticated /api/mcp gets 401 pointing at the resource metadata", async () => {
    const res = await mcpRoute.POST(mcpRequest(null, { jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
    );
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
    const bad = await tokenCall({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: pkce().verifier,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_grant");
    const retry = await tokenCall({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(retry.body.error).toBe("invalid_grant");
  });

  test("an authorization request without S256 PKCE is refused", async () => {
    const res = await authorize("alice", "read", "", { code_challenge_method: "plain" });
    expect(res.status).toBe(400);
  });

  test("a replayed code revokes the tokens it produced", async () => {
    const { verifier, challenge } = pkce();
    const code = await getCode("alice", "read", challenge);
    const form = {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    };
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
    const auth = restAuthenticate(
      new Request(`${ORIGIN}/api/notifications`, { headers: { Authorization: `Bearer ${access}` } }),
    );
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
    const after = await tokenCall({
      grant_type: "refresh_token",
      refresh_token: rotated.body.refresh_token,
      client_id: clientId,
    });
    expect(after.body.error).toBe("invalid_grant");
  });

  test("a refresh cannot widen scopes", async () => {
    const { refresh } = await issueTokens("alice", "read");
    const r = await tokenCall({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
      scope: "read write",
    });
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
      const r = await tokenCall({
        grant_type: grant,
        client_id: clientId,
        username: "alice",
        password: "pw-alice-12345",
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("unsupported_grant_type");
    }
  });

  test("DCR refuses client_credentials; a requested secret auth method is registered as a public client", async () => {
    const send = (extra: Record<string, unknown>, ip: string) =>
      registerRoute.POST(
        new Request(`${ORIGIN}/api/oauth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ client_name: "Bot", redirect_uris: [REDIRECT], ...extra }),
        }),
      );
    expect((await send({ grant_types: ["client_credentials"] }, "198.51.100.1")).status).toBe(400);
    expect((await send({ grant_types: "authorization_code" }, "198.51.100.1")).status).toBe(400);
    expect((await send({ grant_types: ["refresh_token"] }, "198.51.100.1")).status).toBe(400);
    expect((await send({ grant_types: ["authorization_code"] }, "198.51.100.1")).status).toBe(201);
    for (const method of ["client_secret_basic", "client_secret_post", "private_key_jwt"]) {
      const res = await send({ token_endpoint_auth_method: method }, "198.51.100.2");
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.token_endpoint_auth_method).toBe("none");
      expect(body.client_secret).toBeUndefined();
    }
  });

  test("a bearer token (what an agent holds) cannot approve consent", async () => {
    const { token } = issueApiToken(db, { userId: "alice", label: "agent", scopes: ["read", "write"], now: NOW });
    const res = await authorizeRoute.POST(
      new Request(`${ORIGIN}/api/oauth/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          decision: "approve",
          response_type: "code",
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: pkce().challenge,
          code_challenge_method: "S256",
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
      const r = await tokenCall({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      });
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
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    };
    const bad = await mcpRoute.POST(mcpRequest(access, init, { origin: "http://evil.example" }));
    expect(bad.status).toBe(403);
    const good = await mcpRoute.POST(mcpRequest(access, init, { origin: ORIGIN }));
    expect(good.status).toBe(200);
    await good.text();
  });

  test("tools/list advertises the full set (decision tools as proposals only, no closure or kickoff); a read tool runs in-process", async () => {
    const { access } = await issueTokens("alice", "read");
    const sid = await openSession(access);
    const list = await rpc(access, sid, "tools/list", {});
    const names = ((list.body?.result?.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
    const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
    expect(names).toHaveLength(REGISTRY.length);
    expect(names).toContain("propose_gate_decision");
    expect(names).not.toContain("record_gate_decision"); // removed alias (review L2)
    expect(names).not.toContain("create_route_decision");
    expect(names.filter((n) => /close|kickoff/.test(n))).toEqual([]);
    const term = toolText(await rpc(access, sid, "tools/call", { name: "lookup_term", arguments: { term: "WACC" } }));
    expect(term.isError).toBe(false);
    expect((JSON.parse(term.text) as { data: { ko: string } }).data.ko.length).toBeGreaterThan(0);
  });

  test("a read-scoped token cannot call a write tool (insufficient_scope)", async () => {
    const { access } = await issueTokens("alice", "read");
    const sid = await openSession(access);
    const r = toolText(
      await rpc(access, sid, "tools/call", { name: "create_opportunity", arguments: { name: "scope probe" } }),
    );
    expect(r.isError).toBe(true);
    expect(r.text).toContain("insufficient_scope");
    expect(db.query("SELECT COUNT(*) AS c FROM opportunity WHERE name = 'scope probe'").get()).toEqual({ c: 0 });
  });

  test("a write-scoped token writes as the human (audited with family, no token value)", async () => {
    const { access } = await issueTokens("alice", "read write");
    const sid = await openSession(access);
    const r = toolText(
      await rpc(access, sid, "tools/call", { name: "create_opportunity", arguments: { name: "MCP remote opp" } }),
    );
    expect(r.isError).toBe(false);
    const audit = db
      .query(
        "SELECT actor_user_id, target FROM audit_log WHERE action = 'mcp_tool_call' ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get() as { actor_user_id: string; target: string };
    expect(audit.actor_user_id).toBe("alice");
    const target = JSON.parse(audit.target) as { tool: string; token_family_id: string; args_sha256: string };
    expect(target.tool).toBe("create_opportunity");
    expect(target.args_sha256).toHaveLength(64);
    const allAudit = JSON.stringify(db.query("SELECT * FROM audit_log").all());
    expect(allAudit).not.toContain(access);
    const mcpRows = JSON.stringify(
      db.query("SELECT target FROM audit_log WHERE action LIKE 'mcp_%' OR action LIKE 'oauth_%'").all(),
    );
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
    const listed = (await (
      await appsRoute.GET(new Request(`${ORIGIN}/api/oauth/apps`, { headers: cookieHeaders("alice") }))
    ).json()) as { data: Array<{ client_id: string }> };
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
  test("stdio and HTTP advertise the same tool set, original 17 tools first", async () => {
    const { TOOLS } = await import("../../mcp/co-newbiz/index.ts");
    const { toolsFor } = await import("../../mcp/co-newbiz/registry.ts");
    expect(TOOLS.map((t) => t.name)).toEqual(toolsFor("http").map((t) => t.name));
    expect(TOOLS.slice(0, 17).map((t) => t.name)).toEqual([
      "search_interpretations",
      "get_procedure",
      "lookup_term",
      "list_notifications",
      "get_pipeline_status",
      "search_series",
      "get_observations",
      "list_data_changes",
      "list_opportunities",
      "create_opportunity",
      "get_process_evaluation",
      "get_gate_decisions",
      "list_committee_sessions",
      "get_committee_session",
      "get_project_ic_package",
      "get_portfolio_scorecard",
      "get_project_dd_workspace",
    ]);
  });

  test("every registry tool's declared REST routes resolve in the in-process route table", async () => {
    const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
    for (const tool of REGISTRY) {
      expect(tool.routes.length, `${tool.name} declares no routes`).toBeGreaterThan(0);
      for (const route of tool.routes) {
        const path = route.split(" ")[1].replace(/\{\w+\}/g, "x1");
        expect(matchRoute(path), `${tool.name}: ${route}`).not.toBeNull();
      }
    }
  });
});

// ── DCR conformance + refusal audit (design 2026-11-19 §3, §3b) ─────────
const DCR_KEY = Symbol.for("co-newbiz.oauth.dcrHits");
const DCR_LOGGED_KEY = Symbol.for("co-newbiz.oauth.dcrRateLogged");

function dcr(body: unknown, ip: string, headers: Record<string, string> = {}, raw = false): Promise<Response> {
  return registerRoute.POST(
    new Request(`${ORIGIN}/api/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip, ...headers },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

function refusals(): Array<Record<string, unknown>> {
  return (
    db
      .query("SELECT actor_user_id, target FROM audit_log WHERE action = 'oauth_dcr_refused' ORDER BY id")
      .all() as Array<{ actor_user_id: string; target: string }>
  ).map((r) => ({ actor: r.actor_user_id, ...JSON.parse(r.target) }));
}

describe("DCR conformance", () => {
  test("echoes scope, response_types, grant_types and client_name; ignores unknown fields", async () => {
    const res = await dcr(
      {
        client_name: "Echo",
        redirect_uris: [REDIRECT],
        scope: "read bogus propose read",
        response_types: ["code"],
        software_id: "x",
        contacts: ["a@b.c"],
        logo_uri: "https://x/y.png",
      },
      "198.51.100.10",
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scope).toBe("read propose");
    expect(body.response_types).toEqual(["code"]);
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(body.client_name).toBe("Echo");
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.client_secret).toBeUndefined();
  });

  test("non-object JSON and wrong response_types are refused with 400", async () => {
    for (const raw of ["[]", '"str"', "null", "not json"]) {
      expect((await dcr(raw, "198.51.100.11", {}, true)).status).toBe(400);
    }
    const bad = await dcr({ client_name: "X", redirect_uris: [REDIRECT], response_types: ["token"] }, "198.51.100.11");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_client_metadata");
  });

  test("a missing Content-Type is tolerated when the body is a JSON object", async () => {
    const res = await registerRoute.POST(
      new Request(`${ORIGIN}/api/oauth/register`, {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.12" },
        body: JSON.stringify({ client_name: "NoCT", redirect_uris: [REDIRECT] }),
      }),
    );
    expect(res.status).toBe(201);
  });

  test("register, token and well-known responses carry a server-generated x-request-id (inbound id is never reused)", async () => {
    const ok = await dcr({ client_name: "Rid", redirect_uris: [REDIRECT] }, "198.51.100.13", {
      "x-request-id": "req-abc_1.2",
    });
    expect(ok.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const unsafe = await dcr("nope", "198.51.100.13", { "x-request-id": "bad/id!" }, true);
    expect(unsafe.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const tok = await tokenRoute.POST(
      new Request(`${ORIGIN}/api/oauth/token`, { method: "POST", body: "grant_type=password" }),
    );
    expect(tok.headers.get("x-request-id")).toBeTruthy();
    const meta = await asMetaRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), {
      params: Promise.resolve({}),
    });
    expect(meta.headers.get("x-request-id")).toBeTruthy();
    const pr = await prMetaRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`), {
      params: Promise.resolve({}),
    });
    expect(pr.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("DCR refusal audit", () => {
  test("each refusal branch writes exactly one oauth_dcr_refused row with the right reason and no secrets", async () => {
    const before = refusals().length;
    const ip = "198.51.100.20";
    const SECRET_NAME = "Super Secret Connector Name";
    const SECRET_URI = "https://secret-host.example/very/private/callback?token=abc";
    process.env.CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST = "chatgpt.com";
    try {
      const cases: Array<[unknown, string, boolean?]> = [
        ["{broken", "body_not_json", true],
        ["[1]", "body_not_object", true],
        [
          { client_name: SECRET_NAME, redirect_uris: [REDIRECT], response_types: ["token"] },
          "response_type_unsupported",
        ],
        [
          { client_name: SECRET_NAME, redirect_uris: [REDIRECT], grant_types: ["client_credentials"] },
          "grant_unsupported",
        ],
        [
          { client_name: SECRET_NAME, redirect_uris: [REDIRECT], grant_types: "authorization_code" },
          "grant_unsupported",
        ],
        [{ client_name: SECRET_NAME, redirect_uris: [REDIRECT], grant_types: ["refresh_token"] }, "grant_unsupported"],
        [{ client_name: SECRET_NAME, redirect_uris: [REDIRECT], grant_types: [] }, "grant_unsupported"],
        [{ client_name: SECRET_NAME, redirect_uris: [SECRET_URI] }, "redirect_host_not_allowed"],
        [{ client_name: "", redirect_uris: [REDIRECT] }, "invalid_client_metadata"],
        [{ client_name: SECRET_NAME, redirect_uris: ["http://insecure.example/cb"] }, "redirect_host_not_allowed"],
      ];
      // an engine-level invalid_redirect_uri: loopback passes the allowlist, a fragment fails the engine
      cases.push([{ client_name: SECRET_NAME, redirect_uris: ["http://127.0.0.1:1/cb#frag"] }, "invalid_redirect_uri"]);
      let i = 0;
      for (const [body, reason, raw] of cases) {
        const res = await dcr(body, ip, { "cf-ray": `ray-${i}-LHR`, "x-request-id": `rid-${i}` }, raw ?? false);
        expect(res.status).toBe(400);
        i++;
        const rows = refusals();
        expect(rows.length).toBe(before + i);
        const last = rows[rows.length - 1];
        expect(last.reason).toBe(reason);
        expect(last.status).toBe(400);
        expect(last.actor).toBe("anonymous");
        expect(last.request_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(last.request_id).not.toBe(`rid-${i - 1}`);
        expect(last.client_request_id).toBe(`rid-${i - 1}`);
        expect(last.cf_ray).toBe(`ray-${i - 1}-LHR`);
        expect(typeof last.ip_hash).toBe("string");
        expect(last.ip_hash).not.toContain(ip);
      }
      const dump = JSON.stringify(refusals());
      expect(dump).not.toContain(SECRET_NAME);
      expect(dump).not.toContain("very/private");
      expect(dump).not.toContain("token=abc");
      expect(dump).not.toContain(ip);
      // the redirect host reason records only the host
      const hostRow = refusals().find((r) => r.reason === "redirect_host_not_allowed");
      expect(hostRow?.redirect_host).toBe("secret-host.example");
    } finally {
      delete process.env.CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST;
    }
  });

  test("reserved brand names are bound to the brand's own redirect hosts (ADR-0203 Decision 5)", async () => {
    const ip = "198.51.100.30";
    expect(
      (await dcr({ client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector/oauth/abc"] }, ip)).status,
    ).toBe(201);
    expect(
      (await dcr({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }, ip)).status,
    ).toBe(201);
    expect(
      (await dcr({ client_name: "Neutral Tool", redirect_uris: ["https://anything.example/cb"] }, ip)).status,
    ).toBe(201);
    const before = refusals().length;
    const bad = await dcr({ client_name: "ChatGPT", redirect_uris: ["https://attacker.example/private/cb?x=1"] }, ip);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_client_metadata");
    const mixed = await dcr(
      { client_name: "Claude", redirect_uris: ["https://claude.ai/cb", "https://attacker.example/cb"] },
      ip,
    );
    expect(mixed.status).toBe(400);
    const loop = await dcr({ client_name: "Gemini", redirect_uris: [REDIRECT] }, ip);
    expect(loop.status).toBe(400);
    const rows = refusals().slice(before);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.reason === "reserved_client_name")).toBe(true);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("attacker.example");
    expect(dump).not.toContain("ChatGPT");
  });

  test("a successful registration writes no refusal row", async () => {
    const before = refusals().length;
    expect((await dcr({ client_name: "Fine", redirect_uris: [REDIRECT] }, "198.51.100.21")).status).toBe(201);
    expect(refusals().length).toBe(before);
  });

  test("a flood writes one rate_limited row per IP per window", async () => {
    const g = globalThis as Record<symbol, Map<string, unknown> | undefined>;
    g[DCR_KEY]?.clear();
    g[DCR_LOGGED_KEY]?.clear();
    const before = refusals().filter((r) => r.reason === "rate_limited").length;
    const ip = "198.51.100.30";
    for (let i = 0; i < 20; i++)
      expect((await dcr({ client_name: `F${i}`, redirect_uris: [REDIRECT] }, ip)).status).toBe(201);
    for (let i = 0; i < 5; i++)
      expect((await dcr({ client_name: "over", redirect_uris: [REDIRECT] }, ip)).status).toBe(429);
    expect(refusals().filter((r) => r.reason === "rate_limited").length).toBe(before + 1);
    g[DCR_KEY]?.clear();
    g[DCR_LOGGED_KEY]?.clear();
  });
});

describe("client IP for rate limiting (CO_NEWBIZ_TRUST_PROXY_HEADERS)", () => {
  test("with cloudflare trust, distinct CF-Connecting-IP values get separate buckets and a spoofed XFF does not bypass", async () => {
    const g = globalThis as Record<symbol, Map<string, unknown> | undefined>;
    g[DCR_KEY]?.clear();
    g[DCR_LOGGED_KEY]?.clear();
    process.env.CO_NEWBIZ_TRUST_PROXY_HEADERS = "cloudflare";
    try {
      const send = (cf: string, xff: string) =>
        dcr({ client_name: "ip", redirect_uris: [REDIRECT] }, xff, { "cf-connecting-ip": cf });
      // exhaust 203.0.113.1 while rotating a spoofed XFF each call
      for (let i = 0; i < 20; i++) expect((await send("203.0.113.1", `10.0.0.${i}`)).status).toBe(201);
      expect((await send("203.0.113.1", "10.9.9.9")).status).toBe(429);
      // another real client is unaffected
      expect((await send("203.0.113.2", "10.0.0.0")).status).toBe(201);
    } finally {
      delete process.env.CO_NEWBIZ_TRUST_PROXY_HEADERS;
      g[DCR_KEY]?.clear();
      g[DCR_LOGGED_KEY]?.clear();
    }
  });

  test("without the trust flag CF-Connecting-IP is ignored and the rightmost XFF entry is the key", async () => {
    const { clientIp } = await import("../../app/web-next/lib/mcp/request-meta.ts");
    const req = (h: Record<string, string>) => new Request(ORIGIN, { headers: h });
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("2.2.2.2");
    process.env.CO_NEWBIZ_TRUST_PROXY_HEADERS = "cloudflare";
    try {
      expect(clientIp(req({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" }))).toBe("203.0.113.9");
      expect(clientIp(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("1.1.1.1");
    } finally {
      delete process.env.CO_NEWBIZ_TRUST_PROXY_HEADERS;
    }
    expect(clientIp(req({}))).toBe("local");
  });
});

describe("discovery documents", () => {
  test("authorization-server metadata is identical at all four well-known forms and has the required fields", async () => {
    const bodies: string[] = [];
    for (const [route, path] of [
      [asMetaRoute, []],
      [asMetaRoute, ["api", "mcp"]],
      [oidcMetaRoute, []],
      [oidcMetaRoute, ["api", "mcp"]],
    ] as const) {
      const res = await route.GET(new Request(`${ORIGIN}/.well-known/x`), {
        params: Promise.resolve({ path: [...path] }),
      });
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    const meta = JSON.parse(bodies[0]) as Record<string, unknown>;
    for (const f of [
      "issuer",
      "authorization_endpoint",
      "token_endpoint",
      "registration_endpoint",
      "response_types_supported",
      "grant_types_supported",
      "code_challenge_methods_supported",
      "token_endpoint_auth_methods_supported",
      "scopes_supported",
    ]) {
      expect(meta[f]).toBeDefined();
    }
    expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  test("an unknown suffix is a 404", async () => {
    const res = await oidcMetaRoute.GET(new Request(`${ORIGIN}/.well-known/openid-configuration/other`), {
      params: Promise.resolve({ path: ["other"] }),
    });
    expect(res.status).toBe(404);
  });
});

describe("/api/mcp unauthenticated discovery ordering", () => {
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
  };

  test("no bearer with a foreign Origin gets 401 + WWW-Authenticate, not 403", async () => {
    const res = await mcpRoute.POST(mcpRequest(null, init, { origin: "https://chatgpt.com" }));
    expect(res.status).toBe(401);
    const h = res.headers.get("www-authenticate") ?? "";
    expect(h).toStartWith("Bearer ");
    expect(h).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
    expect(h).toContain('scope="read propose"');
  });

  test("an invalid bearer with a foreign Origin gets 401 invalid_token", async () => {
    const res = await mcpRoute.POST(mcpRequest("not-a-token", init, { origin: "http://evil.example" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("a valid bearer with a foreign Origin is still refused 403", async () => {
    const { access } = await issueTokens("alice", "read");
    const res = await mcpRoute.POST(mcpRequest(access, init, { origin: "http://evil.example" }));
    expect(res.status).toBe(403);
    await res.text();
  });

  test("a refused Origin is audited with family id and Origin host only, never the token", async () => {
    const { access } = await issueTokens("alice", "read");
    const res = await mcpRoute.POST(mcpRequest(access, init, { origin: "http://evil.example/path?x=1" }));
    expect(res.status).toBe(403);
    await res.text();
    const row = db
      .query("SELECT actor_user_id, target FROM audit_log WHERE action = 'mcp_origin_refused' ORDER BY id DESC LIMIT 1")
      .get() as { actor_user_id: string; target: string };
    expect(row.actor_user_id).toBe("alice");
    const target = JSON.parse(row.target);
    expect(target.origin_host).toBe("evil.example");
    expect(typeof target.family_id).toBe("string");
    expect(row.target).not.toContain(access);
    expect(row.target).not.toContain("/path");
  });

  test("a non-HTTPS request in production is audited as mcp_https_refused", async () => {
    const { access } = await issueTokens("alice", "read");
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const res = await mcpRoute.POST(
        new Request(`${ORIGIN.replace("https:", "http:")}/api/mcp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${access}`,
          },
          body: JSON.stringify(init),
        }),
      );
      expect(res.status).toBe(403);
      await res.text();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
    const row = db
      .query("SELECT target FROM audit_log WHERE action = 'mcp_https_refused' ORDER BY id DESC LIMIT 1")
      .get() as { target: string } | null;
    expect(row).not.toBeNull();
    expect(row?.target).not.toContain(access);
  });
});

describe("DCR audit pseudonym and rate-limit hygiene (F2/F3)", () => {
  test("ipHash is a keyed HMAC pseudonym: differs from plain SHA-256 and changes with the key; production without a key writes none", async () => {
    const { ipHash, rateKey, rateCheck, OVERFLOW_KEY } = await import("../../app/web-next/lib/mcp/request-meta.ts");
    const prevKey = process.env.CO_NEWBIZ_AUDIT_IP_HMAC_KEY;
    const prevEnv = process.env.NODE_ENV;
    const env = process.env as Record<string, string | undefined>;
    try {
      env.CO_NEWBIZ_AUDIT_IP_HMAC_KEY = "key-one";
      const a = ipHash("203.0.113.5");
      expect(a).toMatch(/^[0-9a-f]{16}$/);
      expect(a).not.toBe(createHash("sha256").update("203.0.113.5").digest("hex").slice(0, 16));
      env.CO_NEWBIZ_AUDIT_IP_HMAC_KEY = "key-two";
      expect(ipHash("203.0.113.5")).not.toBe(a);
      delete env.CO_NEWBIZ_AUDIT_IP_HMAC_KEY;
      env.NODE_ENV = "production";
      expect(ipHash("203.0.113.5")).toBeNull();
      env.NODE_ENV = "test";
      expect(ipHash("203.0.113.5")).toMatch(/^[0-9a-f]{16}$/); // labelled dev fallback key
    } finally {
      if (prevKey === undefined) delete env.CO_NEWBIZ_AUDIT_IP_HMAC_KEY;
      else env.CO_NEWBIZ_AUDIT_IP_HMAC_KEY = prevKey;
      env.NODE_ENV = prevEnv;
    }

    // F3: same /64 shares a bucket; invalid keys share "unknown"; IPv4-mapped collapses to IPv4
    expect(rateKey("2001:db8:1:2:aaaa::1")).toBe(rateKey("2001:db8:1:2:bbbb:cccc:dddd:eeee"));
    expect(rateKey("2001:db8:1:3::1")).not.toBe(rateKey("2001:db8:1:2::1"));
    expect(rateKey("not-an-ip")).toBe("unknown");
    expect(rateKey("::ffff:192.0.2.1")).toBe("192.0.2.1");

    // F3: 10k distinct keys never exceed the cap; overflow keys are still limited
    const hits = new Map<string, number[]>();
    const opts = { windowMs: 60_000, max: 20, maxKeys: 500 };
    const now = Date.now();
    let overflowLimited = false;
    for (let i = 0; i < 10_000; i++) {
      const r = rateCheck(hits, `k${i}`, now, opts);
      if (r.key === OVERFLOW_KEY && r.limited) overflowLimited = true;
    }
    expect(hits.size).toBeLessThanOrEqual(opts.maxKeys + 1);
    expect(overflowLimited).toBe(true);
    // stale entries are swept so the map shrinks once the window passes
    rateCheck(hits, "fresh", now + 120_000, opts);
    for (let i = 0; i < 300; i++) rateCheck(hits, "fresh2", now + 120_000, { ...opts, max: 1_000 });
    expect(hits.size).toBeLessThan(10);
  });

  test("the route spreads one /64 over a single bucket and enforces the global registrations ceiling", async () => {
    const g = globalThis as Record<symbol, Map<string, unknown> | number[] | undefined>;
    (g[DCR_KEY] as Map<string, unknown> | undefined)?.clear();
    (g[DCR_LOGGED_KEY] as Map<string, unknown> | undefined)?.clear();
    const globalRegs = g[Symbol.for("co-newbiz.oauth.dcrGlobalRegistrations")] as number[];
    globalRegs.length = 0;
    // 20 distinct addresses in one /64 exhaust one bucket
    for (let i = 0; i < 20; i++)
      expect((await dcr({ client_name: "v6", redirect_uris: [REDIRECT] }, `2001:db8:77:1:${i + 1}::1`)).status).toBe(
        201,
      );
    expect((await dcr({ client_name: "v6", redirect_uris: [REDIRECT] }, "2001:db8:77:1:ffff::9")).status).toBe(429);
    // global ceiling regardless of IP
    (g[DCR_KEY] as Map<string, unknown>).clear();
    globalRegs.length = 0;
    const now = Date.now();
    for (let i = 0; i < 200; i++) globalRegs.push(now);
    const res = await dcr({ client_name: "g", redirect_uris: [REDIRECT] }, "198.51.100.99");
    expect(res.status).toBe(429);
    expect(refusals().some((r) => r.reason === "global_rate_limited")).toBe(true);
    globalRegs.length = 0;
    (g[DCR_KEY] as Map<string, unknown>).clear();
    (g[DCR_LOGGED_KEY] as Map<string, unknown>).clear();
  });
});
