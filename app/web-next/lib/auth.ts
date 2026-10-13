// Next.js Route Handler auth gate (ADR-0069/0070, ex-app/server/middleware.ts).
// This IS the "shared wrapper" ADR-0070 §Decision-2/3 mandates every
// app/api/** Route Handler call. Every Route Handler must call
// `authenticate(request)` before touching any data; there is no
// `middleware.ts`-matcher shortcut (Next.js edge middleware cannot reach
// the Prisma/bun:sqlite client — see ADR-0070 §Decision-3) and no Server
// Action anywhere touches the database (ADR-0070 §Decision-1).
//
// Deliberately reuses db/lib/accounts.ts's validateSession and
// db/lib/api-tokens.ts's validateApiToken UNCHANGED — same password
// hashing, same session/token lifecycle, same audit trail. The retired
// side-by-side Hono server shared these db/lib modules too, and web-next
// is now the only HTTP layer.

import { getDb } from "../../../db/client.ts";
import { validateSession, type UserRole } from "../../../db/lib/accounts.ts";
import { validateApiToken, type TokenScope } from "../../../db/lib/api-tokens.ts";
import { forbidden, unauthorized } from "./envelope.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";
import { currentPrincipal } from "./mcp/principal-context.ts";

export const SESSION_COOKIE = "co_newbiz_session";
export const CSRF_COOKIE = "co_newbiz_csrf";

// Port of app/server/middleware.ts's requestIsSecure/sessionCookieOpts —
// used by the /api/auth/* routes (login/password-change) when setting the
// session cookie. Same X-Forwarded-Proto-aware logic: a TLS-terminating
// reverse proxy leaves the internal request http://, so the header is
// authoritative when present.
export function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return request.url.startsWith("https://");
}

export function sessionCookieOpts(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: 12 * 3600, // SESSION_HOURS from db/lib/accounts.ts
  };
}

export interface AuthContext {
  userId: string;
  role: UserRole;
  via: "cookie" | "bearer";
  scopes: TokenScope[];
  mustChangePassword: boolean;
  sessionId?: string;
  tokenId?: string;
}

const MUST_CHANGE_ALLOWLIST = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/password-change"]);

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

// ADR-0154: the 'propose' scope opens exactly one mutation — recording a
// decision proposal (POST /api/proposals). It never maps to REST 'write', so a
// propose-only token cannot reach any other mutating route.
function restScopesFor(request: Request, granted: readonly string[]): TokenScope[] {
  const scopes = (["read", "write"] as const).filter((s) => granted.includes(s));
  if (granted.includes("propose") && request.method === "POST" && new URL(request.url).pathname === "/api/proposals" && !scopes.includes("write")) {
    scopes.push("write");
  }
  return scopes;
}

export type AuthResult = { ok: true; auth: AuthContext } | { ok: false; response: Response };

/**
 * The single entry point every app/api/** Route Handler calls first. Same
 * ordering as Hono's requireAuth: authenticate -> scope -> CSRF ->
 * must-change-password gate.
 */
export function authenticate(request: Request): AuthResult {
  const db = getDb();
  const header = request.headers.get("authorization") ?? "";
  let auth: AuthContext | null = null;

  // ADR-0154: a route invoked in-process by /api/mcp runs as the OAuth-
  // delegated human. Only InProcessRestPort can enter this scope; no header
  // or cookie maps to it. Scopes narrow to the REST read/write vocabulary.
  const delegated = currentPrincipal();
  if (delegated) {
    auth = {
      userId: delegated.userId,
      role: delegated.role as UserRole,
      via: "bearer",
      scopes: restScopesFor(request, delegated.scopes),
      mustChangePassword: delegated.mustChangePassword,
      tokenId: delegated.tokenId,
    };
  } else if (header.toLowerCase().startsWith("bearer ")) {
    const valid = validateApiToken(db, header.slice(7).trim());
    if (valid) {
      auth = {
        userId: valid.userId,
        role: valid.role as UserRole,
        via: "bearer",
        scopes: valid.scopes,
        mustChangePassword: valid.mustChangePassword,
        tokenId: valid.tokenId,
      };
    }
  } else {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) {
      const valid = validateSession(db, token, new Date().toISOString());
      if (valid) {
        auth = {
          userId: valid.userId,
          role: valid.role,
          via: "cookie",
          scopes: ["read", "write"],
          mustChangePassword: valid.mustChangePassword,
          sessionId: valid.sessionId,
        };
      }
    }
  }

  if (!auth) {
    return { ok: false, response: unauthorized("unauthorized", "Authentication required (session cookie or Bearer token).") };
  }

  if (auth.via === "bearer" && request.method !== "GET" && request.method !== "HEAD" && !auth.scopes.includes("write")) {
    return { ok: false, response: forbidden("insufficient_scope", "This token is read-scoped; the requested mutation needs the 'write' scope.") };
  }

  if (auth.via === "cookie" && request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin) {
      const originHost = safeHost(origin);
      const host = request.headers.get("host");
      if (originHost && host && originHost !== host) {
        return { ok: false, response: forbidden("csrf_rejected", "Cross-origin request rejected.") };
      }
    }
    // Double-submit requires BOTH halves. Skipping the check when the CSRF
    // cookie is absent let cookie-authenticated mutations through without any
    // token (SameSite=lax was the only backstop) — now rejected.
    const cookieToken = readCookie(request, CSRF_COOKIE);
    if (!cookieToken) {
      return { ok: false, response: forbidden("csrf_missing", "CSRF cookie missing — reload the page and retry.") };
    }
    const headerToken = request.headers.get("x-csrf-token");
    if (!headerToken || headerToken !== cookieToken) {
      return { ok: false, response: forbidden("csrf_token_mismatch", "CSRF token mismatch — refresh and retry.") };
    }
  }

  const path = new URL(request.url).pathname;
  if (auth.mustChangePassword && !MUST_CHANGE_ALLOWLIST.has(path)) {
    return { ok: false, response: forbidden("must_change_password", "Password change is required before any other action.") };
  }

  return { ok: true, auth };
}

/**
 * How this request reached the route, for audit trails (ADR-0165 addendum):
 * 'mcp' = in-process call of an OAuth-delegated MCP client, 'ui' = cookie
 * session (the web app), 'api' = bearer token on REST (personal API token,
 * including the stdio MCP server's REST client).
 */
export function callPathOf(auth: AuthContext): "ui" | "api" | "mcp" {
  if (currentPrincipal()) return "mcp";
  return auth.via === "cookie" ? "ui" : "api";
}

/**
 * Human-only mutation guard (boundary #2, same predicate the human-only routes
 * inline): a cookie session of a non-agent account, never bearer, never the
 * in-process MCP principal. Returns the 403 human_only response, or null when
 * the caller is a human in the web app.
 */
export function humanOnlyDenied(auth: AuthContext, message: string): Response | null {
  if (auth.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(auth.userId)) return forbidden("human_only", message);
  return null;
}

export function requireAdmin(auth: AuthContext): Response | null {
  if (auth.role !== "admin") {
    return forbidden("admin_required", "Administrator role required.");
  }
  return null;
}

// ADR-0146: admin is a system operator kept apart from review/agenda content
// (ADR-0091), so business routes must reject it centrally instead of each
// route re-deriving the rule (a route that forgets it lets admin become a
// project lead and then 404 everywhere else).
export const ADMIN_BUSINESS_FORBIDDEN_MESSAGE =
  "admin 계정은 검토/안건 콘텐츠에서 분리되어 있습니다(ADR-0091) — analyst 계정으로 수행하세요.";
export const VIEWER_WRITE_FORBIDDEN_MESSAGE = "이 작업은 analyst 역할 이상이어야 합니다.";

export function requireBusinessActor(
  auth: AuthContext,
  mode: "read" | "write",
  opts?: { viewerMessage?: string },
): Response | null {
  if (auth.role === "admin") return forbidden("role_forbidden", ADMIN_BUSINESS_FORBIDDEN_MESSAGE);
  if (mode === "write" && auth.role === "viewer") {
    return forbidden("role_required", opts?.viewerMessage ?? VIEWER_WRITE_FORBIDDEN_MESSAGE);
  }
  return null;
}
