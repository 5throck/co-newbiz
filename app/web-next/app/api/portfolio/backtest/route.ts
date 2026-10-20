// GET /api/portfolio/backtest — forecast–actual backtest (ADR-0123 #3).
// Computation lives in lib/backtest.ts (shared with the grade-adjustment
// proposal route): forecast = adopted p50 NPV, actual proxy = scorecard
// attainment × forecast, ±20% band, org-wide bias detection, and the
// kill-with-learning corpus. Display-only learning signal — the only thing it
// feeds is a PROPOSAL a person files and another approves (boundary #2).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { runBacktest } from "../../../../lib/backtest.ts";
import { ok } from "../../../../lib/envelope.ts";
import { visibleProject } from "../../../../lib/project-visibility.ts";

// 품평회 P1 수정 (2026-09-12): 검토/안건별 상세 행은 멤버에게만 — 비멤버에게는
// 프로젝트명 없는 조직 집계(건수·편향 %)만 반환한다 (k≥3 억제 준용).
export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const result = runBacktest(getDb(), (projectId) => Boolean(visibleProject(auth.auth, projectId, { includeClosed: true, includeDeleted: true })));
  return ok(result, 200, { count: result.rows.length });
}
