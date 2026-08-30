// Port of app/server/admin.ts GET /api/admin/users
import { getDb } from "../../../../../../db/client.ts";
import { approveUser, createUser, listUsers } from "../../../../../../db/lib/accounts.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  return ok(listUsers(getDb()));
}

const ROLES: ReadonlySet<string> = new Set(["admin", "analyst", "viewer"]);

// Admin user creation — reuses accounts.createUser + approveUser so the
// new account lands 'active' with a PBKDF2 hash (never plaintext), audited.
// The initial password is returned once in this response.
export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const ctx = auth.auth;
  const body = (await request.json().catch(() => null)) as {
    user_id?: string; display_name?: string; role?: string; password?: string;
  } | null;
  if (!body?.user_id?.trim() || !body?.role || !ROLES.has(body.role)) {
    return badRequest("invalid_request", "user_id and role (admin|analyst|viewer) are required.");
  }
  const password = body.password && body.password.length >= 8 ? body.password : `tmp-${Math.random().toString(36).slice(2, 10)}!A`;
  const db = getDb();
  const now = new Date().toISOString();
  try {
    await createUser(db, {
      userId: body.user_id.trim(),
      displayName: body.display_name?.trim() ?? body.user_id.trim(),
      role: body.role as "admin" | "analyst" | "viewer",
      password,
      createdBy: ctx.userId,
      now,
    });
    approveUser(db, { userId: body.user_id.trim(), approvedBy: ctx.userId, now });
  } catch (err) {
    return badRequest("create_failed", err instanceof Error ? err.message : "User creation failed.");
  }
  return ok({ user_id: body.user_id.trim(), role: body.role as "admin" | "analyst" | "viewer", initial_password: password }, 201);
}
