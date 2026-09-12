// GET /api/portfolio/backtest — forecast–actual backtest (ADR-0123 #3).
// For every promoted project with an adopted business case: forecast = adopted
// simulation p50 NPV; actual proxy = latest financial scorecard attainment
// ratio. Insufficient scorecard evidence degrades to insufficient_evidence —
// never fabricated. Display-only learning signal.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { latestAdoption } from "../../../../lib/business-case.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const projects = db.query(
    "SELECT id, project_no, project_name FROM md_project WHERE deleted_at IS NULL AND closed_at IS NULL",
  ).all() as Array<{ id: string; project_no: string; project_name: string | null }>;
  const rows: Array<Record<string, unknown>> = [];
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
    if (attainment.ratio === null || !Number.isFinite(attainment.ratio)) {
      rows.push({ project_id: p.id, project_no: p.project_no, name: p.project_name ?? p.project_no,
        forecast_npv_krw_m: sim.npv_krw_m, status: "insufficient_evidence" });
      continue;
    }
    const actual = Math.round(sim.npv_krw_m * attainment.ratio);
    const deviation = Math.round(((actual - sim.npv_krw_m) / sim.npv_krw_m) * 1000) / 10;
    rows.push({ project_id: p.id, project_no: p.project_no, name: p.project_name ?? p.project_no,
      forecast_npv_krw_m: sim.npv_krw_m, actual_npv_krw_m: actual, deviation_pct: deviation,
      status: Math.abs(deviation) <= 20 ? "within_band" : "outlier" });
  }
  return ok({ rows }, 200, { count: rows.length });
}
