// POST /api/companies/[companyId]/analyze — 회사(md_company) LLM 프로파일 분석 실행
// (일반화된 company-profile-pipeline, 2026-09-15). 재분석 시 버전+1로 누적.
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { parseProfileEvidenceBody } from "../../../../../lib/profile-evidence-input.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { resolveCompanySubject, startCompanyProfilePipeline } from "../../../../../lib/company-profile-pipeline.ts";
import { insertTargetEvidence, targetIdsForCompany } from "../../../../../lib/brownfield-targets.ts";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "프로파일 분석은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { companyId } = await params;
  const db = getDb();
  const company = db.query("SELECT id, name_ko FROM md_company WHERE id = ?").get(companyId) as { id: string; name_ko: string } | null;
  if (!company) return notFound();

  // 파이프라인은 in-process 비동기 실행 — 완료된 버전은 목록/상세에서 폴링·재조회.
  const evidence = await parseProfileEvidenceBody(request);
  if (!evidence.ok) return evidence.response;
  appendAudit(db, { actor: ctx.userId, action: `profile.analyze urls=${evidence.sourceUrls.length} note=${evidence.companyNote ? 1 : 0}`, target: `company:${companyId}`, now: new Date().toISOString() });
  startCompanyProfilePipeline(db, resolveCompanySubject(db, companyId), ctx.userId, { sourceUrls: evidence.sourceUrls, companyNote: evidence.companyNote });
  // 재분석 시점 근거 — 이 회사에 연결된 brownfield 후보 전체의 타임라인에
  // 적립한다(사용자 결정, 2026-09-16: 등록·재분석 시 정보를 구조적으로 보존).
  // 분석 결과 본체는 company_profile_version(append-only)에 저장되고 후보 상세
  // SWOT 탭에서 참조된다 — 이 행은 "언제 재분석했는가"의 이벤트 기록이다.
  for (const targetId of targetIdsForCompany(db, companyId)) {
    insertTargetEvidence(db, {
      targetId,
      kind: "analysis",
      title: `회사 AI 프로파일 재분석 실행 — ${company.name_ko}`,
      detail: "완료 시 회사 프로파일 버전(company_profile_version, append-only)으로 저장됩니다 — 후보 상세 SWOT·출처 탭에서 참고할 수 있습니다.",
      sourceKind: "profile",
      createdBy: ctx.userId,
    });
  }
  return ok({ company_id: companyId, company: company.name_ko, status: "in_progress" });
}
