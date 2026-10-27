// @version 1.0.0
/**
 * Effective gate state (maker/checker) - ADR-0186 D6 / D7, design 3.6 and 3.15.
 *
 * An entity_ic / group_ic GO is RECORDED by a maker and becomes EFFECTIVE only
 * when the two-tier approval chain (approval_chain, ADR-0028/0029) holds an
 * `approved` or `conditional` decision on THAT decision, written by a different
 * authenticated user (migration 0175 links the chain row to the decision it
 * countersigns, 0176 holds recorded_by / decided_by). HOLD and KILL are
 * effective immediately (no countersign is needed to stop). A decision recorded
 * before the contract (no gate_decision_snapshot row) is `legacy` and counts as
 * effective, so grandfathering never breaks the ladder (R6).
 *
 * J3 (security review): a countersign is evidence. Revoking the checker's grant later does NOT invalidate a countersign
 * already recorded; revocation only stops further use (409 grant_revoked at countersign time).
 * J4: a stale-marked decision (gate_decision_stale, ADR-0157) is excluded by latestProjectDecision / latestGateDecisions, so
 * a stale GO is neither effective nor countersignable (409 decision_superseded); its chain row is simply never matched.
 *
 * Strictness: the verdict a consumer sees is mapped (un-countersigned GO ->
 * `pending`) only under `CO_NEWBIZ_GATE_INTEGRITY_MAKER_CHECKER=enforce`.
 * Under off / shadow the raw verdict is returned and `awaiting` still tells
 * the truth, so surfaces can label it without changing any gating.
 *
 * Pure db-layer helper (no app imports): every consumer of "is the IC gate GO"
 * goes through it - lib/process-flow.ts latestGateDecisions, rag-service stage
 * derivation, establishment reference times, the ladder, the IC package.
 */
import type { Database } from "bun:sqlite";
import { gateIntegrityMode } from "./gate-integrity-flags.ts";

export const IC_GATES = ["entity_ic", "group_ic"] as const;
export type IcGate = (typeof IC_GATES)[number];
/** Human role that countersigns the gate (procedures/_human-roles.yaml). */
export const CHECKER_ROLE: Record<IcGate, "entity-ic-reviewer" | "group-ic-reviewer"> = {
  entity_ic: "entity-ic-reviewer",
  group_ic: "group-ic-reviewer",
};

export function isIcGate(gate: string): gate is IcGate {
  return (IC_GATES as readonly string[]).includes(gate);
}

/** True when the decision predates the maker/checker contract (rowid at or below the persisted cutoff). */
export function isLegacyDecision(db: Database, decisionId: string): boolean {
  const row = db
    .query("SELECT (g.rowid <= c.max_decision_rowid) AS legacy FROM gate_decision g, gate_integrity_cutoff c WHERE g.id = ? AND c.name = 'maker_checker'")
    .get(decisionId) as { legacy: number } | null;
  return row?.legacy === 1;
}

export type CountersignState = "not_applicable" | "legacy" | "countersigned" | "pending_countersign" | "countersign_rejected";

export interface GateDecisionRef {
  id: string;
  gate: string;
  decision: string;
  decided_by: string;
}

/** True when un-countersigned IC GOs must read as not-GO (family `maker_checker` = enforce). */
export function makerCheckerEnforced(): boolean {
  return gateIntegrityMode("maker_checker") === "enforce";
}

interface ChainRow {
  status: string;
  decided_by: string | null;
  gate_decision_id: string | null;
}

function chainFor(db: Database, projectId: string, gate: IcGate): ChainRow | null {
  return (
    (db
      .query("SELECT status, decided_by, gate_decision_id FROM approval_chain WHERE project_id = ? AND gate = ? ORDER BY sequence DESC LIMIT 1")
      .get(projectId, gate) as ChainRow | null) ?? null
  );
}

/** Countersign state of one recorded decision of a project. HOLD / KILL / non-IC gates are `not_applicable` (effective at once). */
export function countersignState(db: Database, projectId: string, d: GateDecisionRef): CountersignState {
  if (!isIcGate(d.gate) || d.decision !== "go") return "not_applicable";
  // Legacy = recorded at or before the persisted cutoff (migration 0175). NEVER inferred from a missing snapshot row: a
  // snapshot-build fault in shadow mode leaves no snapshot and must not forge an instantly effective IC GO.
  if (isLegacyDecision(db, d.id)) return "legacy";
  const chain = chainFor(db, projectId, d.gate);
  if (!chain || chain.gate_decision_id !== d.id) return "pending_countersign";
  if ((chain.status === "approved" || chain.status === "conditional") && chain.decided_by && chain.decided_by !== d.decided_by) return "countersigned";
  if (chain.status === "rejected" || chain.status === "withdrawn_pending_resubmission") return "countersign_rejected";
  return "pending_countersign";
}

export type EffectiveVerdict = "go" | "hold" | "kill" | "pending";

export interface EffectiveState {
  /** What a gating consumer must act on. Un-countersigned GO reads `pending` only when strict. */
  verdict: EffectiveVerdict;
  /** The recorded decision. */
  raw: string;
  state: CountersignState;
  /** True when the recorded GO is not (yet) effective, whatever the flag mode (labels / inbox). */
  awaiting: boolean;
}

export function effectiveState(db: Database, projectId: string, d: GateDecisionRef, opts: { strict?: boolean } = {}): EffectiveState {
  const strict = opts.strict ?? makerCheckerEnforced();
  const state = countersignState(db, projectId, d);
  const awaiting = state === "pending_countersign" || state === "countersign_rejected";
  const raw = d.decision;
  const verdict: EffectiveVerdict = awaiting && strict ? "pending" : raw === "go" || raw === "hold" || raw === "kill" ? raw : "pending";
  return { verdict, raw, state, awaiting };
}

/** Latest non-stale decision of one project gate (same ordering as latestGateDecisions), or null. */
export function latestProjectDecision(db: Database, projectId: string, gate: string): (GateDecisionRef & { decided_at: string }) | null {
  return (
    (db
      .query(
        `SELECT g.id, g.gate, g.decision, g.decided_by, g.decided_at FROM gate_decision g
         WHERE g.entity_type = 'project' AND g.entity_id = ? AND g.gate = ? AND NOT EXISTS (SELECT 1 FROM gate_decision_stale s WHERE s.decision_id = g.id)
         ORDER BY g.decided_at DESC, g.id DESC LIMIT 1`,
      )
      .get(projectId, gate) as (GateDecisionRef & { decided_at: string }) | null) ?? null
  );
}

/** Effective verdict of the latest decision of a project gate; null when none is recorded. */
export function effectiveGateVerdict(db: Database, projectId: string, gate: string, opts: { strict?: boolean } = {}): EffectiveState | null {
  const d = latestProjectDecision(db, projectId, gate);
  return d ? effectiveState(db, projectId, d, opts) : null;
}

/**
 * Decision times of the latest EFFECTIVE GO of each of the given project gates (establishment reference times:
 * a reopen / mode change is judged against the newest GO that was really in force).
 */
export function effectiveGoTimes(db: Database, projectId: string, gates: readonly string[]): string[] {
  const out: string[] = [];
  for (const gate of gates) {
    const d = latestProjectDecision(db, projectId, gate);
    if (d && d.decision === "go" && effectiveState(db, projectId, d).verdict === "go") out.push(d.decided_at);
  }
  return out;
}
