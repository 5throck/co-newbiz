// @version 1.0.0
/**
 * Auth middleware — docs/api-spec.md §1-2, docs/security-model.md §4.
 *
 * Two credential paths, one AuthContext:
 *   - cookie `co_newbiz_session` (web SPA): full read/write, subject to the
 *     must-change-password gate and the CSRF origin check below;
 *   - `Authorization: Bearer` API token (MCP/CLI): scope-limited — a
 *     read-scoped token is rejected on any non-GET BEFORE a handler runs,
 *     so no route can forget the check.
 *
 * Ordering inside this middleware is deliberate: authenticate -> scope ->
 * CSRF -> must-change-password gate. A forced-change account can do exactly
 * three things (me / logout / password-change) on either credential path —
 * API tokens are gated too, so an admin reset cannot be waited out by
 * switching to a bearer token (security-model §4: reset revokes sessions;
 * this closes the token side).
 */

import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { getDb } from "../../db/client.ts";
import { validateSession, type UserRole } from "../../db/lib/accounts.ts";
import { validateApiToken, type TokenScope } from "../../db/lib/api-tokens.ts";
import { forbidden, unauthorized } from "./envelope.ts";

export const SESSION_COOKIE = "co_newbiz_session";

export interface AuthContext {
  userId: string;
  role: UserRole;
  via: "cookie" | "bearer";
  scopes: TokenScope[];
  mustChangePassword: boolean;
  /** Present for cookie auth — logout revokes exactly this session. */
  sessionId?: string;
  /** Present for bearer auth — logout revokes exactly this token. */
  tokenId?: string;
}

export type AppEnv = { Variables: { auth: AuthContext } };

const MUST_CHANGE_ALLOWLIST = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/password-change"]);

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = getDb();
  const header = c.req.header("Authorization") ?? "";
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
    const token = getCookie(c, SESSION_COOKIE);
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
    return unauthorized(c, "unauthorized", "Authentication required (session cookie or Bearer token).");
  }
  c.set("auth", auth);

  // Scope enforcement first: a read-scoped bearer can never mutate.
  if (auth.via === "bearer" && c.req.method !== "GET" && c.req.method !== "HEAD" && !auth.scopes.includes("write")) {
    return forbidden(c, "insufficient_scope", "This token is read-scoped; the requested mutation needs the 'write' scope.");
  }

  // CSRF for cookie-authenticated mutations: SameSite=Lax is the primary
  // defense; if a browser still sends Origin on a cross-site POST, it must
  // match Host. Bearer requests are exempt (no ambient credential involved).
  if (auth.via === "cookie" && c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (origin) {
      const originHost = safeHost(origin);
      const host = c.req.header("Host");
      if (originHost && host && originHost !== host) {
        return forbidden(c, "csrf_rejected", "Cross-origin request rejected.");
      }
    }
  }

  if (auth.mustChangePassword && !MUST_CHANGE_ALLOWLIST.has(c.req.path)) {
    return forbidden(c, "must_change_password", "Password change is required before any other action.");
  }

  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("auth").role !== "admin") {
    return forbidden(c, "admin_required", "Administrator role required.");
  }
  await next();
};
