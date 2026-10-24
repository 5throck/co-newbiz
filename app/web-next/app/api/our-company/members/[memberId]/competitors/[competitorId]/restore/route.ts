// 제외 경쟁사 복원 — 같은 이름의 확정 행이 이미 있으면 거절(duplicate).
import { authenticate, requireBusinessActor } from '../../../../../../../../lib/auth.ts';
import { badRequest, notFound, ok } from '../../../../../../../../lib/envelope.ts';
import { getDb } from '../../../../../../../../../../db/client.ts';
import { resolveMemberSubject } from '../../../../../../../../lib/company-profile-pipeline.ts';
import { restoreCompetitor } from '../../../../../../../../lib/company-competitors.ts';

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string; competitorId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Restoring competitors requires the analyst role or higher." });
  if (denied) return denied;
  const { memberId, competitorId } = await params;
  const db = getDb();
  const { row, duplicate } = restoreCompetitor(db, resolveMemberSubject(db, memberId), competitorId, auth.auth.userId);
  if (!row) return notFound();
  if (duplicate) return badRequest("duplicate_competitor", "A confirmed competitor with the same name already exists.");
  return ok(row);
}
