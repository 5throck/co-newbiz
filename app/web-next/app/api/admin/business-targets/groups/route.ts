// Admin-side group list for the Business Targets screen (ADR-0146): admin is
// rejected on /api/our-company/* reads, so the screen reads groups here.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { ok } from "../../../../../lib/envelope.ts";
import { listGroups } from "../../../../../lib/our-company-groups.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const groups = listGroups(getDb());
  return ok({ groups }, 200, { count: groups.length });
}
