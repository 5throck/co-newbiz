// @version 1.0.0
/**
 * backtest-bias — ADR-0123 #3: the forecast–actual backtest detects
 * SYSTEMATIC bias (e.g. over-forecasting) and feeds it to the data-confidence
 * grade as a PROPOSAL a person approves (never an automatic rewrite —
 * "Alternatives rejected"). Pure arithmetic over the per-deal deviations the
 * backtest route already computes: deviation_pct = (actual − forecast) /
 * forecast × 100, so a negative mean means forecasts ran above outcomes.
 * Fewer than MIN_SAMPLE deviations is insufficient_evidence — three numbers
 * are not a bias.
 */

export const MIN_SAMPLE = 3;
/** |mean signed deviation| at or above this (pp) is a directional bias. */
export const BIAS_THRESHOLD_PP = 10;
/** Over-forecast at or beyond this (pp) suggests grade C; between threshold and this, B. */
export const SEVERE_BIAS_PP = 20;

export type BiasDirection = "over_forecast" | "under_forecast" | "balanced" | "insufficient_evidence";

export interface BacktestBias {
  n: number;
  mean_signed_deviation_pct: number | null;
  median_signed_deviation_pct: number | null;
  over_forecast_count: number;
  under_forecast_count: number;
  direction: BiasDirection;
  /** Grade the bias SUGGESTS for the data-confidence cap — a hint for the person filing a proposal, not a decision. */
  suggested_grade: "B" | "C" | null;
}

export function computeBias(deviations: number[]): BacktestBias {
  const xs = deviations.filter((d) => Number.isFinite(d));
  const n = xs.length;
  const over = xs.filter((d) => d < 0).length;
  const under = xs.filter((d) => d > 0).length;
  if (n < MIN_SAMPLE) {
    return { n, mean_signed_deviation_pct: null, median_signed_deviation_pct: null, over_forecast_count: over, under_forecast_count: under, direction: "insufficient_evidence", suggested_grade: null };
  }
  const mean = Math.round((xs.reduce((a, b) => a + b, 0) / n) * 10) / 10;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = Math.round((n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  let direction: BiasDirection = "balanced";
  if (mean <= -BIAS_THRESHOLD_PP) direction = "over_forecast";
  else if (mean >= BIAS_THRESHOLD_PP) direction = "under_forecast";
  const suggested_grade = direction === "over_forecast" ? (mean <= -SEVERE_BIAS_PP ? "C" : "B") : null;
  return { n, mean_signed_deviation_pct: mean, median_signed_deviation_pct: median, over_forecast_count: over, under_forecast_count: under, direction, suggested_grade };
}
