// POST /api/companies/[companyId]/analyze — 회사(md_company) LLM 프로파일 분석 실행
// (일반화된 company-profile-pipeline, 2026-09-15). 재분석 시 버전+1로 누적.
import { authenticate } from "../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { resolveCompanySubject, startCompanyProfilePipeline } from "../../../../../lib/company-profile-pipeline.ts";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "프로파일 분석은 analyst 역할 이상이어야 합니다.");
  const { companyId } = await params;
  const db = getDb();
  const company = db.query("SELECT id, name_ko FROM md_company WHERE id = ?").get(companyId) as { id: string; name_ko: string } | null;
  if (!company) return notFound();

  // 파이프라인은 in-process 비동기 실행 — 완료된 버전은 목록/상세에서 폴링·재조회.
  startCompanyProfilePipeline(db, resolveCompanySubject(db, companyId), ctx.userId);
  return ok({ company_id: companyId, company: company.name_ko, status: "in_progress" });
}
