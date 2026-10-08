// @version 1.0.0
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
