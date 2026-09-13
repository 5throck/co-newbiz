// 재분석 (re-run) — 분석 실패로 다시 진행하거나, 분석일이 오래되어 데이터를
// 갱신할 때 기존 analysis를 in_progress로 되돌리고 파이프라인을 새 버전으로
// 재실행한다. 버전은 append-only(버전 N+1)로 쌓이며 기존 버전은 유지된다.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { runSizingPipeline, cancelPendingDependents } from "../../../../../../lib/market-sizing-pipeline.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "재분석은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const db = getDb();

  const analysis = db
    .query("SELECT id, status, industry_id, after_analysis_id FROM market_sizing_analysis WHERE id = ?")
    .get(id) as { id: string; status: string; industry_id: string; after_analysis_id: string | null } | null;
  if (!analysis) return notFound();
  if (analysis.status === "in_progress") {
    return ok({ analysis_id: id, status: "in_progress", reused: true }, 200, { alreadyRunning: true });
  }
  if (analysis.status === "pending") {
    // 대기 중인 연계 분석을 rerun으로 띄워넘을 수 없다 — 앵커 완료 후 직렬 시작이 계약이다.
    return ok({ analysis_id: id, status: "pending", reused: true }, 200, { alreadyQueued: true });
  }

  const now = new Date().toISOString();
  // 루트 재분석 시작 시 이전 세대의 대기 연계는 모두 취소한다(백엔드 패널 P1-4 —
  // 좀비 대기 방지). 재분석 완료 후 사용자가 모달에서 다시 선택한다.
  cancelPendingDependents(db, id, "루트 재분석으로 대기 취소 — 재분석 완료 후 다시 선택하세요.");
  db.run(
    "UPDATE market_sizing_analysis SET status = 'in_progress', current_step = 0, completed_at = NULL, started_at = ? WHERE id = ?",
    [now, id],
  );
  appendAudit(db, { actor: ctx.userId, action: "market_sizing_analysis.rerun", target: id, now });

  void runSizingPipeline(db, id).catch((err) => {
    console.error("market-sizing pipeline rerun failed:", err);
    // Defense in depth: see analyses/route.ts POST for rationale.
    try {
      db.run(
        "UPDATE market_sizing_analysis SET status = 'failed', error_message = ? WHERE id = ? AND status = 'in_progress'",
        [(err instanceof Error ? err.message : String(err)).slice(0, 2000), id],
      );
    } catch (dbErr) {
      console.error("market-sizing pipeline: failed to mark analysis failed:", dbErr);
    }
  });

  return ok({ analysis_id: id, status: "in_progress" }, 200, { rerun: true });
}
