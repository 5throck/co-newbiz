// 경쟁사 제안 목록 — 최신 프로필 payload의 competitive.competitors를 제안으로
// 조립한다(stateless, 저장 없음 — ADR-0142). 기확정 이름은 accepted 마킹.
import { authenticate } from '../../../../../../lib/auth.ts';
import { notFound, ok } from '../../../../../../lib/envelope.ts';
import { getDb } from '../../../../../../../../db/client.ts';
import { resolveMemberSubject } from '../../../../../../lib/company-profile-pipeline.ts';
import { listCompetitorProposals } from '../../../../../../lib/company-competitors.ts';

export async function GET(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { memberId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM company_group_member WHERE id = ?").get(memberId)) return notFound();
  const proposals = listCompetitorProposals(db, resolveMemberSubject(db, memberId));
  return ok({ proposals }, 200, { proposals: proposals.length });
}
