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

export function requireAdmin(auth: AuthContext): Response | null {
  if (auth.role !== "admin") {
    return forbidden("admin_required", "Administrator role required.");
  }
  return null;
}
