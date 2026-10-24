// 확정 경쟁사 소프트 제외 (md_company 주체) — 사유 필수.
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { resolveCompanySubject } from "../../../../../../../lib/company-profile-pipeline.ts";
import { excludeCompetitor } from "../../../../../../../lib/company-competitors.ts";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; competitorId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Excluding competitors requires the analyst role or higher." });
  if (denied) return denied;
  const { companyId, competitorId } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  if (!body?.reason?.trim()) return badRequest("reason_required", "Exclusion reason is required.");
  const db = getDb();
  const row = excludeCompetitor(db, resolveCompanySubject(db, companyId), competitorId, body.reason, auth.auth.userId);
  if (!row) return notFound();
  return ok(row);
}
