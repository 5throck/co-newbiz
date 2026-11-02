// Port of app/server/auth.ts POST /api/auth/register
//
// OWNER DECISION 2026-11-02 — self-registration CLOSED (access tightening,
// "Option A"; ADR-0146-adjacent). A default viewer account gets full business
// READ (requireBusinessActor read mode), so the previously open register
// endpoint let anyone reaching the login page create an account and see the
// entire deal pipeline (MNPI-adjacent). Registration is now refused by
// default; accounts are admin-provisioned only. Unaffected paths (verified):
// the CLI first-admin flow (`newbiz.ts user:create`/`user:approve`) and
// POST /api/admin/users (admin-session-gated) — neither goes through this
// route. Reversible: an operator may deliberately re-open registration by
// setting CO_NEWBIZ_ALLOW_REGISTER=1 (documented in .env.sample); the
// original rate-limited create path below is kept intact behind the flag.
import { createUser } from "../../../../../../db/lib/accounts.ts";
import { getDb } from "../../../../../../db/client.ts";
import { allowRegisterAttempt, trustedClientAddress, type AttemptMap } from "../../../../lib/register-rate-limit.ts";
import { badRequest, fail, ok } from "../../../../lib/envelope.ts";

// Closed by default (owner decision 2026-11-02, Option A). Read per request so
// an operator can flip the flag without a code change; only the exact "1"
// enables.
function registrationEnabled(): boolean {
  return process.env.CO_NEWBIZ_ALLOW_REGISTER === "1";
}

// Unauthenticated self-registration is an abuse magnet (pending-queue spam,
// user-enumeration noise) — throttled per trusted client address (L1).
const registerAttemptsByAddress: AttemptMap = new Map();

export async function POST(request: Request) {
  // The closed gate comes FIRST: while registration is disabled the endpoint
  // refuses everything at the door — no body parsing (no request-shape
  // oracle), no throttle-quota consumption, one uniform 403.
  if (!registrationEnabled()) {
    return fail(403, "registration_disabled", "Registration is disabled. Accounts are issued by the administrator.");
  }
  const body = (await request.json().catch(() => null)) as {
    userId?: string;
    password?: string;
    displayName?: string;
  } | null;
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
  return ok({ userId: body.userId.trim(), status: "pending" }, 201, {
    note: "Account awaits administrator approval before login.",
  });
}
