// Port of app/server/auth.ts POST /api/auth/register
import { createUser } from "../../../../../../db/lib/accounts.ts";
import { getDb } from "../../../../../../db/client.ts";
import { allowRegisterAttempt, trustedClientAddress, type AttemptMap } from "../../../../lib/register-rate-limit.ts";
import { badRequest, fail, ok } from "../../../../lib/envelope.ts";

// Unauthenticated self-registration is an abuse magnet (pending-queue spam,
// user-enumeration noise) — throttled per trusted client address (L1).
const registerAttemptsByAddress: AttemptMap = new Map();

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { userId?: string; password?: string; displayName?: string }
    | null;
  if (!body?.userId?.trim() || !body?.password) {
    return badRequest("invalid_request", "userId and password are required.");
  }
  if (!allowRegisterAttempt(registerAttemptsByAddress, trustedClientAddress(request), Date.now())) {
    return fail(429, "too_many_attempts", "Too many registration attempts from this address — try again later.");
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
    return badRequest("register_failed", err instanceof Error ? err.message : "Registration failed.");
  }
  return ok({ userId: body.userId.trim(), status: "pending" }, 201, { note: "Account awaits administrator approval before login." });
}
