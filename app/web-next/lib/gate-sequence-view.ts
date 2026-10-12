// gate-sequence-view — pure view helpers for the S11 two-committee decision section
// (entity investment committee -> group investment committee). Client-safe. Only the
// presentation sequence is modelled here; the server gate rules are unchanged.

export const IC_SEQUENCE = ["entity_ic", "group_ic"] as const;
export type IcGate = (typeof IC_SEQUENCE)[number];

export const IC_STEP_LABEL: Record<IcGate, string> = {
  entity_ic: "법인 투자심의위원회",
  group_ic: "그룹 투자심의위원회",
};

export type GateState = "pending" | "go" | "hold" | "kill";
export const GATE_STATE_LABEL: Record<GateState, string> = { pending: "대기", go: "GO", hold: "HOLD", kill: "KILL" };

export function gateState(latest: ReadonlyArray<{ gate: string; decision: string | null }> | null | undefined, gate: string): GateState {
  const d = latest?.find((g) => g.gate === gate)?.decision;
  return d === "go" || d === "hold" || d === "kill" ? d : "pending";
}

/** Gate whose turn it is: the first gate (in order) that has no GO. All GO -> the last one. */
export function currentTurn(gates: readonly string[], latest: ReadonlyArray<{ gate: string; decision: string | null }> | null | undefined): string {
  return gates.find((g) => gateState(latest, g) !== "go") ?? gates[gates.length - 1];
}

/** A gate is open for recording only after every earlier gate has a GO. */
export function gateLockedReason(gates: readonly string[], gate: string, latest: ReadonlyArray<{ gate: string; decision: string | null }> | null | undefined, labels: Record<string, string>): string | null {
  const idx = gates.indexOf(gate);
  for (let i = 0; i < idx; i++) {
    if (gateState(latest, gates[i]) !== "go") return `${labels[gates[i]] ?? gates[i]} GO가 기록된 뒤에 ${labels[gate] ?? gate} 결정을 기록할 수 있습니다.`;
  }
  return null;
}
