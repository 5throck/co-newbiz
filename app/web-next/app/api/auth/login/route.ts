// Port of app/server/auth.ts POST /api/auth/login — issues the session
// cookie on success. Per-address failed-login throttle ported verbatim
// (module-level Map, same defense-in-depth rationale as the Hono original:
// stops an unauthenticated password-spray across accounts, which the
// per-account lockout in db/lib/accounts.ts alone does not).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate as authenticateAccount } from "../../../../../../db/lib/accounts.ts";
import { badRequest, fail, ok } from "../../../../lib/envelope.ts";
import { CSRF_COOKIE, SESSION_COOKIE, requestIsSecure, sessionCookieOpts } from "../../../../lib/auth.ts";

const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES = 10;
const failedLoginsByAddress = new Map<string, number[]>();

function clientAddress(request: Request): string {
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "direct";
}

function loginThrottled(address: string): boolean {
  const now = Date.now();
  const recent = (failedLoginsByAddress.get(address) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  failedLoginsByAddress.set(address, recent);
  return recent.length >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(address: string): void {
  if (!failedLoginsByAddress.has(address)) failedLoginsByAddress.set(address, []);
  failedLoginsByAddress.get(address)!.push(Date.now());
}

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
  const address = clientAddress(request);
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
  const response = ok({ userId, role: row.role, mustChangePassword: result.mustChangePassword, expiresAt: result.session.expiresAt });
  response.cookies.set(SESSION_COOKIE, result.session.token, sessionCookieOpts(secure));
  response.cookies.set(CSRF_COOKIE, randomHex(32), { httpOnly: false, sameSite: "lax", path: "/", secure, maxAge: 12 * 3600 });
  return response;
}
