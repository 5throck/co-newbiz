// 재분석 (re-run) — 분석 실패로 다시 진행하거나, 분석일이 오래되어 데이터를
// 갱신할 때 기존 analysis를 in_progress로 되돌리고 파이프라인을 새 버전으로
// 재실행한다. 버전은 append-only(버전 N+1)로 쌓이며 기존 버전은 유지된다.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { runSizingPipeline, cancelPendingDependents } from "../../../../../../lib/market-sizing-pipeline.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Re-analysis requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  const db = getDb();

  const analysis = db
    .query("SELECT id, status, industry_id, after_analysis_id, rerun_in_progress FROM market_sizing_analysis WHERE id = ?")
    .get(id) as { id: string; status: string; industry_id: string; after_analysis_id: string | null; rerun_in_progress: number } | null;
  if (!analysis) return notFound();
  if (analysis.status === "in_progress") {
    return ok({ analysis_id: id, status: "in_progress", reused: true }, 200, { alreadyRunning: true });
  }
  if (analysis.status === "pending") {
    // 대기 중인 연계 분석을 rerun으로 띄워넘을 수 없다 — 앵커 완료 후 직렬 시작이 계약이다.
    return ok({ analysis_id: id, status: "pending", reused: true }, 200, { alreadyQueued: true });
  }
  if (analysis.rerun_in_progress) {
    // 보호 모드 재분석 도중엔 status가 'completed'로 그대로 남아 위 in_progress
    // 체크를 통과한다 — 이 플래그를 따로 안 보면 같은 분석에 두 번째 파이프라인
    // 실행이 겹쳐 붙어(current_step 경쟁, 버전 중복) 돌아갈 수 있다.
    return ok({ analysis_id: id, status: "completed", reused: true }, 200, { alreadyRunning: true });
  }

  const now = new Date().toISOString();
  // 루트 재분석 시작 시 이전 세대의 대기 연계는 모두 취소한다(백엔드 패널 P1-4 —
  // 좀비 대기 방지). 재분석 완료 후 사용자가 모달에서 다시 선택한다.
  cancelPendingDependents(db, id, "루트 재분석으로 대기 취소 — 재분석 완료 후 다시 선택하세요.");

  // ADR-0131 — 이미 완료된 분석을 재분석할 때는 status/completed_at을 건드리지
  // 않는다. 재분석 도중이나 실패 시에도 "최신 완료 버전" 조회 쿼리(전부
  // status='completed' 기준)가 계속 기존(좋은) 버전을 가리키게 하기 위함이다.
  // 진행 상태는 별도의 rerun_in_progress 플래그로만 추적한다 — 파이프라인이
  // 신뢰할 수 있는 결과를 낼 때만(market-sizing-pipeline.ts) status/completed_at을
  // 새 버전으로 "교체"한다. 완료된 적 없는(failed, 버전 없음) 분석은 보호할
  // 기존 데이터가 없으므로 기존 방식(즉시 in_progress 전환)을 유지한다.
  const protectPriorVersion = analysis.status === "completed";
  if (protectPriorVersion) {
    // current_step도 0으로 되돌린다 — 안 그러면 지난 실행에서 8(완료)로 남아있던
    // 값이 이번 재분석 진행률로 잘못 읽힌다(1단계가 실제로 advance()를 부를
    // 때까지 "8/8"로 보이는 구간이 생김). status/completed_at과 달리
    // current_step은 진행률 표시에만 쓰여 보호할 이유가 없다.
    db.run(
      "UPDATE market_sizing_analysis SET rerun_in_progress = 1, error_message = NULL, started_at = ?, current_step = 0 WHERE id = ?",
      [now, id],
    );
  } else {
    db.run(
      "UPDATE market_sizing_analysis SET status = 'in_progress', current_step = 0, completed_at = NULL, started_at = ? WHERE id = ?",
      [now, id],
    );
  }
  appendAudit(db, { actor: ctx.userId, action: "market_sizing_analysis.rerun", target: id, now });

  void runSizingPipeline(db, id).catch((err) => {
    console.error("market-sizing pipeline rerun failed:", err);
    // Defense in depth: see analyses/route.ts POST for rationale.
    try {
      if (protectPriorVersion) {
        // status/completed_at은 손대지 않는다 — 이전 완료 버전이 계속 "최신"으로 보인다.
        db.run(
          "UPDATE market_sizing_analysis SET rerun_in_progress = 0, error_message = ? WHERE id = ?",
          [(err instanceof Error ? err.message : String(err)).slice(0, 2000), id],
        );
      } else {
        db.run(
          "UPDATE market_sizing_analysis SET status = 'failed', error_message = ? WHERE id = ? AND status = 'in_progress'",
          [(err instanceof Error ? err.message : String(err)).slice(0, 2000), id],
        );
      }
    } catch (dbErr) {
      console.error("market-sizing pipeline: failed to mark analysis failed:", dbErr);
    }
  });

  return ok({ analysis_id: id, status: protectPriorVersion ? "completed" : "in_progress" }, 200, { rerun: true, rerunInProgress: protectPriorVersion });
}
