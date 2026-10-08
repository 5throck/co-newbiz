import { GATE_LABEL, type GateMetaId } from "./stage-meta.ts";

export interface DealCardChips {
  /** Current stage chip (never carries HOLD). */
  stageLabel: string;
  /** Separate chip naming the gate that holds, e.g. "FS HOLD"; null when no HOLD. */
  holdLabel: string | null;
}

/** Display name of a gate id; unknown ids are shown as-is. */
export function gateName(gate: string): string {
  return GATE_LABEL[gate as GateMetaId] ?? gate;
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
    holdLabel: unique.length ? `${unique.map(gateName).join("·")} HOLD` : null,
  };
}
