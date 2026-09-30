// 확정 경쟁사 소프트 제외 — 사유 필수(브라운필드 제외 패턴).
import { authenticate, requireBusinessActor } from '../../../../../../../../lib/auth.ts';
import { badRequest, notFound, ok } from '../../../../../../../../lib/envelope.ts';
import { getDb } from '../../../../../../../../../../db/client.ts';
import { resolveMemberSubject } from '../../../../../../../../lib/company-profile-pipeline.ts';
import { excludeCompetitor } from '../../../../../../../../lib/company-competitors.ts';

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string; competitorId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "경쟁사 제외는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { memberId, competitorId } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  if (!body?.reason?.trim()) return badRequest("reason_required", "제외 사유는 필수입니다.");
  const db = getDb();
  const row = excludeCompetitor(db, resolveMemberSubject(db, memberId), competitorId, body.reason, auth.auth.userId);
  if (!row) return notFound();
  return ok(row);
}
