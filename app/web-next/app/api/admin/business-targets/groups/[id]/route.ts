// Admin-side group detail (members + profile rollup) for the Business Targets screen (ADR-0146).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { getGroupDetail } from "../../../../../../lib/our-company-groups.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const { id } = await params;
  const detail = getGroupDetail(getDb(), id);
  if (!detail) return notFound();
  return ok(detail, 200, { member_count: detail.members.length });
}
