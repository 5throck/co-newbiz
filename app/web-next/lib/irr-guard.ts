// ADR-0179 slice 1 — IRR ceiling review guard (design §7). An IRR above the
// flag threshold (default 100%/yr) is treated as an EXTREME VALUE — almost
// always an assumption artifact (market scope narrower than the anchor,
// unsourced share, undersized capex), not a real deal. Above the caution
// threshold (default 50%/yr) it gets a softer caution. Both thresholds are
// person-settable project assumptions (bc.irr_flag_threshold /
// bc.irr_caution_threshold, stored as ratios) and the guard is DISPLAY
// METADATA ONLY — it never blocks generation, a gate, or a grade, and the
// run-note fragment is appended only when the guard actually trips so legacy
// notes stay byte-identical.

export const IRR_FLAG_THRESHOLD_DEFAULT = 1.0; // 100%/yr, ratio
export const IRR_CAUTION_THRESHOLD_DEFAULT = 0.5; // 50%/yr, ratio

export type IrrGuardBand = "extreme" | "caution";

/** Band for a single IRR (ratio). null = within normal range. Thresholds are
 *  inclusive (irr >= flag → extreme; else irr >= caution → caution). */
export function irrGuardBand(
  irr: number | null | undefined,
  flagThreshold: number = IRR_FLAG_THRESHOLD_DEFAULT,
  cautionThreshold: number = IRR_CAUTION_THRESHOLD_DEFAULT,
): IrrGuardBand | null {
  if (irr == null || !Number.isFinite(irr)) return null;
  if (irr >= flagThreshold) return "extreme";
  if (irr >= cautionThreshold) return "caution";
  return null;
}

export const IRR_GUARD_CHIP_LABEL: Record<IrrGuardBand, string> = {
  extreme: "극단값 — 검토 필요",
  caution: "주의",
};

/** Diagnostic pointer (design §7): the likely causes when the guard trips,
 *  shown with the chip so the reviewer knows WHAT to check, not just THAT
 *  something looks wrong. */
export const IRR_GUARD_DIAGNOSTIC =
  "가정 점검: 시장 범위(앵커와 대상 범위 일치 여부), 시장점유율 근거, 투자 규모(과소 계상 여부)";
