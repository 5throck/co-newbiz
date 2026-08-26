// Port of app/server/admin.ts GET /api/admin/users
import { getDb } from "../../../../../../db/client.ts";
import { listUsers } from "../../../../../../db/lib/accounts.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  return ok(listUsers(getDb()));
}
