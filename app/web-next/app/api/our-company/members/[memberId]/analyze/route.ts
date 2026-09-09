// 계열사 프로파일 분석 실행 — 재분석 시 버전+1로 누적.
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { startCompanyProfilePipeline } from "../../../../../../lib/company-profile-pipeline.ts";

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "프로파일 분석은 analyst 역할 이상이어야 합니다.");
  const { memberId } = await params;
  const db = getDb();
  const member = db
    .query("SELECT id, company_name FROM company_group_member WHERE id = ?")
    .get(memberId) as { id: string; company_name: string } | null;
  if (!member) return notFound();

  // 파이프라인은 in-process 비동기 실행 — 완료된 버전은 목록/상세에서 폴링·재조회.
  // running/failed 상태는 startCompanyProfilePipeline이 기록해 profile 폴링이 실패를 보고한다.
  startCompanyProfilePipeline(db, memberId, ctx.userId);
  return ok({ member_id: memberId, company: member.company_name, status: "in_progress" });
}
