// 경쟁사 제안 목록 (md_company 주체 — 브라운필드 타겟 등) — member 라우트와
// 동일 계약, 공유 lib만 다른 주체로 호출(ADR-0142).
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { resolveCompanySubject } from "../../../../../lib/company-profile-pipeline.ts";
import { listCompetitorProposals } from "../../../../../lib/company-competitors.ts";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { companyId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM md_company WHERE id = ?").get(companyId)) return notFound();
  const proposals = listCompetitorProposals(db, resolveCompanySubject(db, companyId));
  return ok({ proposals }, 200, { proposals: proposals.length });
}
