// @version 1.0.0
// Remote MCP endpoint core — ADR-0154 §1/§2, design §3.2.
//
// Request pipeline for /api/mcp (POST/GET/DELETE):
//   HTTPS (production) -> Origin allowlist (DNS rebinding) -> bearer OAuth
//   access token, audience-bound to this resource (RFC 8707) -> per-token
//   rate limit -> Mcp-Session-Id bound to (user_id, client_id) -> SDK
//   WebStandardStreamableHTTPServerTransport -> shared registry ->
//   InProcessRestPort as the delegated human.
// Unauthenticated: 401 + WWW-Authenticate resource_metadata (RFC 9728).
// Token values are never logged or audited; audit stores the token family.

import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getDb } from "../../../../db/client.ts";
import { auditTokenUse, validateAccessToken, type ValidAccessToken } from "../../../../db/lib/oauth.ts";
import { buildMcpServer } from "../../../../mcp/co-newbiz/registry.ts";
import { InProcessRestPort } from "./in-process-port.ts";
import type { DelegatedPrincipal } from "./principal-context.ts";
import { httpsRequired, mcpResource, originAllowed, protectedResourceMetadataUrl } from "./config.ts";

const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 10;
const MAX_SESSIONS_TOTAL = 1000;
const RATE_LIMIT_PER_MIN = 120;

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
  userId: string;
  clientId: string;
  lastSeen: number;
}

const KEY = Symbol.for("co-newbiz.mcp.sessions");
type Holder = { [KEY]?: { sessions: Map<string, SessionEntry>; hits: Map<string, number[]> } };
const holder = globalThis as Holder;
const state = holder[KEY] ?? (holder[KEY] = { sessions: new Map<string, SessionEntry>(), hits: new Map<string, number[]>() });

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function unauthorized(request: Request, invalidToken: boolean): Response {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl(request)}"`];
  if (invalidToken) parts.unshift(`error="invalid_token"`);
  return jsonRpcError(401, "Unauthorized: a valid OAuth access token for this resource is required.", {
    "WWW-Authenticate": `Bearer ${parts.join(", ")}`,
  });
}

function sweep(now: number): void {
  for (const [id, s] of state.sessions) {
    if (now - s.lastSeen > SESSION_IDLE_MS) {
      state.sessions.delete(id);
      void s.transport.close().catch(() => undefined);
    }
  }
}

function rateLimited(key: string, now: number): boolean {
  const recent = (state.hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  state.hits.set(key, recent);
  return recent.length > RATE_LIMIT_PER_MIN;
}

function toPrincipal(t: ValidAccessToken): DelegatedPrincipal {
  return { userId: t.userId, role: t.role, scopes: t.scopes, mustChangePassword: t.mustChangePassword, tokenId: t.tokenId, clientId: t.clientId };
}

function principalFrom(authInfo: AuthInfo | undefined): { principal: DelegatedPrincipal; familyId: string } {
  const extra = authInfo?.extra;
  const principal = extra?.principal;
  const familyId = extra?.familyId;
  if (!principal || typeof principal !== "object" || typeof familyId !== "string" || !("userId" in principal)) {
    throw new Error("Missing delegated principal.");
  }
  return { principal: principal as DelegatedPrincipal, familyId };
}

function newSessionServer(): Server {
  return buildMcpServer({
    transport: "http",
    resolveContext: ({ authInfo }) => {
      const { principal } = principalFrom(authInfo);
      return { port: new InProcessRestPort(principal), scopes: principal.scopes };
    },
    onToolCall: (rec) => {
      try {
        const { principal, familyId } = principalFrom(rec.authInfo);
        auditTokenUse(getDb(), {
          userId: principal.userId, clientId: principal.clientId, familyId, tool: rec.name, scope: rec.scope,
          result: rec.ok ? "ok" : (rec.errorCode ?? "error"), argsHash: rec.argsHash, now: new Date().toISOString(),
        });
      } catch {
        /* audit must not crash the transport; the route-level audit still applies */
      }
    },
  });
}

/** Handle one /api/mcp request (any method). */
export async function handleMcpRequest(request: Request): Promise<Response> {
  if (httpsRequired(request)) return jsonRpcError(403, "HTTPS is required.");
  if (!originAllowed(request)) return jsonRpcError(403, "Origin not allowed.");

  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return unauthorized(request, false);
  const nowIso = new Date().toISOString();
  const token = validateAccessToken(getDb(), header.slice(7).trim(), mcpResource(request), nowIso);
  if (!token) return unauthorized(request, true);
  if (token.mustChangePassword) return jsonRpcError(403, "Password change is required before any other action.");

  const now = Date.now();
  sweep(now);
  if (rateLimited(token.familyId, now)) return jsonRpcError(429, "Rate limit exceeded.", { "Retry-After": "60" });

  const authInfo: AuthInfo = {
    token: token.tokenId, // the token id, never the bearer value
    clientId: token.clientId,
    scopes: token.scopes,
    expiresAt: Math.floor(Date.parse(token.expiresAt) / 1000),
    resource: new URL(mcpResource(request)),
    extra: { principal: toPrincipal(token), familyId: token.familyId },
  };

  const sessionId = request.headers.get("mcp-session-id");
  if (sessionId) {
    const entry = state.sessions.get(sessionId);
    // A session belonging to another principal is indistinguishable from none.
    if (!entry || entry.userId !== token.userId || entry.clientId !== token.clientId) {
      return jsonRpcError(404, "Session not found.");
    }
    entry.lastSeen = now;
    const res = await entry.transport.handleRequest(request, { authInfo });
    if (request.method === "DELETE") state.sessions.delete(sessionId);
    return res;
  }

  if (request.method !== "POST") return jsonRpcError(400, "Mcp-Session-Id header is required.");
  const body: unknown = await request.json().catch(() => undefined);
  const messages = Array.isArray(body) ? body : [body];
  if (!messages.some((m) => isInitializeRequest(m))) return jsonRpcError(400, "Mcp-Session-Id header is required.");

  const userSessions = [...state.sessions.values()].filter((s) => s.userId === token.userId).length;
  if (userSessions >= MAX_SESSIONS_PER_USER || state.sessions.size >= MAX_SESSIONS_TOTAL) {
    return jsonRpcError(429, "Too many open MCP sessions.");
  }

  const server = newSessionServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      state.sessions.set(id, { transport, server, userId: token.userId, clientId: token.clientId, lastSeen: Date.now() });
    },
    onsessionclosed: (id) => {
      state.sessions.delete(id);
    },
  });
  await server.connect(transport);
  return transport.handleRequest(request, { authInfo, parsedBody: body });
}

/** Test hook: drop every session (no production caller). */
export function resetMcpSessionsForTest(): void {
  state.sessions.clear();
  state.hits.clear();
}
