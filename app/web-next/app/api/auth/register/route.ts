// Port of app/server/auth.ts POST /api/auth/register
import { createUser } from "../../../../../../db/lib/accounts.ts";
import { getDb } from "../../../../../../db/client.ts";
import { badRequest, fail, ok } from "../../../../lib/envelope.ts";

// Unauthenticated self-registration is an abuse magnet (pending-queue spam,
// user-enumeration noise) — apply the same per-address throttle the login
// route uses, with a separate counter.
const REGISTER_WINDOW_MS = 15 * 60_000;
const REGISTER_MAX = 5;
const registerAttemptsByAddress = new Map<string, number[]>();

function clientAddress(request: Request): string {
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "direct";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { userId?: string; password?: string; displayName?: string }
    | null;
  if (!body?.userId?.trim() || !body?.password) {
    return badRequest("invalid_request", "userId and password are required.");
  }
  const address = clientAddress(request);
  const now = Date.now();
  const recent = (registerAttemptsByAddress.get(address) ?? []).filter((t) => now - t < REGISTER_WINDOW_MS);
  registerAttemptsByAddress.set(address, recent);
  if (recent.length >= REGISTER_MAX) {
    return fail(429, "too_many_attempts", "Too many registration attempts from this address — try again later.");
  }
  registerAttemptsByAddress.get(address)!.push(now);
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
