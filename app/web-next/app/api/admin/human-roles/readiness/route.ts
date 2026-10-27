// GET /api/admin/human-roles/readiness - enforce-readiness of the maker/checker contract (ADR-0186 O-1, security
// review J5): per IC reviewer role the number of distinct active grant holders against the required two, the
// current maker_checker mode, and warnings when the mode is enforce but a role cannot be staffed twice.
// Admin only; read-only; reports, never changes anything.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { ok } from "../../../../../lib/envelope.ts";
import { makerCheckerReadiness } from "../../../../../lib/gate-readiness.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  return ok(makerCheckerReadiness(getDb()));
});
