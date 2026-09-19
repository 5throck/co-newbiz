// execution-job-handlers.ts — 병렬 실행 계층의 어댑터 레지스트리 (design
// 2026-09-19-sim-engine-runtime-separation §3). 기능은 이곳에 핸들러를
// 등록하고, 워커(scripts/co-newbiz/job-worker.ts)가 kind로 해석해 실행한다.
// 계층 코어(lib/execution-jobs.ts)는 여기 몰라야 한다 — 의존 방향이 어댑터 →
// 코어로 단방향이다(비순환).
import type { Db, ExecutionJobRow, ResourceClass } from "./execution-jobs.ts";

export interface ExecutionJobContext {
  db: Db;
  job: ExecutionJobRow;
}

export interface ExecutionJobHandler {
  resourceClass: ResourceClass;
  /** 작업별 타임아웃(초) — 미지정 시 작업 행의 timeout_sec을 따른다. */
  timeoutSec?: number;
  run: (payload: unknown, ctx: ExecutionJobContext) => Promise<unknown>;
}

const HANDLERS = new Map<string, ExecutionJobHandler>();

export function registerExecutionJobHandler(kind: string, handler: ExecutionJobHandler): void {
  HANDLERS.set(kind, handler);
}

export function getExecutionJobHandler(kind: string): ExecutionJobHandler | undefined {
  return HANDLERS.get(kind);
}

export function registeredJobKinds(): string[] {
  return [...HANDLERS.keys()].sort();
}

// ── 증명용 1종 어댑터 — S1 산업 재분석 ─────────────────────────────
// 재분석 라우트(rerun/route.ts)와 동일한 ADR-0131 보호 모드 진입을 따른다:
// 완료 분석은 status/completed_at을 건드리지 않고 rerun_in_progress·
// current_step만 조작해 기존 완료 버전을 보호한다.
registerExecutionJobHandler("market-sizing.rerun", {
  resourceClass: "llm",
  timeoutSec: 1800,
  async run(payload, { db }) {
    const { analysisId } = (payload ?? {}) as { analysisId?: string };
    if (!analysisId || typeof analysisId !== "string") throw new Error("payload.analysisId가 필요합니다.");
    const analysis = db.query("SELECT id, status FROM market_sizing_analysis WHERE id = ?").get(analysisId) as
      | { id: string; status: string }
      | undefined;
    if (!analysis) throw new Error(`market_sizing_analysis ${analysisId} 을(를) 찾을 수 없습니다.`);
    const now = new Date().toISOString();
    if (analysis.status === "completed") {
      db.run(
        "UPDATE market_sizing_analysis SET rerun_in_progress = 1, error_message = NULL, current_step = 0 WHERE id = ?",
        [analysisId],
      );
    } else {
      db.run(
        "UPDATE market_sizing_analysis SET status = 'in_progress', current_step = 0, completed_at = NULL WHERE id = ?",
        [analysisId],
      );
    }
    const { runSizingPipeline } = await import("./market-sizing-pipeline.ts");
    await runSizingPipeline(db, analysisId);
    const v = db.query("SELECT version_no FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1").get(analysisId) as
      | { version_no: number }
      | undefined;
    return { analysisId, latestVersion: v?.version_no ?? null };
  },
});
