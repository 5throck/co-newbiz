// @version 1.0.0
/**
 * Rule-based per-run RAG dimension grading — PR-9 activation. This is the
 * rule-evaluation consumer docs/architecture/db-schema.md said did not exist: it fills a
 * run's variable snapshot (db/lib/snapshot-filler.ts 1.1.0), evaluates the
 * stage gate's ENABLED rag_rule rows against it through the ADR-0046
 * predicate engine (db/lib/predicate.ts — Kleene semantics), and writes one
 * rag_assessment row per ASSESSED dimension. Contracts of record:
 *   docs/decisions/risk-thresholds.md   D-M-RISK-5 "Dimension-level
 *     combination rule (pinned for PR-9)": rules evaluate in priority order;
 *     the dimension grade is the grade of the highest-priority rule
 *     evaluating TRUE; UNASSESSED rules are skipped, not matched; no rule
 *     TRUE and any UNASSESSED ⇒ the dimension is UNASSESSED (no row); all
 *     FALSE ⇒ would-be Green is CAPPED TO AMBER under the Decision 9 Green
 *     cap until calibration lifts it.
 *   docs/decisions/market-thresholds.md D-M-MKT-11.2 (the cap is not lifted
 *     by the record's numbers; the green right-to-win rule stays disabled).
 *   docs/decisions/technical-execution-thresholds.md D-M-TE-7/D-M-TE-8
 *     (Red rules carry lower priority numbers than Amber within the axis, so
 *     first-match-wins can never mask a Red — D-M-RISK-4 layer 2).
 *
 * SCOPE — deliberately narrow (the minimal honest path):
 *   * Only the three rule-graded dimensions (market / technical_execution /
 *     risk) are evaluated. financial / data_confidence / regulatory_permit
 *     keep their existing scorers (db/lib/rag-engine.ts bands, chain grade,
 *     remedy shapes) — they are not predicate rules and never were.
 *   * NO overall row is written here. Overall composition (all-six-Green
 *     rule, hysteresis, transitions) stays with assessRun in rag-engine.ts;
 *     a rules-only run typically lacks the other dimensions' inputs, and an
 *     incomplete assessment renders no overall grade at all (ADR-0049 §2).
 *   * Runs are immutable (ADR-0005): fillSnapshot throws on the second fill
 *     of a run (composite PK), so a run is graded by this path exactly once.
 *
 * DECISION 9 GREEN CAP, enforced at runtime in addition to the
 * migration-0022 guard test: if a green-graded rule somehow wins a dimension
 * (a DB this module did not migrate, or a drifted enablement), the evaluator
 * THROWS rather than yielding Green — activated-but-uncalibrated rules must
 * never produce a Green dimension grade. Failing loud mirrors the CHECK
 * philosophy of migration 0012: a governance invariant violation is surfaced,
 * never averaged away.
 */

import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";
import { fillSnapshot } from "./snapshot-filler.ts";
import { parsePredicate, evaluatePredicate, type TriState, type VarLookup, type VarSnapshot } from "./predicate.ts";
import type { RagDimension, RagGrade, StageGate } from "./rag-engine.ts";

/** The dimensions this evaluator owns — everything else is assessor-scored (module docs). */
export const RULE_GRADED_DIMENSIONS: readonly RagDimension[] = ["market", "technical_execution", "risk"];

export interface AssessRulesOptions {
  runId: string;
  projectId: string;
  /** The run's stage gate decides which enabled rules are in scope. */
  stageGate: StageGate;
  /** Caller-supplied industries for the fact family — UNIONS with live project_industry bindings (snapshot-filler contract). */
  industryIds?: readonly string[];
  /**
   * ISO timestamp for assessed_at and the snapshot staleness clock; tests pin
   * it (ADR-0002 spirit). Default: wall clock.
   */
  now?: string;
}

export interface RuleDimensionOutcome {
  dimension: RagDimension;
  /** Never "green" while the Decision 9 cap holds — a green winner throws instead (module docs). */
  grade: RagGrade;
  /** False = UNASSESSED: no rag_assessment row is written for this dimension. */
  assessed: boolean;
  /** Triggered rag_rule ids in priority order — empty when no rule fired (the cap case). */
  triggeredRuleIds: string[];
  rationale: string;
}

export interface AssessRulesResult {
  runId: string;
  projectId: string;
  stageGate: StageGate;
  /** Rows the snapshot filler wrote (the filler's own completeness invariant: 22). */
  snapshotVarCount: number;
  /** One per dimension that has enabled rules at this stage gate — dims without rules are absent. */
  outcomes: RuleDimensionOutcome[];
  /** dimension -> rag_assessment.id, assessed dimensions only. */
  assessmentIds: Partial<Record<RagDimension, string>>;
}

interface EnabledRuleRow {
  id: string;
  rule_key: string;
  dimension: RagDimension;
  grade: RagGrade;
  condition_expr: string;
  priority: number;
  thresholds_source: string | null;
}

interface SnapshotVarRow {
  var_key: string;
  value_num: number | null;
  value_text: string | null;
  status: string;
}

const SQL_ENABLED_RULES =
  "SELECT id, rule_key, dimension, grade, condition_expr, priority, thresholds_source FROM rag_rule " +
  "WHERE enabled = 1 AND stage_gate = ? ORDER BY dimension, priority, rule_key";

const SQL_RUN_SNAPSHOT =
  "SELECT var_key, value_num, value_text, status FROM project_variable_snapshot WHERE run_id = ?";

const SQL_INSERT_ASSESSMENT =
  "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, remedy_shape, triggered_rules, rationale, assessed_at) VALUES (?,?,?,?,?,NULL,?,?,?)";

/**
 * project_variable_snapshot's four statuses mapped onto the predicate
 * engine's three: `low_confidence` maps to `missing` — for evaluation the
 * only fact that matters is "not present" (leaves UNASSESSED, is_null TRUE),
 * and the distinct status stays visible in the snapshot ledger itself
 * (D-M-MKT-5's low_confidence-vs-missing distinction is a ledger fact, not
 * an evaluation branch).
 */
function toVarSnapshot(row: SnapshotVarRow): VarSnapshot {
  if (row.status === "present") {
    const value = row.value_num !== null ? row.value_num : row.value_text;
    return value !== null && value !== undefined ? { status: "present", value } : { status: "present" };
  }
  return { status: row.status === "stale" ? "stale" : "missing" };
}

function buildLookup(rows: SnapshotVarRow[]): VarLookup {
  const byKey = new Map(rows.map((r) => [r.var_key, r]));
  return (varKey) => byKey.get(varKey) ? toVarSnapshot(byKey.get(varKey) as SnapshotVarRow) : undefined;
}

/**
 * Grade one run's rule-graded dimensions and persist the assessed ones.
 * Throws if an enabled rule of this stage gate targets a dimension outside
 * RULE_GRADED_DIMENSIONS (silent partial evaluation is the failure mode this
 * guard exists for), and if a green-graded rule wins a dimension (Decision 9
 * cap, module docs).
 */
export function assessRulesForRun(db: Database, opts: AssessRulesOptions): AssessRulesResult {
  const nowIso = opts.now ?? new Date().toISOString();
  const fill = fillSnapshot({ runId: opts.runId, projectId: opts.projectId, industryIds: opts.industryIds, now: new Date(nowIso) }, db);

  const rules = db.query(SQL_ENABLED_RULES).all(opts.stageGate) as unknown as EnabledRuleRow[];
  for (const rule of rules) {
    if (!RULE_GRADED_DIMENSIONS.includes(rule.dimension)) {
      throw new Error(
        `rule-assessment: enabled rule '${rule.rule_key}' targets dimension '${rule.dimension}', which this evaluator does not own (${RULE_GRADED_DIMENSIONS.join("/")}) — extend the evaluator deliberately, never silently skip`,
      );
    }
  }

  const lookup = buildLookup(db.query(SQL_RUN_SNAPSHOT).all(opts.runId) as unknown as SnapshotVarRow[]);

  // Group preserving the SQL's priority order (dimension, priority, rule_key).
  const byDimension = new Map<RagDimension, EnabledRuleRow[]>();
  for (const rule of rules) {
    if (!byDimension.has(rule.dimension)) byDimension.set(rule.dimension, []);
    (byDimension.get(rule.dimension) as EnabledRuleRow[]).push(rule);
  }

  const outcomes: RuleDimensionOutcome[] = [];
  const assessmentIds: AssessRulesResult["assessmentIds"] = {};

  for (const dimension of byDimension.keys()) {
    const dimensionRules = byDimension.get(dimension) as EnabledRuleRow[];
    const evaluated: Array<{ rule: EnabledRuleRow; result: TriState }> = dimensionRules.map((rule) => ({
      rule,
      result: evaluatePredicate(parsePredicate(JSON.parse(rule.condition_expr)), lookup),
    }));
    const fired = evaluated.filter((e) => e.result === "true").map((e) => e.rule);
    const anyUnassessed = evaluated.some((e) => e.result === "unassessed");

    if (fired.length > 0) {
      // First match by priority — the query's ORDER BY already put the
      // highest-priority TRUE first; Red dominance is structural (Red rules
      // carry lower priority numbers per D-M-RISK-4 layer 2 / D-M-TE-8).
      const winner = fired[0];
      if (winner.grade === "green") {
        throw new Error(
          `rule-assessment: rule '${winner.rule_key}' (grade green) won dimension '${dimension}' — the Decision 9 Green cap forbids a Green grade from uncalibrated rules (D-M-MKT-11.2); it lifts only with the calibration exercise under a new dated record`,
        );
      }
      const source = winner.thresholds_source ?? "(no thresholds_source on row — activation invariant violated)";
      const outcome: RuleDimensionOutcome = {
        dimension,
        grade: winner.grade,
        assessed: true,
        triggeredRuleIds: fired.map((r) => r.id),
        rationale: `Rule '${winner.rule_key}' (grade ${winner.grade}, priority ${winner.priority}) evaluated TRUE against run '${opts.runId}' evidence — dimension graded ${winner.grade} by first-match-wins priority-ordered evaluation (D-M-RISK-5; D-M3-3). Thresholds source: ${source}.`,
      };
      outcomes.push(outcome);
      const id = ulid();
      db.run(SQL_INSERT_ASSESSMENT, [
        id,
        opts.runId,
        opts.projectId,
        dimension,
        outcome.grade,
        JSON.stringify(outcome.triggeredRuleIds),
        outcome.rationale,
        nowIso,
      ]);
      assessmentIds[dimension] = id;
      continue;
    }

    if (anyUnassessed) {
      // No rule TRUE and at least one UNASSESSED ⇒ the dimension is
      // UNASSESSED: NO rag_assessment row (the rag-engine no-row-for-
      // unassessed discipline — a defaulted Amber is never written).
      outcomes.push({
        dimension,
        grade: "amber",
        assessed: false,
        triggeredRuleIds: [],
        rationale: `No enabled ${dimension} rule evaluated TRUE at stage gate '${opts.stageGate}' and ${evaluated.filter((e) => e.result === "unassessed").length} rule(s) are UNASSESSED — dimension UNASSESSED, no rag_assessment row written (ADR-0046 §2 propagation; D-M-RISK-5).`,
      });
      continue;
    }

    // All rules determinately FALSE ⇒ would-be Green, capped to Amber under
    // Decision 9 until calibration lifts it (D-M-RISK-5's pinned rule).
    const source = dimensionRules[0].thresholds_source ?? "(no thresholds_source on row — activation invariant violated)";
    const outcome: RuleDimensionOutcome = {
      dimension,
      grade: "amber",
      assessed: true,
      triggeredRuleIds: [],
      rationale: `All ${dimensionRules.length} enabled ${dimension} rules evaluated determinately FALSE — the dimension would grade Green, but the Decision 9 Green cap holds uncalibrated dimensions at Amber until calibration lifts it (D-M-RISK-5; D-M-MKT-11.2). Thresholds source: ${source}.`,
    };
    outcomes.push(outcome);
    const id = ulid();
    db.run(SQL_INSERT_ASSESSMENT, [
      id,
      opts.runId,
      opts.projectId,
      dimension,
      outcome.grade,
      JSON.stringify(outcome.triggeredRuleIds),
      outcome.rationale,
      nowIso,
    ]);
    assessmentIds[dimension] = id;
  }

  return {
    runId: opts.runId,
    projectId: opts.projectId,
    stageGate: opts.stageGate,
    snapshotVarCount: fill.rows.length,
    outcomes,
    assessmentIds,
  };
}
