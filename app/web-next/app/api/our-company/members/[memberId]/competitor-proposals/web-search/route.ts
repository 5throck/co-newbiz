// 경쟁사 웹검색 재제안 — 실검색 근거 기반 후보 도출(ADR-0142 후속, 브라운필드
// web-search 사다리 준용). 저장은 없다 — 수용은 사람.
import { authenticate } from "../../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { resolveMemberSubject } from "../../../../../../../lib/company-profile-pipeline.ts";
import { webSearchCompetitorProposals } from "../../../../../../../lib/competitor-web-proposals.ts";

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "웹검색 제안 생성은 analyst 역할 이상이어야 합니다.");
  const { memberId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM company_group_member WHERE id = ?").get(memberId)) return notFound();
  const result = await webSearchCompetitorProposals(db, resolveMemberSubject(db, memberId), auth.auth.userId);
  return ok(result, 200, { suggestions: result.suggestions.length });
}
