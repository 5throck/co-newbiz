// Port of app/server/auth.ts POST /api/auth/register
import { createUser } from "../../../../../../db/lib/accounts.ts";
import { getDb } from "../../../../../../db/client.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { userId?: string; password?: string; displayName?: string }
    | null;
  if (!body?.userId?.trim() || !body?.password) {
    return badRequest("invalid_request", "userId and password are required.");
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
