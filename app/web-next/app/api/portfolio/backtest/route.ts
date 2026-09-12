// GET /api/portfolio/backtest — forecast–actual backtest (ADR-0123 #3).
// For every promoted project with an adopted business case: forecast = adopted
// simulation p50 NPV; actual proxy = latest financial scorecard attainment
// ratio. Insufficient scorecard evidence degrades to insufficient_evidence —
// never fabricated. Display-only learning signal.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { latestAdoption } from "../../../../lib/business-case.ts";
import { ok } from "../../../../lib/envelope.ts";
import { visibleProject } from "../../../../lib/project-visibility.ts";

// 품평회 P1 수정 (2026-09-12): 딜별 상세 행은 멤버에게만 — 비멤버에게는
// 프로젝트명 없는 조직 집계(건수·편향 %)만 반환한다 (k≥3 억제 준용).
export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const projects = db.query(
    "SELECT id, project_no, project_name FROM md_project WHERE deleted_at IS NULL AND closed_at IS NULL",
  ).all() as Array<{ id: string; project_no: string; project_name: string | null }>;
  const rows: Array<Record<string, unknown>> = [];
  let scored = 0, within = 0, outlier = 0, insufficient = 0, devSum = 0, devN = 0;
  for (const p of projects) {
    const adoption = latestAdoption(p.id);
    if (!adoption) continue;
    const sim = db.query(
      `SELECT percentile, npv_krw_m FROM valuation_simulation
       WHERE model_id = ? AND percentile = 'p50' ORDER BY created_at DESC LIMIT 1`,
    ).get(adoption.modelId) as { npv_krw_m: number } | undefined;
    if (!sim) continue;
    const attainment = db.query(
      `SELECT AVG(CASE
         WHEN target_value IS NULL OR actual_value IS NULL OR target_value = '' OR actual_value = '' THEN NULL
         ELSE CAST(REPLACE(actual_value, ',', '') AS REAL) / NULLIF(CAST(REPLACE(target_value, ',', '') AS REAL), 0)
       END) AS ratio
       FROM venture_scorecard WHERE project_id = ? AND section = 'financial'`,
    ).get(p.id) as { ratio: number | null };
    const visible = visibleProject(auth.auth, p.id, { includeClosed: true, includeDeleted: true });
    if (attainment.ratio === null || !Number.isFinite(attainment.ratio)) {
      insufficient += 1;
      if (visible) rows.push({ project_id: p.id, project_no: p.project_no, name: p.project_name ?? p.project_no,
        forecast_npv_krw_m: sim.npv_krw_m, status: "insufficient_evidence" });
      continue;
    }
    const actual = Math.round(sim.npv_krw_m * attainment.ratio);
    const deviation = Math.round(((actual - sim.npv_krw_m) / sim.npv_krw_m) * 1000) / 10;
    scored += 1; devSum += Math.abs(deviation); devN += 1;
    if (Math.abs(deviation) <= 20) within += 1; else outlier += 1;
    if (visible) rows.push({ project_id: p.id, project_no: p.project_no, name: p.project_name ?? p.project_no,
      forecast_npv_krw_m: sim.npv_krw_m, actual_npv_krw_m: actual, deviation_pct: deviation,
      status: Math.abs(deviation) <= 20 ? "within_band" : "outlier" });
  }
  return ok({
    rows,
    org: {
      scored, within, outlier, insufficient,
      avg_abs_deviation_pct: devN ? Math.round((devSum / devN) * 10) / 10 : null,
    },
  }, 200, { count: rows.length });
}
