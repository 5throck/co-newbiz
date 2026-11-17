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

// Display labels moved out of TS: UI render sites resolve the stages.s8.irrGuard* catalog keys
// (ADR-0184); gate-brief embeds the identical Korean text from lib/irr-guard-labels.json into
// generated record content. No user-facing string lives in this module any more.

export const IRR_GUARD_LABEL_KEYS: Record<IrrGuardBand, string> = {
  extreme: "stages.s8.stage.irrGuardExtreme",
  caution: "stages.s8.stage.irrGuardCaution",
};
export const IRR_GUARD_DIAGNOSTIC_KEY = "stages.s8.stage.irrGuardDiagnostic";
