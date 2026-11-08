// Kill-criteria stage scoping - ADR-0193 (PR-B engine). Pure rules, no DB access: the stage classifier,
// the gate order, the track test and the carry derivation over recorded decisions. gate-snapshot.ts
// supplies the facts (current stage, decisions, evaluation outcomes) and wires the results in.
//
// Nothing here changes a criterion's condition, action or predicate. It only decides WHEN a criterion is
// asked of a human and guarantees that a deferral is never a drop (design 2026-11-07, sections 3 and 4).
import {
  FLOW_STAGE_IDS,
  OPEN_MONITORING,
  procedureTrackOf,
  stageIndex,
} from "../../../packages/core-scoring/src/kill-criteria.ts";

export { OPEN_MONITORING };

/** The gate ladder (flow.spec gates, in order). `reevaluate_at <= G` is an index comparison on this list. */
export const GATE_ORDER: readonly string[] = [
  "screening",
  "pre_fs",
  "target_screening",
  "fs",
  "dd",
  "entity_ic",
  "group_ic",
];

export function gateIndex(gate: string): number {
  return GATE_ORDER.indexOf(gate);
}

/** Last stage hosting each gate (flow.spec `gates:` of stages); the fallback current stage when the process engine cannot say. */
export const GATE_LAST_STAGE: Readonly<Record<string, string>> = {
  screening: "S4",
  pre_fs: "S6",
  target_screening: "S7",
  fs: "S8",
  dd: "S9",
  entity_ic: "S11",
  group_ic: "S11",
};

/**
 * First stage hosting each gate. Recording a decision at a gate counts that gate's own stage as reached
 * (the engine's currentStage can lag the work: an IC GO is recorded at S11 even while S10 reads open), so
 * the effective current stage is never earlier than this. Screening is hosted from S1; the S3 screening GO
 * therefore still reads the entity's real stage.
 */
export const GATE_FIRST_STAGE: Readonly<Record<string, string>> = {
  screening: "S1",
  pre_fs: "S4",
  target_screening: "S7",
  fs: "S8",
  dd: "S9",
  entity_ic: "S11",
  group_ic: "S11",
};

/** Opportunity carriers end at S7 (ADR-0094); evaluateProcess can read S8 for a finished, unpromoted opportunity. */
export const OPPORTUNITY_LAST_STAGE = "S7";

export function laterStage(a: string, b: string): string {
  return stageIndex(a) >= stageIndex(b) ? a : b;
}

/** The track a procedure belongs to (`greenfield-*` / `brownfield-*`), or null for track-neutral procedures. */
export function procedureTrack(procedure: string): "greenfield" | "brownfield" | null {
  return procedureTrackOf(procedure);
}

/**
 * The track a CRITERION belongs to (deal-shape-to-S7 ruling R-1): the registry entry's optional `track` field when
 * present, else its procedure's track. Scoping is per criterion because a track-neutral procedure can carry both a
 * brownfield-only criterion (deal-shape-chain #9) and track-neutral ones (#10/#11, project-scoped partner DD).
 */
export function criterionTrack(
  procedure: string,
  entry?: { track?: string } | null,
): "greenfield" | "brownfield" | null {
  if (entry?.track === "greenfield" || entry?.track === "brownfield") return entry.track;
  return procedureTrack(procedure);
}

export type KillClass = "triggered" | "out_of_track" | "not_reached" | "false" | "unassessed";

/** True when the entry's single `reevaluate_at` gate lies strictly after the evaluating gate (ladder gates only; open_monitoring never defers). */
export function deferredToLaterGate(reevaluateAt: string | undefined, gate: string | undefined): boolean {
  if (!reevaluateAt || !gate) return false;
  const r = gateIndex(reevaluateAt);
  const g = gateIndex(gate);
  return r >= 0 && g >= 0 && r > g;
}

/**
 * Design 3.1, as a pure function. `evaluable_from` undefined means the entry predates the field: reached
 * (fail-closed), never silently deferred.
 *
 * ADR-0193 section 14.2: a criterion whose registry `reevaluate_at` is a LATER gate than the evaluating one
 * (`gate` + `reevaluate_at` given) is deferred even when its stage is reached - e.g. a project-scoped
 * partner-DD criterion listed at the opportunity pre_fs gate, whose evidence cannot exist there. It classifies
 * `not_reached` and becomes a carry to its own gate, never a reached-unassessed acknowledgement. Triggered still wins.
 */
export function classifyKill(input: {
  outcome: "triggered" | "false" | "unassessed";
  procedure: string;
  evaluable_from: string | undefined;
  current_stage: string;
  track: string | null;
  reevaluate_at?: string;
  gate?: string;
  /** The registry entry's optional `track` field (criterionTrack); absent = follow the procedure. */
  entry_track?: string;
}): { cls: KillClass; partial_input: boolean } {
  const early =
    (input.evaluable_from !== undefined && stageIndex(input.evaluable_from) > stageIndex(input.current_stage)) ||
    deferredToLaterGate(input.reevaluate_at, input.gate);
  // Rule 3: triggered always wins, even when the stage says the input cannot be complete yet (C-5: partial_input).
  if (input.outcome === "triggered") return { cls: "triggered", partial_input: early };
  const t = criterionTrack(input.procedure, { track: input.entry_track });
  if (input.track !== null && t !== null && t !== input.track) return { cls: "out_of_track", partial_input: false };
  if (early) return { cls: "not_reached", partial_input: false };
  return { cls: input.outcome, partial_input: false };
}

/** True when the carry's re-evaluation gate is reached or passed at gate G (open_monitoring has no gate). */
export function carryDue(reevaluateAt: string, gate: string): boolean {
  if (reevaluateAt === OPEN_MONITORING) return false;
  const r = gateIndex(reevaluateAt);
  const g = gateIndex(gate);
  return r >= 0 && g >= 0 && r <= g;
}

// ── Carry derivation over recorded decisions (design 3.3, 4.4; C-4) ─────────

/** One recorded decision of the entity lineage, with its stored snapshot (null = recorded before the contract). */
export interface CarrySource {
  decision_id: string;
  gate: string;
  decision: string;
  decided_at: string;
  schema_version: number | null;
  /** Parsed snapshot_json, or null. */
  snapshot: Record<string, unknown> | null;
}

export interface RegistryScope {
  evaluable_from?: string;
  reevaluate_at?: string;
  /** Optional per-criterion track scope (criterionTrack). */
  track?: string;
}

export interface OpenCarry {
  key: string;
  evaluable_from: string;
  reevaluate_at: string;
  from_decision_id: string;
  /** Read-time implicit carry of a legacy (schema v1) acknowledged GO, not a recorded carry (design 4.4). */
  implicit: boolean;
}

interface KillShape {
  not_reached?: Array<{ key: string; evaluable_from: string; reevaluate_at: string }>;
  carried_in?: Array<{ key: string; outcome: string; closure: string }>;
  unassessed?: Array<{ key: string }>;
}

/**
 * The carries still open after replaying the lineage's recorded decisions in order. A decision opens a carry
 * for every `not_reached` item of its snapshot (GO, conditional GO or HOLD - C-4), and a legacy v1 GO opens an
 * implicit carry for each `kill_unassessed` key whose NEW `evaluable_from` is after the decision's stage. A
 * carry closes only by evaluation: a later snapshot that lists it in `carried_in` with closure `evaluated`
 * (outcome false or triggered) or `out_of_track`. An unassessed or overdue carry stays open; an
 * acknowledgement alone never closes it. KILL decisions end the lineage and carry nothing.
 */
export function deriveOpenCarries(
  sources: readonly CarrySource[],
  entryScope: (key: string) => RegistryScope | null,
): OpenCarry[] {
  const ordered = [...sources].sort((a, b) =>
    a.decided_at < b.decided_at ? -1 : a.decided_at > b.decided_at ? 1 : a.decision_id < b.decision_id ? -1 : 1,
  );
  const state = new Map<string, OpenCarry & { closed: boolean }>();
  const open = (c: OpenCarry) => state.set(c.key, { ...c, closed: false });
  for (const d of ordered) {
    if (d.decision === "kill") continue;
    const kill = (d.snapshot?.kill ?? null) as KillShape | null;
    if (!kill) continue;
    // 1. closures recorded by this decision's evaluation of earlier carries
    for (const c of kill.carried_in ?? []) {
      const cur = state.get(c.key);
      if (!cur) continue;
      const closed =
        (c.closure === "evaluated" && (c.outcome === "false" || c.outcome === "triggered")) ||
        c.closure === "out_of_track";
      if (closed) cur.closed = true;
    }
    // 2. new carries
    if ((d.schema_version ?? 1) >= 2) {
      for (const n of kill.not_reached ?? [])
        open({
          key: n.key,
          evaluable_from: n.evaluable_from,
          reevaluate_at: n.reevaluate_at,
          from_decision_id: d.decision_id,
          implicit: false,
        });
    } else if (d.decision === "go") {
      for (const u of kill.unassessed ?? []) {
        const scope = entryScope(u.key);
        const nominal = GATE_LAST_STAGE[d.gate];
        if (!scope?.evaluable_from || !scope.reevaluate_at || !nominal) continue;
        // Not yet evaluable at the decision's stage, or deferred by the registry to a later gate (ADR-0193 14.2): the legacy ack closed nothing.
        if (
          stageIndex(scope.evaluable_from) > stageIndex(nominal) ||
          deferredToLaterGate(scope.reevaluate_at, d.gate)
        ) {
          open({
            key: u.key,
            evaluable_from: scope.evaluable_from,
            reevaluate_at: scope.reevaluate_at,
            from_decision_id: d.decision_id,
            implicit: true,
          });
        }
      }
    }
  }
  return [...state.values()]
    .filter((c) => !c.closed)
    .map(({ closed: _closed, ...c }) => c)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Stage ids exported for callers that need the list (kept here so the builder imports one module). */
export const STAGE_IDS = FLOW_STAGE_IDS;
