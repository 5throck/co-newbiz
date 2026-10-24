// i18n (design 2026-10-23-i18n-ui-adoption): gate display names are `common.gate.*`
// catalog keys (lib/label-keys.ts GATE_LABEL_KEY); the render site resolves them with
// the ROOT translator and composes the "… HOLD" chip. Client-safe: no imports.
import { GATE_LABEL_KEY } from "./label-keys.ts";

export interface DealCardChips {
  /** Current stage chip (never carries HOLD). */
  stageLabel: string;
  /** Catalog keys naming the gate(s) that hold, e.g. ["common.gate.fs"]; the card renders "…·… HOLD". null when no HOLD. */
  holdLabelKeys: string[] | null;
}

/** Catalog key of a gate display name; unknown gate ids pass through unchanged. */
export function gateName(gate: string): string {
  return GATE_LABEL_KEY[gate] ?? gate;
}

/**
 * Builds the two card chips. The stage chip says where the deal is; the HOLD
 * chip says which gate holds it. They differ (a deal at S11 can be held at the
 * FS gate), so they must not be merged into one "S11 HOLD" label.
 */
export function buildCardChips(stage: string, holdGates: readonly string[], waitingLabel?: string): DealCardChips {
  const unique = [...new Set(holdGates)];
  return {
    stageLabel: waitingLabel ?? stage,
    holdLabelKeys: unique.length ? unique.map(gateName) : null,
  };
}
