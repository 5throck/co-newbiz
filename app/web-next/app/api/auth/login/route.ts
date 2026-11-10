// Port of app/server/auth.ts POST /api/auth/login — issues the session
// cookie on success. Per-address failed-login throttle (lib/login-throttle:
// bounded module-level Map, keys on the rightmost X-Forwarded-For hop — the
// proxy-authored entry; see that file's header for the restart-reset
// acceptance and the register-route header divergence — same
// defense-in-depth rationale as the Hono original: stops an unauthenticated
// password-spray across accounts, which the per-account lockout in
// db/lib/accounts.ts alone does not).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate as authenticateAccount } from "../../../../../../db/lib/accounts.ts";
import { badRequest, fail, ok } from "../../../../lib/envelope.ts";
import { CSRF_COOKIE, SESSION_COOKIE, requestIsSecure, sessionCookieOpts } from "../../../../lib/auth.ts";
import { loginThrottled, recordLoginFailure, trustedLoginAddress } from "../../../../lib/login-throttle.ts";

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { userId?: string; password?: string } | null;
  if (!body?.userId || !body?.password) {
    return badRequest("invalid_request", "userId and password are required.");
  }
  const userId = body.userId.trim();
  if (!userId) return badRequest("invalid_request", "userId and password are required.");
  const address = trustedLoginAddress(request);
  if (loginThrottled(address)) {
    return fail(429, "too_many_attempts", "Too many failed logins from this address — try again later.");
  }
  const result = await authenticateAccount(getDb(), { userId, password: body.password, now: new Date().toISOString() });
  if (!result.ok) {
    recordLoginFailure(address);
    const status = result.reason === "locked" ? 423 : result.reason === "invalid_credentials" ? 401 : 403;
    return fail(status, result.reason, result.lockedUntil ? `Locked until ${result.lockedUntil}.` : "Login refused.");
  }

  const secure = requestIsSecure(request);
  const row = getDb().query("SELECT role FROM app_user WHERE user_id = ?").get(userId) as { role: string };
  const response = ok({
    userId,
    role: row.role,
    mustChangePassword: result.mustChangePassword,
    expiresAt: result.session.expiresAt,
  });
  response.cookies.set(SESSION_COOKIE, result.session.token, sessionCookieOpts(secure));
  response.cookies.set(CSRF_COOKIE, randomHex(32), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 12 * 3600,
  });
  return response;
}
