// 제외 경쟁사 복원 (md_company 주체) — 이름 충돌 시 거절.
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { resolveCompanySubject } from "../../../../../../../lib/company-profile-pipeline.ts";
import { restoreCompetitor } from "../../../../../../../lib/company-competitors.ts";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; competitorId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "경쟁사 복원은 analyst 역할 이상이어야 합니다.");
  const { companyId, competitorId } = await params;
  const db = getDb();
  const { row, duplicate } = restoreCompetitor(db, resolveCompanySubject(db, companyId), competitorId, auth.auth.userId);
  if (!row) return notFound();
  if (duplicate) return badRequest("duplicate_competitor", "같은 이름의 확정 경쟁사가 이미 있습니다.");
  return ok(row);
}
