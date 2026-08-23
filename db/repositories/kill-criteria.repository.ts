// @version 1.0.0
/**
 * Kill-criteria evaluation recorder — ADR-0058 §1: the durable record the
 * read-only evaluator (db/lib/kill-criteria.ts, ADR-0057) deferred. One call
 * = one evaluation of a procedure's registry entries for one run = one
 * COMPLETE ledger write: a `kill_criteria_evaluation` row for EVERY enabled,
 * predicate-carrying criterion, in all three outcomes — 'triggered',
 * 'false', 'unassessed'. A recorded 'false' is the auditable proof the
 * criterion was evaluated and measured false; absence of a row means
 * never-evaluated, the only silent state, and it is unambiguous. Inert
 * entries get no rows — the ledger claims nothing about them.
 *
 * Each row snapshots the predicate, action and both governance anchors at
 * evaluation time (ADR-0005: a later registry edit cannot rewrite what this
 * run was evaluated under).
 *
 * Guards (all before the transaction opens): run exists and belongs to the
 * project; no prior record for this run+procedure (runs are immutable — a
 * second record throws, mirroring fillSnapshot); evaluated_by non-empty;
 * FR-SEC-08 membership + FR-SEC-06 insider status for evaluated_by (agents
 * inherit the calling user's identity — design boundary #1).
 *
 * Consumers: none in production yet (same posture as assessRulesForRun) —
 * the future gate-flow step (brownfield-dd step 15's gate_pass_record
 * output) READS this table; compliance_check deliberately does not
 * (project-scoped, no run provenance, and its rule_key namespace feeds the
 * six-validator newest-row-wins machinery — ADR-0058 §1 records the choice).
 */

import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess, requireActiveMember, requireInsiderIfMnpi } from "../lib/access-control.ts";
import { evaluateKillCriteria, type KillCriteriaResult } from "../lib/kill-criteria.ts";

export interface RecordKillCriteriaInput {
  runId: string;
  projectId: string;
  /** Procedure key whose registry entries are in scope (e.g. "brownfield-dd"). */
  procedure: string;
  /** The acting user (recorded per row; FR-SEC-08/06 guarded). */
  evaluatedBy: string;
  industryIds?: readonly string[];
  now?: string;
}

export interface RecordKillCriteriaResult {
  result: KillCriteriaResult;
  /** Rows written — one per evaluated criterion, all outcomes (may be empty: a procedure with no enabled entries records nothing). */
  rowIds: string[];
}

/** Evaluate a procedure's kill criteria for one run and persist the complete ledger. */
export function recordKillCriteriaEvaluation(input: RecordKillCriteriaInput, db: Database = getDb()): RecordKillCriteriaResult {
  const now = input.now ?? new Date().toISOString();

  const run = db.query("SELECT id, project_id FROM run WHERE id = ?").get(input.runId) as
    | { id: string; project_id: string }
    | undefined;
  if (!run) {
    throw new Error(`kill_criteria_record_rejected: run '${input.runId}' does not exist — evaluations are run-scoped (migration 0023).`);
  }
  if (run.project_id !== input.projectId) {
    throw new Error(
      `kill_criteria_record_rejected: run '${input.runId}' belongs to project '${run.project_id}', not '${input.projectId}' — a run's evaluation record cannot cross projects (ADR-0005).`,
    );
  }

  const prior = (
    db.query("SELECT COUNT(*) AS n FROM kill_criteria_evaluation WHERE run_id = ? AND procedure_key = ?").get(input.runId, input.procedure) as { n: number }
  ).n;
  if (prior > 0) {
    throw new Error(
      `kill_criteria_record_rejected: run '${input.runId}' already has a recorded '${input.procedure}' evaluation (${prior} row(s)) — runs are immutable; re-check read-only via evaluateKillCriteria instead (ADR-0005).`,
    );
  }

  if (!(input.evaluatedBy ?? "").trim()) {
    throw new Error(
      `kill_criteria_record_rejected: evaluated_by is mandatory — an evaluation record without its actor is unauditable (design boundary #1: agents inherit the calling user's identity).`,
    );
  }
  requireActiveMember(db, input.projectId, input.evaluatedBy);
  requireInsiderIfMnpi(db, input.projectId, input.evaluatedBy);

  // Read-only evaluation (fills the run snapshot only if the run has none —
  // composes with assessRulesForRun, supported order assess-first).
  const result = evaluateKillCriteria(db, {
    runId: input.runId,
    projectId: input.projectId,
    procedure: input.procedure,
    industryIds: input.industryIds,
    now,
  });

  // outcome maps 'true' → the recorded 'triggered' — the table's vocabulary
  // names the act, not the logic value; anchors ride on each outcome row
  // (non-null by construction: outcomes only contains enabled entries, and
  // the evaluator's load-time anti-tamper threw otherwise).
  const rowIds: string[] = [];
  db.transaction(() => {
    const insert = db.prepare(
      "INSERT INTO kill_criteria_evaluation (id, run_id, project_id, procedure_key, criterion_id, action, outcome, predicate_json, policy_id, thresholds_source, evaluated_at, evaluated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const o of result.outcomes) {
      const id = ulid();
      insert.run([
        id,
        input.runId,
        input.projectId,
        input.procedure,
        o.criterion_id,
        o.action,
        o.outcome === "true" ? "triggered" : o.outcome,
        JSON.stringify(o.predicate),
        o.policy_id,
        o.thresholds_source,
        now,
        input.evaluatedBy,
      ]);
      rowIds.push(id);
    }
    logDataAccess(db, {
      userId: input.evaluatedBy,
      tableKey: "kill_criteria_evaluation",
      recordRef: `${input.projectId}:${input.runId}:${input.procedure}`,
      projectId: input.projectId,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.evaluatedBy,
      action: "kill_criteria_evaluated",
      target: `${input.projectId}:${input.runId}:${input.procedure} evaluated=${result.evaluated} triggered=${result.triggered.length} unassessed=${result.unassessed.length} inert=${result.inert}${result.triggered.length > 0 ? ":HALT-PATH" : ""}`,
      now,
    });
  })();

  return { result, rowIds };
}
