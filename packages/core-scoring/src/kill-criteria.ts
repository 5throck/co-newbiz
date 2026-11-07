// @version 1.1.0
/**
 * Pure kill-criteria predicates (packages/core-scoring, Wave D) — registry
 * entry validation and snapshot-row coercion. No DB, fs or env access: the
 * registry loader and snapshot query stay in db/lib/kill-criteria.ts.
 */

import { parsePredicate, type VarLookup, type VarSnapshot } from "./predicate.ts";

/** The actions vocabulary the registry README documents (halt / mark_conditional / escalate_to_risk_officer). */
export const KILL_ACTIONS: readonly string[] = ["halt", "mark_conditional", "escalate_to_risk_officer"];

export interface RegistryEntry {
  procedure: string;
  criterion_id: string;
  title?: string;
  action: string;
  predicate: unknown;
  enabled: boolean;
  policy_id: string | null;
  thresholds_source: string | null;
  notes?: string;
  /** ADR-0193: first flow stage (S1-S12) at which the criterion can be evaluated. Required by the registry validator (PR-A); not yet read by the engine (PR-B). */
  evaluable_from?: string;
  /** ADR-0193: the single gate id at which the criterion becomes binding, or `open_monitoring` for S12 criteria that no gate closes (C-6). */
  reevaluate_at?: string;
  /** ADR-0193: human-readable evidence for the declared stage (variable source / flow.spec activity). */
  evaluable_from_evidence?: string;
}

/**
 * Runtime anti-tamper: validate one loaded entry. Exported for tests — the
 * loader applies it to every enabled entry before any evaluation happens.
 */
export function validateRegistryEntry(entry: RegistryEntry): void {
  if (entry.enabled) {
    const missing: string[] = [];
    if (typeof entry.policy_id !== "string" || entry.policy_id.trim() === "") missing.push("policy_id");
    if (typeof entry.thresholds_source !== "string" || entry.thresholds_source.trim() === "") missing.push("thresholds_source");
    if (missing.length > 0) {
      throw new Error(
        `kill_criteria_rejected: enabled entry '${entry.procedure}__${entry.criterion_id}' lacks ${missing.join(" + ")} — the registry anti-tamper gate (registry check c) applies at runtime too; an enabled criterion without its governance anchors is unauditable.`,
      );
    }
  }
  if (!KILL_ACTIONS.includes(entry.action)) {
    throw new Error(
      `kill_criteria_rejected: entry '${entry.procedure}__${entry.criterion_id}' carries action '${entry.action}', which is outside the actions vocabulary (${KILL_ACTIONS.join(" / ")}) — a typo'd action would silently misroute a triggered criterion.`,
    );
  }
  if (entry.predicate !== null && entry.predicate !== undefined) {
    try {
      parsePredicate(entry.predicate);
    } catch (e) {
      throw new Error(
        `kill_criteria_rejected: entry '${entry.procedure}__${entry.criterion_id}' has a predicate that does not parse under the ADR-0046 predicate AST — ${(e as Error).message}`,
      );
    }
  }
}

// Snapshot lookup — the rule-assessment.ts coercion, mirrored verbatim:
// low_confidence maps to missing for evaluation; value_num wins over value_text.

export interface SnapshotVarRow {
  var_key: string;
  value_num: number | null;
  value_text: string | null;
  status: string;
}

export function toVarSnapshot(row: SnapshotVarRow): VarSnapshot {
  if (row.status === "present") {
    const value = row.value_num !== null ? row.value_num : row.value_text;
    return value !== null && value !== undefined ? { status: "present", value } : { status: "present" };
  }
  return { status: row.status === "stale" ? "stale" : "missing" };
}

export function buildLookup(rows: SnapshotVarRow[]): VarLookup {
  const byKey = new Map(rows.map((r) => [r.var_key, r]));
  return (varKey) => (byKey.has(varKey) ? toVarSnapshot(byKey.get(varKey) as SnapshotVarRow) : undefined);
}

// ---------------------------------------------------------------------------
// ADR-0193 stage scoping — pure registry-shape checks (PR-A: data + validator
// only; the snapshot classifier that reads these fields is PR-B).
// ---------------------------------------------------------------------------

/** The linear flow chain S1..S12 (process/flow.spec.yaml stages). */
export const FLOW_STAGE_IDS: readonly string[] = Array.from({ length: 12 }, (_, i) => `S${i + 1}`);

/** `reevaluate_at` literal for S12 criteria that no gate closes (risk-officer C-6, Q5). */
export const OPEN_MONITORING = "open_monitoring";

/** A single gate id: lowercase snake identifier. Anything else (lists, `a|b`, `a or b`, `a,b`) is compound and rejected (C-2). */
const SINGLE_GATE_ID = /^[a-z][a-z0-9_]*$/;

/** flow.spec shape the stage checks need: stage order and the stages that host each gate. */
export interface FlowShape {
  stageIds: readonly string[];
  /** gate id -> ids of the stages that list the gate in `gates:`. */
  gateStages: Readonly<Record<string, readonly string[]>>;
}

export function stageIndex(stage: string): number {
  return FLOW_STAGE_IDS.indexOf(stage);
}

/** Derive the FlowShape from a parsed flow.spec (`gates:` + `stages[].gates`). */
export function flowShapeFromSpec(spec: { gates?: Array<{ id: string }>; stages?: Array<{ id: string; gates?: string[] }> }): FlowShape {
  const gateStages: Record<string, string[]> = {};
  for (const g of spec.gates ?? []) gateStages[g.id] = [];
  for (const st of spec.stages ?? []) for (const g of st.gates ?? []) (gateStages[g] ??= []).push(st.id);
  return { stageIds: (spec.stages ?? []).map((s) => s.id), gateStages };
}

/** The last stage hosting a gate (a gate's decision happens at its latest hosting stage); null when no stage hosts it. */
export function gateStage(flow: FlowShape, gateId: string): string | null {
  const hosts = (flow.gateStages[gateId] ?? []).filter((s) => stageIndex(s) >= 0);
  if (hosts.length === 0) return null;
  return hosts.reduce((a, b) => (stageIndex(b) > stageIndex(a) ? b : a));
}

/**
 * Intrinsic ADR-0193 checks on one registry entry: both fields present, a known
 * stage, a single gate id (C-2), `open_monitoring` only for S12, and — when a
 * var->stage map is supplied — `evaluable_from` not earlier than the stage at
 * which every predicate variable can first be produced. Returns problem strings
 * (empty = clean); the caller decides severity.
 */
export function checkStageScopingFields(
  entry: Pick<RegistryEntry, "evaluable_from" | "reevaluate_at" | "evaluable_from_evidence">,
  predicateVars: readonly string[] = [],
  varStages?: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  const from = entry.evaluable_from;
  const at = entry.reevaluate_at;
  if (typeof from !== "string" || from.trim() === "") problems.push("missing required field 'evaluable_from'");
  else if (stageIndex(from) < 0) problems.push(`evaluable_from '${from}' is not a flow stage (${FLOW_STAGE_IDS[0]}..${FLOW_STAGE_IDS[FLOW_STAGE_IDS.length - 1]})`);
  if (typeof at !== "string" || at.trim() === "") problems.push("missing required field 'reevaluate_at'");
  else if (!SINGLE_GATE_ID.test(at))
    problems.push(`reevaluate_at '${at}' is not a single gate id — compound values are rejected (one gate per entry, risk-officer C-2)`);
  else if (at === OPEN_MONITORING && from !== "S12")
    problems.push(`reevaluate_at '${OPEN_MONITORING}' is reserved for S12 criteria that no gate closes (C-6); evaluable_from is '${String(from)}'`);
  if (entry.evaluable_from_evidence !== undefined && (typeof entry.evaluable_from_evidence !== "string" || entry.evaluable_from_evidence.trim() === ""))
    problems.push("evaluable_from_evidence must be a non-empty string when present");
  if (varStages && typeof from === "string" && stageIndex(from) >= 0) {
    for (const v of predicateVars) {
      const min = varStages[v];
      if (min === undefined) problems.push(`predicate variable '${v}' has no stage in the kill-criteria var->stage map (db/lib/kill-var-stages.ts) — declare the earliest stage its filler can produce it`);
      else if (stageIndex(min) < 0) problems.push(`var->stage map gives '${v}' an unknown stage '${min}'`);
      else if (stageIndex(from) < stageIndex(min))
        problems.push(`evaluable_from '${from}' is earlier than ${min}, the earliest stage at which predicate variable '${v}' can be produced`);
    }
  }
  return problems;
}

/**
 * ADR-0193 flow.spec binding: `reevaluate_at` names a gate that exists in
 * flow.spec, and that gate's (last hosting) stage is not earlier than
 * `evaluable_from`. `open_monitoring` (S12 only) has no gate to bind and is
 * checked by checkStageScopingFields. Returns problem strings.
 */
export function checkReevaluateBinding(
  entry: Pick<RegistryEntry, "evaluable_from" | "reevaluate_at">,
  flow: FlowShape,
): string[] {
  const at = entry.reevaluate_at;
  const from = entry.evaluable_from;
  if (typeof at !== "string" || typeof from !== "string" || stageIndex(from) < 0 || at === OPEN_MONITORING) return [];
  if (!(at in flow.gateStages)) return [`reevaluate_at '${at}' names no gate in flow.spec gates:`];
  const host = gateStage(flow, at);
  if (host === null) return [`reevaluate_at gate '${at}' is hosted by no flow.spec stage`];
  if (stageIndex(host) < stageIndex(from))
    return [`reevaluate_at gate '${at}' (stage ${host}) is earlier than evaluable_from '${from}' — the criterion would be re-asked before it can be evaluated`];
  return [];
}
