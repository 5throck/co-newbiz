// @version 1.0.0
/**
 * backtest — forecast–actual backtest (ADR-0123 #3), shared by
 * GET /api/portfolio/backtest and the grade-adjustment proposal route. For
 * every promoted project with an adopted business case: forecast = adopted
 * simulation p50 NPV; actual proxy = latest financial scorecard attainment
 * ratio × forecast. Insufficient scorecard evidence degrades to
 * insufficient_evidence — never fabricated. The corpus includes projects
 * closed with a kill_with_learning_captured decision (ADR-0123: learnings
 * from cancelled/failed deals are part of the corpus), labelled `killed`.
 */
import type { getDb } from "../../../db/client.ts";
import { latestAdoption } from "./business-case.ts";
import { computeBias, type BacktestBias } from "./backtest-bias.ts";

type Db = ReturnType<typeof getDb>;

export const WITHIN_BAND_PCT = 20;

export interface BacktestRow {
  project_id: string;
  project_no: string;
  name: string;
  corpus: "active" | "killed";
  forecast_npv_krw_m: number;
  actual_npv_krw_m?: number;
  deviation_pct?: number;
  status: "within_band" | "outlier" | "insufficient_evidence";
}

export interface BacktestOrg {
  scored: number;
  within: number;
  outlier: number;
  insufficient: number;
  killed_in_corpus: number;
  avg_abs_deviation_pct: number | null;
  bias: BacktestBias;
}

export interface BacktestResult {
  /** Detail rows — only for projects the caller may see (membership-gated by the caller's predicate). */
  rows: BacktestRow[];
  org: BacktestOrg;
}

export function runBacktest(db: Db, visible: (projectId: string) => boolean): BacktestResult {
  const projects = db
    .query(
      `SELECT p.id, p.project_no, p.project_name, p.closed_at,
              EXISTS (SELECT 1 FROM venture_transition_decision v
                      WHERE v.project_id = p.id AND v.decision = 'kill_with_learning_captured') AS killed
       FROM md_project p
       WHERE p.deleted_at IS NULL AND (p.closed_at IS NULL OR EXISTS (
         SELECT 1 FROM venture_transition_decision v WHERE v.project_id = p.id AND v.decision = 'kill_with_learning_captured'))`,
    )
    .all() as Array<{ id: string; project_no: string; project_name: string | null; closed_at: string | null; killed: number }>;
  const rows: BacktestRow[] = [];
  const deviations: number[] = [];
  let scored = 0, within = 0, outlier = 0, insufficient = 0, killedInCorpus = 0, devSum = 0;
  for (const p of projects) {
    const adoption = latestAdoption(p.id);
    if (!adoption) continue;
    const sim = db
      .query(
        `SELECT percentile, npv_krw_m FROM valuation_simulation
         WHERE model_id = ? AND percentile = 'p50' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(adoption.modelId) as { npv_krw_m: number } | undefined;
    if (!sim) continue;
    const corpus: BacktestRow["corpus"] = p.killed ? "killed" : "active";
    if (p.killed) killedInCorpus += 1;
    const attainment = db
      .query(
        `SELECT AVG(CASE
           WHEN target_value IS NULL OR actual_value IS NULL OR target_value = '' OR actual_value = '' THEN NULL
           ELSE CAST(REPLACE(actual_value, ',', '') AS REAL) / NULLIF(CAST(REPLACE(target_value, ',', '') AS REAL), 0)
         END) AS ratio
         FROM venture_scorecard WHERE project_id = ? AND section = 'financial'`,
      )
      .get(p.id) as { ratio: number | null };
    const isVisible = visible(p.id);
    const base = { project_id: p.id, project_no: p.project_no, name: p.project_name ?? p.project_no, corpus, forecast_npv_krw_m: sim.npv_krw_m };
    if (attainment.ratio === null || !Number.isFinite(attainment.ratio)) {
      insufficient += 1;
      if (isVisible) rows.push({ ...base, status: "insufficient_evidence" });
      continue;
    }
    const actual = Math.round(sim.npv_krw_m * attainment.ratio);
    const deviation = sim.npv_krw_m === 0 ? 0 : Math.round(((actual - sim.npv_krw_m) / sim.npv_krw_m) * 1000) / 10;
    scored += 1;
    devSum += Math.abs(deviation);
    deviations.push(deviation);
    if (Math.abs(deviation) <= WITHIN_BAND_PCT) within += 1; else outlier += 1;
    if (isVisible) rows.push({ ...base, actual_npv_krw_m: actual, deviation_pct: deviation, status: Math.abs(deviation) <= WITHIN_BAND_PCT ? "within_band" : "outlier" });
  }
  return {
    rows,
    org: {
      scored, within, outlier, insufficient, killed_in_corpus: killedInCorpus,
      avg_abs_deviation_pct: scored ? Math.round((devSum / scored) * 10) / 10 : null,
      bias: computeBias(deviations),
    },
  };
}
