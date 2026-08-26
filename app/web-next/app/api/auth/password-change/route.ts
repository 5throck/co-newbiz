// Port of app/server/auth.ts POST /api/auth/password-change — current
// password required; all other sessions revoked and a fresh one issued.
import { getDb } from "../../../../../../db/client.ts";
import { changePassword } from "../../../../../../db/lib/accounts.ts";
import { authenticate, requestIsSecure, sessionCookieOpts, SESSION_COOKIE } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const a = auth.auth;
  const body = (await request.json().catch(() => null)) as { currentPassword?: string; newPassword?: string } | null;
  if (!body?.currentPassword || !body?.newPassword) {
    return badRequest("invalid_request", "currentPassword and newPassword are required.");
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
    return badRequest("password_change_failed", err instanceof Error ? err.message : "Password change failed.");
  }
  const response = ok(a.via === "bearer" ? { ok: true, session: { token: issued.token, expiresAt: issued.expiresAt } } : { ok: true });
  response.cookies.set(SESSION_COOKIE, issued.token, sessionCookieOpts(requestIsSecure(request)));
  return response;
}
