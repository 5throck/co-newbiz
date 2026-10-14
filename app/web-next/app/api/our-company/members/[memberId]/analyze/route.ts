// 계열사 프로파일 분석 실행 — 재분석 시 버전+1로 누적.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { parseProfileEvidenceBody } from "../../../../../../lib/profile-evidence-input.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { resolveMemberSubject, startCompanyProfilePipeline } from "../../../../../../lib/company-profile-pipeline.ts";

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "프로파일 분석은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { memberId } = await params;
  const db = getDb();
  const member = db
    .query("SELECT id, company_name FROM company_group_member WHERE id = ?")
    .get(memberId) as { id: string; company_name: string } | null;
  if (!member) return notFound();

  // 파이프라인은 in-process 비동기 실행 — 완료된 버전은 목록/상세에서 폴링·재조회.
  // running/failed 상태는 startCompanyProfilePipeline이 기록해 profile 폴링이 실패를 보고한다.
  const evidence = await parseProfileEvidenceBody(request);
  if (!evidence.ok) return evidence.response;
  // The audit entry records the URL count only — never the note text or fetched bodies.
  appendAudit(db, { actor: ctx.userId, action: `profile.analyze urls=${evidence.sourceUrls.length} note=${evidence.companyNote ? 1 : 0}`, target: `member:${memberId}`, now: new Date().toISOString() });
  startCompanyProfilePipeline(db, resolveMemberSubject(db, memberId), ctx.userId, { sourceUrls: evidence.sourceUrls, companyNote: evidence.companyNote });
  return ok({ member_id: memberId, company: member.company_name, status: "in_progress" });
}
