// ADR-0179 slice 3 — sourced-market-share labelling and the Y1 revenue vs
// plan-investment ratio plausibility guard (design §6.1, §7.1). A bare-default
// capture rate (CAPTURE_RATE 0.005 with no person-set bc.capture_rate) is
// labelled `근거 없는 기본 점유율` wherever the share is shown, and a
// market-anchored generation that used it stamps `; share_unsourced=1` into
// the run note. The ratio guard flags Y1 revenue / plan investment above 20×
// (OPEN-7) with a display warning that says "check the anchor" — never "the
// case is wrong". Both are DISPLAY METADATA ONLY: they never block
// generation, a gate, or a grade, and both note fragments are appended ONLY
// when they fire so legacy notes stay byte-identical (same discipline as
// lib/irr-guard.ts and lib/anchor-scope.ts).

import type { Database } from "bun:sqlite";

/** Governance wording owned by process-governance-manager (design §6.3). */
export const SHARE_UN_SOURCED_LABEL = "근거 없는 기본 점유율";

/** Standalone display label — the value is spelled out so the label reads
 *  complete where the number is not already adjacent. */
export function shareUnsourcedLabel(captureRate: number): string {
  return `${SHARE_UN_SOURCED_LABEL} (${(captureRate * 100).toFixed(1)}%)`;
}

/** Display-side provenance rewrite: the bare default's source text
 *  ("기본값") renders as the unsourced label everywhere the share is shown;
 *  a person-confirmed source passes through untouched. */
export function captureSourceLabel(captureSource: string | null | undefined, captureRate: number): string {
  return captureSource === "기본값" ? shareUnsourcedLabel(captureRate) : captureSource ?? "";
}

/** True when the capture rate in force is the bare default (no person-set
 *  source). The default VALUE stays — the fix is labelling, not removal. */
export function isShareUnsourced(captureSource: string | null | undefined): boolean {
  return captureSource === "기본값";
}

/** Run-note fragment (design §6.1): appended ONLY when a market-anchored run
 *  (no company revenue anchor — anchored cases have no share to be unsourced)
 *  used the bare default. Notes without the trigger stay byte-identical. */
export function shareUnsourcedNoteFragment(hasRevenueAnchor: boolean, captureSource: string | null | undefined): string {
  return !hasRevenueAnchor && isShareUnsourced(captureSource) ? "; share_unsourced=1" : "";
}

// ── Y1 revenue vs plan-investment ratio guard (design §7.1) ────────────────

/** Display threshold (OPEN-7 recommendation): Y1 revenue more than 20× the
 *  plan investment means the market anchor (or the capex plan) deserves a
 *  look. Tunable constant; deliberately generous to avoid alert fatigue. */
export const Y1_INVESTMENT_RATIO_THRESHOLD = 20;

export const RATIO_GUARD_LABEL = "매출 대비 투자비 과소 가능 — 시장 앵커 점검 필요";

/** Diagnostic pointer, same style as the IRR guard's — the reviewer should
 *  know WHAT to check, and the wording says "check", never "wrong". */
export const RATIO_GUARD_DIAGNOSTIC =
  "1차년도 매출이 계획 투자비의 20배를 넘습니다 — 시장 앵커(범위·점유율)와 투자 계획(과소 계상 여부)을 점검하세요. 참고 정보이며 승인 조건이 아닙니다.";

/** Pure band check (mirrors irrGuardBand's contract): tripped strictly above
 *  the threshold; zero/absent investment or junk input never trips. */
export function ratioGuardTripped(y1Revenue: number | null | undefined, planInvestment: number | null | undefined, threshold: number = Y1_INVESTMENT_RATIO_THRESHOLD): boolean {
  if (y1Revenue == null || planInvestment == null || !Number.isFinite(y1Revenue) || !Number.isFinite(planInvestment)) return false;
  if (planInvestment <= 0 || y1Revenue <= 0) return false;
  return y1Revenue / planInvestment > threshold;
}

export interface RatioGuardFlag {
  tripped: boolean;
  /** y1Revenue / planInvestment; null when the investment is zero/unknown. */
  ratio: number | null;
  threshold: number;
  y1_revenue_krw_m: number | null;
  investment_krw_m: number | null;
  investment_source: string | null;
  label: string;
  diagnostic: string;
}

/** Live read-model truth (design §7): recomputed from the latest valuation
 *  model's stored snapshot (`inputs_json` — the execution contract of the
 *  run, so the ratio is what THAT case actually used, not a re-derivation
 *  from params that may have changed since). Tolerant by contract: a missing
 *  model or an unparsable snapshot yields null / untripped, never a throw —
 *  a read can never break on it. Display/evidence only; never blocks. */
export function resolveRatioGuardFlag(db: Database, projectId: string, threshold: number = Y1_INVESTMENT_RATIO_THRESHOLD): RatioGuardFlag | null {
  const model = db
    .query(
      "SELECT inputs_json FROM business_case_model WHERE project_id = ? AND kind = 'valuation' AND inputs_json IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(projectId) as { inputs_json: string } | undefined;
  if (!model) return null;
  let spec: unknown;
  try {
    spec = JSON.parse(model.inputs_json);
  } catch {
    return null;
  }
  const case0 = (spec as { cases?: Array<Record<string, unknown>> }).cases?.[0];
  if (!case0) return null;
  const drivers = case0.drivers as
    | { revenue_y1?: { value?: number }; initial_investment?: { value?: number; source?: string } }
    | undefined;
  const y1 = drivers?.revenue_y1?.value;
  const init = drivers?.initial_investment;
  const y1v = typeof y1 === "number" && Number.isFinite(y1) ? y1 : null;
  const inv = init && typeof init.value === "number" && Number.isFinite(init.value) ? init.value : null;
  const ratio = y1v != null && inv != null && inv > 0 ? y1v / inv : null;
  return {
    tripped: ratioGuardTripped(y1v, inv, threshold),
    ratio,
    threshold,
    y1_revenue_krw_m: y1v,
    investment_krw_m: inv,
    investment_source: typeof init?.source === "string" ? init.source : null,
    label: RATIO_GUARD_LABEL,
    diagnostic: RATIO_GUARD_DIAGNOSTIC,
  };
}
