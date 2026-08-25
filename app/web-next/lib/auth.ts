// Phase 2 port of app/server/middleware.ts's requireAuth/requireAdmin
// (ADR-0069/0070). This IS the "shared wrapper" ADR-0070 §Decision-2/3
// mandates every app/api/** Route Handler call — the Next.js-side successor
// to ADR-0011's single enforcement point. Every Route Handler must call
// `authenticate(request)` before touching any data; there is no
// `middleware.ts`-matcher shortcut (Next.js edge middleware cannot reach
// the Prisma/bun:sqlite client — see ADR-0070 §Decision-3) and no Server
// Action anywhere touches the database (ADR-0070 §Decision-1).
//
// Deliberately reuses db/lib/accounts.ts's validateSession and
// db/lib/api-tokens.ts's validateApiToken UNCHANGED — same password
// hashing, same session/token lifecycle, same audit trail as the Hono
// side. Porting the HTTP layer does not mean re-deriving the security
// model; PBKDF2/session/CSRF logic living in db/lib/* is reused verbatim
// by both app/server (Hono, current) and app/web-next (Next.js, this
// phase) for as long as both exist side by side (design doc §6 Phase 4
// shadow-traffic period).

import { getDb } from "../../../db/client.ts";
import { validateSession, type UserRole } from "../../../db/lib/accounts.ts";
import { validateApiToken, type TokenScope } from "../../../db/lib/api-tokens.ts";
import { forbidden, unauthorized } from "./envelope.ts";

export const SESSION_COOKIE = "co_newbiz_session";
export const CSRF_COOKIE = "co_newbiz_csrf";

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

  if (header.toLowerCase().startsWith("bearer ")) {
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
    const cookieToken = readCookie(request, CSRF_COOKIE);
    if (cookieToken) {
      const headerToken = request.headers.get("x-csrf-token");
      if (!headerToken || headerToken !== cookieToken) {
        return { ok: false, response: forbidden("csrf_token_mismatch", "CSRF token mismatch — refresh and retry.") };
      }
    }
  }

  const path = new URL(request.url).pathname;
  if (auth.mustChangePassword && !MUST_CHANGE_ALLOWLIST.has(path)) {
    return { ok: false, response: forbidden("must_change_password", "Password change is required before any other action.") };
  }

  return { ok: true, auth };
}

export function requireAdmin(auth: AuthContext): Response | null {
  if (auth.role !== "admin") {
    return forbidden("admin_required", "Administrator role required.");
  }
  return null;
}
