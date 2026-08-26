// Port of app/server/auth.ts POST /api/auth/password-reset — admin-only
// forced reset (security-model §4).
import { getDb } from "../../../../../../db/client.ts";
import { resetPassword } from "../../../../../../db/lib/accounts.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const body = (await request.json().catch(() => null)) as { userId?: string; tempPassword?: string } | null;
  if (!body?.userId || !body?.tempPassword) {
    return badRequest("invalid_request", "userId and tempPassword are required.");
  }
  try {
    await resetPassword(getDb(), { userId: body.userId, tempPassword: body.tempPassword, resetBy: auth.auth.userId, now: new Date().toISOString() });
  } catch (err) {
    return badRequest("password_reset_failed", err instanceof Error ? err.message : "Password reset failed.");
  }
  return ok({ ok: true, mustChangePassword: true });
}
