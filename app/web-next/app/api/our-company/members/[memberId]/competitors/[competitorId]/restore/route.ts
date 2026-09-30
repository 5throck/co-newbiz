// 제외 경쟁사 복원 — 같은 이름의 확정 행이 이미 있으면 거절(duplicate).
import { authenticate, requireBusinessActor } from '../../../../../../../../lib/auth.ts';
import { badRequest, notFound, ok } from '../../../../../../../../lib/envelope.ts';
import { getDb } from '../../../../../../../../../../db/client.ts';
import { resolveMemberSubject } from '../../../../../../../../lib/company-profile-pipeline.ts';
import { restoreCompetitor } from '../../../../../../../../lib/company-competitors.ts';

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string; competitorId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "경쟁사 복원은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { memberId, competitorId } = await params;
  const db = getDb();
  const { row, duplicate } = restoreCompetitor(db, resolveMemberSubject(db, memberId), competitorId, auth.auth.userId);
  if (!row) return notFound();
  if (duplicate) return badRequest("duplicate_competitor", "같은 이름의 확정 경쟁사가 이미 있습니다.");
  return ok(row);
}
