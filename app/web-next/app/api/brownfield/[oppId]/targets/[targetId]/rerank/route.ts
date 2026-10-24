// S7 — Short List 순위 조정. rank는 승격 순서(1..N)로 정규화하며 이웃 행과
// 교환한다. flow.spec S7 산출물 "Target Ranking/Score" 중 순위(rank)는 에이전트
// 점수가 아니라 사람이 확정하는 값이므로, 점수(화면 결정론 산출)와 분리해
// 여기서만 변경한다.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../../lib/envelope.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Rank adjustments require the analyst role or higher." });
  if (denied) return denied;
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as { direction?: string } | null;
  const direction = body?.direction;
  if (direction !== "up" && direction !== "down") {
    return badRequest("invalid_request", "direction must be 'up' or 'down'.");
  }
  const db = getDb();
  const target = db
    .query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ? AND status = 'shortlisted'")
    .get(targetId, oppId) as { id: string } | undefined;
  if (!target) return notFound();

  const rows = db
    .query(
      "SELECT id FROM brownfield_target WHERE opportunity_id = ? AND status = 'shortlisted' ORDER BY COALESCE(rank, 2147483647), created_at",
    )
    .all(oppId) as Array<{ id: string }>;
  const idx = rows.findIndex((r) => r.id === targetId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= rows.length) {
    return ok({ moved: false, rank: idx + 1 }, 200); // 이미 끝자리 — 이동 없음(오류 아님)
  }
  const ids = rows.map((r) => r.id);
  [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
  ids.forEach((id, i) => {
    db.run("UPDATE brownfield_target SET rank = ?, updated_at = ? WHERE id = ?", [i + 1, now(), id]);
  });
  appendAudit(db, { actor: auth.auth.userId, action: "brownfield_target.rerank", target: `${oppId}:${targetId}:${direction}`, now: now() });
  return ok({ moved: true, rank: swapIdx + 1 }, 200);
}
