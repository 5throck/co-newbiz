// 2026-10-16 (ADR-0178 follow-up): pure derivation of an S5 plan snapshot's total capex
// (백만원). The scenario-comparison IRR chip and the S5 연결 warning both need the same
// one number — does the plan in force carry ANY capex? Display only: never recomputes a
// case, never blocks a gate. null means "cannot tell" (no active pin / migration pending);
// a resolved plan without capex lines is 0, not null.
import type { LooseDb } from "./s5-plan-pin-s8.ts";
import { resolveActivePin } from "./s5-plan-pin-s8.ts";
import { pinPlanLinesOf, aggregatePlanLines } from "./s5-plan-pin.ts";
import type { InvestmentVectorsInput } from "./investment-vectors.ts";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whole-plan capex total of one snapshot input (plan years + pre-launch year-0), 백만원. */
export function planCapexTotalOf(input: InvestmentVectorsInput): number {
  const { horizon, lines } = pinPlanLinesOf(input);
  const agg = aggregatePlanLines(horizon, lines);
  return round2(agg.capexByYear.reduce((a, b) => a + b, 0) + (agg.preLaunchKrwM ?? 0));
}

/**
 * Capex total of the plan S8 actually uses (the active pin, per the amended default), or
 * null when there is no active pin or the snapshot cannot be read.
 */
export function pinnedPlanCapexTotal(db: LooseDb, projectId: string): number | null {
  try {
    const active = resolveActivePin(db, projectId);
    return active ? planCapexTotalOf(active.input) : null;
  } catch {
    return null;
  }
}
