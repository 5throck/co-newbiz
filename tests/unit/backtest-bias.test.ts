// backtest-bias (2026-10-21 S9 depth, ADR-0123 #3) — systematic-bias detection
// over signed deviations. Under three samples is insufficient evidence; the
// suggested grade is a hint for a human proposal, never an automatic grade.
import { describe, expect, test } from "bun:test";
import { BIAS_THRESHOLD_PP, computeBias, MIN_SAMPLE, SEVERE_BIAS_PP } from "../../app/web-next/lib/backtest-bias.ts";

describe("computeBias", () => {
  test("fewer than MIN_SAMPLE deviations → insufficient_evidence, no mean, no suggestion", () => {
    expect(MIN_SAMPLE).toBe(3);
    const b = computeBias([-30, -40]);
    expect(b).toMatchObject({ n: 2, direction: "insufficient_evidence", mean_signed_deviation_pct: null, suggested_grade: null, over_forecast_count: 2 });
  });

  test("systematic over-forecast (negative mean) beyond the severe line suggests C; milder suggests B", () => {
    expect(BIAS_THRESHOLD_PP).toBe(10);
    expect(SEVERE_BIAS_PP).toBe(20);
    const severe = computeBias([-25, -30, -20, -15]);
    expect(severe).toMatchObject({ n: 4, direction: "over_forecast", suggested_grade: "C", over_forecast_count: 4, under_forecast_count: 0 });
    expect(severe.mean_signed_deviation_pct).toBe(-22.5);
    expect(severe.median_signed_deviation_pct).toBe(-22.5);
    const mild = computeBias([-12, -14, -10]);
    expect(mild).toMatchObject({ direction: "over_forecast", suggested_grade: "B" });
  });

  test("under-forecast and balanced never suggest a grade cap", () => {
    expect(computeBias([15, 20, 12])).toMatchObject({ direction: "under_forecast", suggested_grade: null });
    expect(computeBias([-5, 4, 3, -2])).toMatchObject({ direction: "balanced", suggested_grade: null });
  });

  test("non-finite inputs are ignored", () => {
    expect(computeBias([Number.NaN, -20, -30, -25]).n).toBe(3);
  });
});
