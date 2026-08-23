// @version 1.1.0
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
 * The gate-flow reader (1.1.0, same ADR): `getRecordedEvaluation` groups
 * the recorded ledger into the gate-impact summary `stage-gate-governance`
 * (brownfield-dd step 15's gate_pass_record output) consumes. Facts only —
 * whether a triggered criterion blocks the gate is the human gate's call
 * (non-negotiable boundary #2); the reader never decides, and an unrecorded
 * procedure surfaces as status 'never_evaluated', never as an empty pass
 * (ADR-0049 at read time). Reads are member-guarded and MNPI insider-guarded
 * (listVisibleProjects precedent) and log one data_access row.
 *
 * Consumers: none in production yet (same posture as assessRulesForRun) —
 * the gate-flow step READS this table; compliance_check deliberately does not
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

// ---------------------------------------------------------------------------
// The gate-flow reader (1.1.0) — the gate_pass_record decision input
// ---------------------------------------------------------------------------

/** One recorded criterion as the gate sees it: table columns, predicate parsed. */
export interface RecordedCriterion {
  procedure_key: string;
  criterion_id: string;
  action: string;
  outcome: "triggered" | "false" | "unassessed";
  /** The snapshotted predicate AST (parsed from predicate_json — ADR-0005). */
  predicate: unknown;
  policy_id: string;
  thresholds_source: string;
  evaluated_at: string;
  evaluated_by: string;
}

export interface GetRecordedEvaluationInput {
  runId: string;
  projectId: string;
  /** Scope to one procedure's ledger (the gate step knows its procedure). Omit for the run's full ledger. */
  procedure?: string;
  /** The reading user — FR-SEC-08 member + FR-SEC-06 insider guarded; logged. */
  actor: string;
  now?: string;
}

export interface GateImpactSummary {
  runId: string;
  projectId: string;
  /** The asked-about scope: the procedure passed in, or "all rows this run has". */
  scope: string;
  /**
   * 'recorded' = at least one row in scope. 'never_evaluated' = zero rows in
   * scope — the gate CANNOT read that as clearance (ADR-0049 at read time);
   * a gate_pass_record over a never_evaluated scope records exactly that.
   */
  status: "recorded" | "never_evaluated";
  /** Triggered criteria by their action — the facts the human gate routes on. */
  halt: RecordedCriterion[];
  mark_conditional: RecordedCriterion[];
  escalate_to_risk_officer: RecordedCriterion[];
  /** Recorded unassessed — the CALLER decides each one; never a silent pass, never a defaulted halt. */
  unassessed: RecordedCriterion[];
  /** Recorded 'false' — auditable proof of evaluation, grouped for the record. */
  evaluated_false: RecordedCriterion[];
  /** Distinct procedure_keys present in the returned rows. */
  procedures: string[];
}

/**
 * Read the recorded kill-criteria ledger for one run and group it into the
 * gate-impact summary the gate-flow step (brownfield-dd step 15's
 * gate_pass_record output) consumes. Facts only — the reader never blocks,
 * never grades, never resolves an unassessed criterion (non-negotiable
 * boundary #2: gate approval is human). Guards follow the read-path
 * precedent (listVisibleProjects): run exists → same project → actor is an
 * active member (deny-by-default) → on an MNPI project, actor is a current
 * insider; one data_access row (action "read") per call.
 */
export function getRecordedEvaluation(input: GetRecordedEvaluationInput, db: Database = getDb()): GateImpactSummary {
  const now = input.now ?? new Date().toISOString();

  const run = db.query("SELECT id, project_id FROM run WHERE id = ?").get(input.runId) as
    | { id: string; project_id: string }
    | undefined;
  if (!run) {
    throw new Error(`kill_criteria_read_rejected: run '${input.runId}' does not exist — the evaluation ledger is run-scoped (migration 0023).`);
  }
  if (run.project_id !== input.projectId) {
    throw new Error(
      `kill_criteria_read_rejected: run '${input.runId}' belongs to project '${run.project_id}', not '${input.projectId}' — a run's evaluation ledger cannot be read across projects.`,
    );
  }
  if (!(input.actor ?? "").trim()) {
    throw new Error(`kill_criteria_read_rejected: actor is mandatory — a ledger read without its reader is unauditable (design boundary #1).`);
  }
  requireActiveMember(db, input.projectId, input.actor);
  requireInsiderIfMnpi(db, input.projectId, input.actor);

  const rows = (
    input.procedure
      ? db.query("SELECT * FROM kill_criteria_evaluation WHERE run_id = ? AND procedure_key = ? ORDER BY procedure_key, criterion_id").all(input.runId, input.procedure)
      : db.query("SELECT * FROM kill_criteria_evaluation WHERE run_id = ? ORDER BY procedure_key, criterion_id").all(input.runId)
  ) as Array<{
    procedure_key: string;
    criterion_id: string;
    action: string;
    outcome: string;
    predicate_json: string;
    policy_id: string;
    thresholds_source: string;
    evaluated_at: string;
    evaluated_by: string;
  }>;

  logDataAccess(db, {
    userId: input.actor,
    tableKey: "kill_criteria_evaluation",
    recordRef: `${input.projectId}:${input.runId}:${input.procedure ?? "*"}`,
    projectId: input.projectId,
    action: "read",
    at: now,
  });

  const toRecorded = (r: (typeof rows)[number]): RecordedCriterion => ({
    procedure_key: r.procedure_key,
    criterion_id: r.criterion_id,
    action: r.action,
    outcome: r.outcome as RecordedCriterion["outcome"],
    predicate: JSON.parse(r.predicate_json),
    policy_id: r.policy_id,
    thresholds_source: r.thresholds_source,
    evaluated_at: r.evaluated_at,
    evaluated_by: r.evaluated_by,
  });

  const summary: GateImpactSummary = {
    runId: input.runId,
    projectId: input.projectId,
    scope: input.procedure ?? "*",
    status: rows.length > 0 ? "recorded" : "never_evaluated",
    halt: [],
    mark_conditional: [],
    escalate_to_risk_officer: [],
    unassessed: [],
    evaluated_false: [],
    procedures: [...new Set(rows.map((r) => r.procedure_key))],
  };
  for (const r of rows) {
    const recorded = toRecorded(r);
    if (recorded.outcome === "unassessed") summary.unassessed.push(recorded);
    else if (recorded.outcome === "false") summary.evaluated_false.push(recorded);
    else if (recorded.action === "halt") summary.halt.push(recorded);
    else if (recorded.action === "mark_conditional") summary.mark_conditional.push(recorded);
    else if (recorded.action === "escalate_to_risk_officer") summary.escalate_to_risk_officer.push(recorded);
    // A triggered row with an action outside the vocabulary cannot exist —
    // the recorder routes on the same vocabulary the table CHECK enforces.
  }
  return summary;
}
