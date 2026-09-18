// 경쟁사 웹검색 재제안 (md_company 주체) — member 라우트와 동일 계약.
import { authenticate } from "../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { resolveCompanySubject } from "../../../../../../lib/company-profile-pipeline.ts";
import { webSearchCompetitorProposals } from "../../../../../../lib/competitor-web-proposals.ts";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "웹검색 제안 생성은 analyst 역할 이상이어야 합니다.");
  const { companyId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM md_company WHERE id = ?").get(companyId)) return notFound();
  const result = await webSearchCompetitorProposals(db, resolveCompanySubject(db, companyId), auth.auth.userId);
  return ok(result, 200, { suggestions: result.suggestions.length });
}
