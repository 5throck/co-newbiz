// S7 후보 1건의 재무·기술 평가 판정 목록 (ADR-0139) — 카탈로그의 모든 항목을
// pending으로 채워 반환한다(screeningSummary()의 "누락 항목 기본값" 패턴과 동일).
import { getDb } from "../../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../../lib/envelope.ts";
import { computeEvalScore, targetEvalStates } from "../../../../../../../lib/brownfield-eval-criteria.ts";

export async function GET(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { oppId, targetId } = await params;
  const db = getDb();
  const target = db.query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?").get(targetId, oppId) as { id: string } | undefined;
  if (!target) return notFound();
  const items = targetEvalStates(oppId, targetId, auth.auth.userId);
  const scores = computeEvalScore(items);
  return ok({ items, scores }, 200, { count: items.length });
}
