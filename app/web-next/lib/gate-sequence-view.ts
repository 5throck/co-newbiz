// gate-sequence-view — pure view helpers for the S11 two-committee decision section
// (entity investment committee -> group investment committee). Client-safe. Only the
// presentation sequence is modelled here; the server gate rules are unchanged.

export const IC_SEQUENCE = ["entity_ic", "group_ic"] as const;
export type IcGate = (typeof IC_SEQUENCE)[number];

// §4 payload (design 2026-10-23-i18n-ui-adoption): these Korean names are embedded in
// the gate-decisions write-route 409 message (data protocol); UI surfaces resolve the
// same wording through common.gate.* catalog keys instead.
export const IC_STEP_LABEL: Record<IcGate, string> = {
  entity_ic: "법인 투자심의위원회",
  group_ic: "그룹 투자심의위원회",
};

export type GateState = "pending" | "go" | "hold" | "kill";

export function gateState(latest: ReadonlyArray<{ gate: string; decision: string | null }> | null | undefined, gate: string): GateState {
  const d = latest?.find((g) => g.gate === gate)?.decision;
  return d === "go" || d === "hold" || d === "kill" ? d : "pending";
}

/** Gate whose turn it is: the first gate (in order) that has no GO. All GO -> the last one. */
export function currentTurn(gates: readonly string[], latest: ReadonlyArray<{ gate: string; decision: string | null }> | null | undefined): string {
  return gates.find((g) => gateState(latest, g) !== "go") ?? gates[gates.length - 1];
}

/**
 * The sequence rule itself, server-enforceable (T-20261022-011): the earlier gate
 * whose GO is missing before `gate` may be recorded, or null when the gate is open.
 * A gate outside the sequence (or first in it) is always open. Used by the panel
 * view (via gateLockedReason) AND the project gate-decisions route — the flow.spec
 * group_ic criterion ("법인 투자심의위원회 승인이 선행되었다") must not live only in
 * the UI lock.
 */
export function gateSequenceBlocker(gates: readonly string[], gate: string, latest: ReadonlyArray<{ gate: string; decision: string | null }> | null | undefined): string | null {
  const idx = gates.indexOf(gate);
  if (idx <= 0) return null;
  return gates.slice(0, idx).find((g) => gateState(latest, g) !== "go") ?? null;
}
