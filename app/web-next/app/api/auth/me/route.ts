// Port of app/server/auth.ts GET /api/auth/me
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const a = auth.auth;
  return ok({ userId: a.userId, role: a.role, via: a.via, scopes: a.scopes, mustChangePassword: a.mustChangePassword });
}
