// @version 1.1.0
/**
 * Kill-criteria evaluator — ADR-0057. The runtime consumer the registry was
 * staged for: evaluates a procedure's ENABLED registry entries
 * (procedures/_kill-criteria/<procedure>__*.json) against a run's
 * project_variable_snapshot through the same ADR-0046 predicate engine
 * rule-assessment.ts uses (Kleene semantics, identical var coercion).
 *
 * Semantics (ADR-0057, tracing to the records):
 *   * Only entries with a non-null predicate AND enabled=true are evaluated.
 *     Declared-but-inert entries are counted in `inert` — visible, never a
 *     silent pass (registry check (b) is a warn for the same reason).
 *   * TRUE ⇒ triggered, with the entry's action (halt / mark_conditional /
 *     escalate_to_risk_officer — the actions vocabulary of the registry).
 *   * UNASSESSED ⇒ NOT triggered and NOT silently passed: the criterion_id
 *     lands in `unassessed`, and the caller decides. No defaulted halt, no
 *     defaulted pass — the ADR-0049 honesty rule applied to kill criteria.
 *   * Read-only: nothing is persisted. The durable record lives one layer up —
 *     db/repositories/kill-criteria.repository.ts (ADR-0058) persists the
 *     complete per-criterion ledger (`outcomes`) to kill_criteria_evaluation;
 *     this module remains the pure evaluation path, same posture
 *     rule-assessment.ts landed with (lib + tests; MCP/API wiring after).
 *
 * Composability with rule-assessment: both read the same run snapshot. The
 * snapshot is filled ONCE per run (ADR-0005 immutability — fillSnapshot
 * throws on a second fill; assessRulesForRun fills unconditionally). The
 * supported composition order is therefore assess-first: this module fills
 * only when the run has zero snapshot rows, never re-fills, and is
 * re-runnable read-only on the same run. D-M-RISK-3's "both, non-competing"
 * boundary is thereby executable: the graded Amber/Red and the kill action
 * read the same evidence, and neither weakens the other.
 *
 * Runtime anti-tamper (mirrors registry check (c) and rule-assessment's
 * guards): an enabled entry without BOTH policy_id and thresholds_source
 * throws; an unknown action or a predicate that fails parsePredicate throws.
 * A governance invariant violation is surfaced, never skipped.
 */

import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fillSnapshot } from "./snapshot-filler.ts";
import { evaluatePredicate, parsePredicate } from "./predicate.ts";
import {
  buildLookup,
  KILL_ACTIONS,
  type RegistryEntry,
  type SnapshotVarRow,
  validateRegistryEntry,
} from "../../packages/core-scoring/src/kill-criteria.ts";

export { KILL_ACTIONS, validateRegistryEntry, type RegistryEntry };

/** procedures/_kill-criteria/ — db/lib/../.. is the project root. */
const REGISTRY_DIR = join(import.meta.dir, "..", "..", "procedures", "_kill-criteria");

export interface TriggeredCriterion {
  criterion_id: string;
  title?: string;
  action: string;
  predicate: unknown;
}

export interface KillCriteriaOptions {
  runId: string;
  projectId: string;
  /** Procedure key whose registry entries are in scope (e.g. "brownfield-dd"). */
  procedure: string;
  /** Passed through to the snapshot filler when this call is the one that fills. */
  industryIds?: readonly string[];
  now?: string;
}

export interface KillCriteriaResult {
  runId: string;
  projectId: string;
  procedure: string;
  /** Enabled, predicate-carrying entries evaluated. */
  evaluated: number;
  /** Predicates that evaluated TRUE, in registry file order. */
  triggered: TriggeredCriterion[];
  /** Criterion_ids whose predicate evaluated UNASSESSED — the caller decides; never a silent pass. */
  unassessed: string[];
  /** Declared-but-inert entries (predicate null or enabled false) — visible count, not evaluated. */
  inert: number;
  /** COMPLETE per-criterion ledger (1.1.0): every evaluated entry with its TriState outcome AND governance anchors, registry file order — the recorder persists one row per entry from this list ('false' rows are the auditable proof a criterion was evaluated and measured false). */
  outcomes: Array<{
    criterion_id: string;
    title?: string;
    action: string;
    predicate: unknown;
    outcome: "true" | "false" | "unassessed";
    policy_id: string;
    thresholds_source: string;
  }>;
}

function loadRegistryEntries(procedure: string): RegistryEntry[] {
  let files: string[] = [];
  try {
    files = readdirSync(REGISTRY_DIR).filter((f) => f.startsWith(`${procedure}__`) && f.endsWith(".json"));
  } catch {
    throw new Error(`kill_criteria_rejected: registry directory unreadable — expected ${REGISTRY_DIR} (design Decision 8).`);
  }
  const entries: RegistryEntry[] = [];
  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(REGISTRY_DIR, f), "utf-8"));
    } catch (e) {
      throw new Error(`kill_criteria_rejected: registry file '${f}' does not parse — ${(e as Error).message}`);
    }
    entries.push(raw as RegistryEntry);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Snapshot lookup — the rule-assessment.ts coercion, mirrored verbatim:
// low_confidence maps to missing for evaluation (the distinction is a ledger
// fact, not an evaluation branch); value_num wins over value_text.
// ---------------------------------------------------------------------------

/** Evaluate a procedure's kill criteria for one run. Read-only — see module docs. */
export function evaluateKillCriteria(db: Database, opts: KillCriteriaOptions): KillCriteriaResult {
  // Fill only when this run has no snapshot yet (composability with
  // assessRulesForRun — the run is filled exactly once, by whichever runs first).
  const filled = (db.query("SELECT COUNT(*) AS n FROM project_variable_snapshot WHERE run_id = ?").get(opts.runId) as { n: number }).n;
  if (filled === 0) {
    fillSnapshot({ runId: opts.runId, projectId: opts.projectId, industryIds: opts.industryIds, now: new Date(opts.now ?? new Date().toISOString()) }, db);
  }

  const entries = loadRegistryEntries(opts.procedure);
  for (const entry of entries) validateRegistryEntry(entry);

  const lookup = buildLookup(db.query("SELECT var_key, value_num, value_text, status FROM project_variable_snapshot WHERE run_id = ?").all(opts.runId) as unknown as SnapshotVarRow[]);

  const result: KillCriteriaResult = {
    runId: opts.runId,
    projectId: opts.projectId,
    procedure: opts.procedure,
    evaluated: 0,
    triggered: [],
    unassessed: [],
    inert: 0,
    outcomes: [],
  };

  for (const entry of entries) {
    if (entry.predicate === null || entry.predicate === undefined || entry.enabled === false) {
      result.inert++;
      continue;
    }
    result.evaluated++;
    const outcome = evaluatePredicate(parsePredicate(entry.predicate), lookup);
    result.outcomes.push({
      criterion_id: entry.criterion_id,
      title: entry.title,
      action: entry.action,
      predicate: entry.predicate,
      outcome,
      // Non-null by construction for enabled entries — load-time validation threw otherwise.
      policy_id: entry.policy_id as string,
      thresholds_source: entry.thresholds_source as string,
    });
    if (outcome === "true") {
      result.triggered.push({ criterion_id: entry.criterion_id, title: entry.title, action: entry.action, predicate: entry.predicate });
    } else if (outcome === "unassessed") {
      result.unassessed.push(entry.criterion_id);
    }
    // "false" — determinately not triggered; in `outcomes` (complete ledger), not in triggered/unassessed.
  }

  return result;
}
