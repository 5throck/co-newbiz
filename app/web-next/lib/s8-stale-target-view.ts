// ADR-0206 view helpers for the stale S8 target state. The server owns the staleness (resolveS8Staleness in
// lib/business-case.ts, returned as `staleness` by the business-case / s8-lens-summary / ic-package / gate-brief
// reads); these helpers only turn it into banner messages and a GO-disabled decision. No client recomputation.

import type { S8Staleness } from "./business-case.ts";

/** Message kinds the banner can show; each maps to a `stages.s8.staleTarget.<kind>` catalog key. */
export type StaleTargetMessageKind =
  | "selectionExcluded"
  | "adoptionExcluded"
  | "adoptionMismatch"
  | "adoptionSuperseded";

export interface StaleTargetMessage {
  kind: StaleTargetMessageKind;
  /** Company name behind the message (null when the record has no name or the message names no target). */
  name: string | null;
}

/** Project GO gates the server refuses while stale (mirrors TARGET_GO_GATES in lib/gate-decision-contract.ts; a unit test pins the equality). */
export const STALE_TARGET_GO_GATES: readonly string[] = ["fs", "dd", "entity_ic", "group_ic"];

/** One message per stale record, in reading order (selection first, then adoption). Empty when nothing is stale. */
export function staleTargetMessages(staleness: S8Staleness | null | undefined): StaleTargetMessage[] {
  if (!staleness?.any) return [];
  const out: StaleTargetMessage[] = [];
  if (staleness.selection === "selected_target_excluded") {
    out.push({ kind: "selectionExcluded", name: staleness.selected_target?.name ?? null });
  }
  if (staleness.adoption === "adopted_target_excluded") {
    out.push({ kind: "adoptionExcluded", name: staleness.adopted_target?.name ?? null });
  } else if (staleness.adoption === "adopted_target_mismatch") {
    out.push({ kind: "adoptionMismatch", name: null });
  } else if (staleness.adoption === "adopted_superseded") {
    // REQ-W10-5 (DEC-20261128-01): the adopted case was archived with its round — copy is
    // INTERIM-WORDING (design 2026-09-18 addendum; the catalog value carries the ruling).
    out.push({ kind: "adoptionSuperseded", name: null });
  }
  return out;
}

/** True when a GO at `gate` is refused by the server for a stale selection/adoption (HOLD and KILL are never blocked). */
export function staleTargetBlocksGo(staleness: S8Staleness | null | undefined, gate: string): boolean {
  return staleness?.any === true && STALE_TARGET_GO_GATES.includes(gate);
}
