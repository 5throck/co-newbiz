// @version 1.0.0
/**
 * Auth routes — docs/api-spec.md §2 (Wave 5.6A).
 *
 * Register -> pending -> admin approve -> login is the account lifecycle
 * (design §4-9). Self-signup always lands as `viewer` — an unauthenticated
 * caller can never mint analyst/admin, and role elevation is a separate,
 * audited admin action.
 *
 * Login failure reasons map: invalid_credentials -> 401 (existence is not
 * leaked), locked -> 423, pending_approval / disabled -> 403.
 */

import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { getDb } from "../../db/client.ts";
import {
  SESSION_HOURS,
  authenticate,
  changePassword,
  createUser,
  resetPassword,
} from "../../db/lib/accounts.ts";
import { appendAudit } from "../../db/lib/access-control.ts";
import { badRequest, forbidden, ok, fail } from "./envelope.ts";
import { SESSION_COOKIE, requireAdmin, requireAuth, type AppEnv } from "./middleware.ts";

function sessionCookieOpts(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    secure,
    maxAge: SESSION_HOURS * 3600,
  };
}

export const authRoutes = new Hono<AppEnv>();

/** POST /api/auth/register — self-signup, always role=viewer, status=pending. */
authRoutes.post("/api/auth/register", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { userId?: string; password?: string; displayName?: string }
    | null;
  if (!body?.userId?.trim() || !body?.password) {
    return badRequest(c, "invalid_request", "userId and password are required.");
  }
  try {
    await createUser(getDb(), {
      userId: body.userId.trim(),
      role: "viewer",
      password: body.password,
      displayName: body.displayName?.trim() || undefined,
      createdBy: "self-signup",
      now: new Date().toISOString(),
    });
  } catch (err) {
    return badRequest(c, "register_failed", err instanceof Error ? err.message : "Registration failed.");
  }
  return ok(c, { userId: body.userId.trim(), status: "pending" }, 201, {
    note: "Account awaits administrator approval before login.",
  });
});

/** POST /api/auth/login — issues the session cookie on success. */
authRoutes.post("/api/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null) as { userId?: string; password?: string } | null;
  if (!body?.userId || !body?.password) {
    return badRequest(c, "invalid_request", "userId and password are required.");
  }
  const result = await authenticate(getDb(), { userId: body.userId, password: body.password, now: new Date().toISOString() });
  if (!result.ok) {
    const status = result.reason === "locked" ? 423 : result.reason === "invalid_credentials" ? 401 : 403;
    return fail(c, status, result.reason, result.lockedUntil ? `Locked until ${result.lockedUntil}.` : "Login refused.");
  }
  setCookie(c, SESSION_COOKIE, result.session.token, sessionCookieOpts(c.req.url.startsWith("https://")));
  const row = getDb().query("SELECT role FROM app_user WHERE user_id = ?").get(body.userId) as { role: string };
  return ok(c, { userId: body.userId, role: row.role, mustChangePassword: result.mustChangePassword, expiresAt: result.session.expiresAt });
});

/** GET /api/auth/me — who am I (also the must-change gate's status probe). */
authRoutes.get("/api/auth/me", requireAuth, (c) => {
  const a = c.get("auth");
  return ok(c, { userId: a.userId, role: a.role, via: a.via, scopes: a.scopes, mustChangePassword: a.mustChangePassword });
});

/** POST /api/auth/logout — revokes exactly the current session or token. */
authRoutes.post("/api/auth/logout", requireAuth, (c) => {
  const a = c.get("auth");
  const db = getDb();
  const now = new Date().toISOString();
  if (a.via === "cookie" && a.sessionId) {
    db.run("UPDATE session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [now, a.sessionId]);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
  } else if (a.tokenId) {
    db.run("UPDATE api_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [now, a.tokenId]);
  }
  appendAudit(db, { actor: a.userId, action: "logout", target: a.sessionId ?? a.tokenId ?? a.userId, now });
  return ok(c, { ok: true });
});

/**
 * POST /api/auth/password-change — current password required; history reuse
 * is refused by the engine; all other sessions revoked and a fresh one
 * issued (security-model §4). Bearer callers get the new session token in
 * the body so the forced-change flow works over MCP/CLI too.
 */
authRoutes.post("/api/auth/password-change", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as { currentPassword?: string; newPassword?: string } | null;
  const a = c.get("auth");
  if (!body?.currentPassword || !body?.newPassword) {
    return badRequest(c, "invalid_request", "currentPassword and newPassword are required.");
  }
  let issued;
  try {
    issued = await changePassword(getDb(), {
      userId: a.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      now: new Date().toISOString(),
    });
  } catch (err) {
    return badRequest(c, "password_change_failed", err instanceof Error ? err.message : "Password change failed.");
  }
  const secure = c.req.url.startsWith("https://");
  setCookie(c, SESSION_COOKIE, issued.token, sessionCookieOpts(secure));
  return ok(
    c,
    a.via === "bearer" ? { ok: true, session: { token: issued.token, expiresAt: issued.expiresAt } } : { ok: true },
  );
});

/** POST /api/auth/password-reset — admin-only forced reset (design §4-9). */
authRoutes.post("/api/auth/password-reset", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null) as { userId?: string; tempPassword?: string } | null;
  if (!body?.userId || !body?.tempPassword) {
    return badRequest(c, "invalid_request", "userId and tempPassword are required.");
  }
  try {
    await resetPassword(getDb(), {
      userId: body.userId,
      tempPassword: body.tempPassword,
      resetBy: c.get("auth").userId,
      now: new Date().toISOString(),
    });
  } catch (err) {
    return badRequest(c, "password_reset_failed", err instanceof Error ? err.message : "Password reset failed.");
  }
  return ok(c, { ok: true, mustChangePassword: true });
});
