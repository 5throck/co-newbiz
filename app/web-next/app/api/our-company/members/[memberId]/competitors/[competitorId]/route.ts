// 확정 경쟁사 비고·DART 코드 수정 — 상태 전환은 exclude/restore 라우트로.
import { authenticate, requireBusinessActor } from '../../../../../../../lib/auth.ts';
import { notFound, ok } from '../../../../../../../lib/envelope.ts';
import { getDb } from '../../../../../../../../../db/client.ts';
import { resolveMemberSubject } from '../../../../../../../lib/company-profile-pipeline.ts';
import { updateCompetitor } from '../../../../../../../lib/company-competitors.ts';

export async function PATCH(request: Request, { params }: { params: Promise<{ memberId: string; competitorId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "경쟁사 수정은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { memberId, competitorId } = await params;
  const body = (await request.json().catch(() => null)) as { note?: string | null; dart_corp_code?: string | null } | null;
  const db = getDb();
  const row = updateCompetitor(db, resolveMemberSubject(db, memberId), competitorId, { note: body?.note, dart_corp_code: body?.dart_corp_code }, auth.auth.userId);
  if (!row) return notFound();
  return ok(row);
}
