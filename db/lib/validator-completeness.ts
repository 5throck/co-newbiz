// @version 1.1.0
/**
 * Six-validator completeness engine — the 3-number record ("6 declared /
 * N applicable / M completed") brownfield-dd step 14 emits, and the halt
 * semantics behind kill criterion any_of_six_ma_validators_missing_at_dd_exit
 * (PR-5c; design of record Decision 5d, ADR-0048 §4; constraint 1: the halt
 * fires when an APPLICABLE validator is missing — a live not_applicable row
 * for a legitimately-skipped validator is covered-with-reason, never a
 * missing row, and never a pass).
 *
 * STAGE 2 FORM (PR-5c spec §5, the ACTIVE form): the applicability registry
 * carries the real ADR-0048 vectors — the only skip family is
 * greenfield+internal (track=rbd regains contingent-liability), certification
 * applies unconditionally, and every corrupt/unassessed routing state
 * resolves fail-closed to ALL SIX (the ADR-0037 default that must survive
 * every edge case). Stage 1 shipped the registry unconditional; this engine
 * was written stage-invariant, so activation changed nothing here except
 * the shared evaluateApplicabilityForProject entry point (added so the
 * not_applicable writer renders the identical decision this engine counts).
 *
 * READER DISCIPLINE (mirrors applies-when.ts): hand-written static SQL,
 * parameter binding only, no identifier interpolation. The only two query
 * families: the live classification row (header context) and the newest
 * compliance_check row per validator rule key.
 *
 * COVERAGE SEMANTICS (constraint 2):
 *   completed   counts pass+blocked+reason_required+waived+not_applicable
 *               rows — a not_applicable row counts ONLY while its
 *               justification is live (invalidated_at IS NULL AND its
 *               detail still cites the live classification row); a skip can
 *               never outlive the classification that justified it.
 *   missing     an APPLICABLE validator with no coverage row → the halt
 *               condition, surfaced as the kill-criterion trigger (never
 *               written as a compliance row). A NOT-applicable validator
 *               whose skip row is absent is also surfaced (ADR-0048 §3:
 *               "never an absence of rows") but does NOT fire the no-waiver
 *               halt — the halt's scope is applicable-missing (constraint 1).
 */

import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { resolveRoutingVars, collectPredicateVars } from "./applies-when.ts";
import type { ApplicabilityDecision } from "./applies-when.ts";
import type { LabelFn, VarLabel } from "./predicate.ts";
import {
  MA_VALIDATOR_APPLICABILITY,
  maValidatorRuleKey,
  resolveValidatorApplicability,
  type MaValidatorKey,
} from "./validator-applicability.ts";

/** The compliance_check gate the six validators' rows are written under (procedure gate label). */
export const SIX_VALIDATOR_GATE = "DD";

/** The validator_completeness_record gate value (migration 0016 CHECK: 'dd'). */
export const SIX_VALIDATOR_RECORD_GATE = "dd";

/** The no-waiver completeness kill criterion (brownfield-dd schema.yaml). */
export const SIX_VALIDATOR_HALT_CRITERION = "any_of_six_ma_validators_missing_at_dd_exit";

export type ValidatorCoverageStatus = "completed" | "not_applicable" | "missing";

export interface ValidatorCoverage {
  key: MaValidatorKey;
  step: number;
  /** Registry verdict under the live routing values. */
  applies: boolean;
  basis: ApplicabilityDecision["basis"];
  /** Skip sentences (present only when the registry says not-applicable). */
  rendered_reason_ko: string | null;
  rendered_reason_en: string | null;
  status: ValidatorCoverageStatus;
  /** The newest compliance_check row backing the status, when one exists. */
  compliance_check_id: string | null;
}

export interface CompletenessClassificationHeader {
  id: string;
  case_type: string;
  origin: string;
  technology_track: string;
}

export interface ValidatorCompletenessEvaluation {
  project_id: string;
  run_id: string | null;
  gate: "dd";
  /** Live classification at evaluation time — header context, null when unclassified. */
  classification: CompletenessClassificationHeader | null;
  declared: 6;
  applicable_count: number;
  completed_count: number;
  validators: ValidatorCoverage[];
  halt: {
    triggered: boolean;
    kill_criterion: typeof SIX_VALIDATOR_HALT_CRITERION;
    /** Applicable validators with no coverage row — the halt set (constraint 1). */
    missing: MaValidatorKey[];
  };
  /** Not-applicable validators whose skip row is absent (ADR-0048 §3 defect; never halts). */
  undocumented_skips: MaValidatorKey[];
  evaluated_at: string;
}

// ---------------------------------------------------------------------------
// Readers — static SQL, two families, binding only
// ---------------------------------------------------------------------------

const SQL_LIVE_CLASSIFICATION_HEADER =
  "SELECT id, case_type, origin, technology_track FROM project_case_classification WHERE project_id = ? AND superseded_by IS NULL";

interface ComplianceCheckCoverageRow {
  id: string;
  result: "pass" | "blocked" | "reason_required" | "waived" | "not_applicable";
  detail: string | null;
  invalidated_at: string | null;
}

const SQL_NEWEST_VALIDATOR_ROW =
  "SELECT id, result, detail, invalidated_at FROM compliance_check WHERE project_id = ? AND gate = ? AND rule_key = ? ORDER BY detected_at DESC, id DESC LIMIT 1";

/** The evidence_var label registry feeds renderKo's LabelFn (label_ko is the display name). */
export function evidenceVarLabels(db: Database, varKeys: readonly string[]): LabelFn {
  const labels = new Map<string, VarLabel>();
  for (const key of varKeys) {
    const row = db.query("SELECT label_ko, unit FROM evidence_var WHERE var_key = ?").get(key) as
      | { label_ko: string; unit: string | null }
      | undefined;
    if (row) labels.set(key, { label: row.label_ko, unit: row.unit ?? undefined });
  }
  return (varKey: string) => labels.get(varKey) ?? { label: varKey };
}

/**
 * Evaluate the applicability registry for one project against its live
 * routing values — the SHARED entry point so the completeness engine and
 * the not_applicable writer render the identical decision (no drift
 * between what step 14 counts and what the skip row records).
 */
export function evaluateApplicabilityForProject(
  projectId: string,
  db: Database,
  opts: { now?: Date } = {},
): Map<MaValidatorKey, ApplicabilityDecision> {
  const routingVarKeys = [
    ...new Set(MA_VALIDATOR_APPLICABILITY.flatMap((row) => [...collectPredicateVars(row.applies_when)])),
  ];
  return resolveValidatorApplicability(resolveRoutingVars(projectId, db), {
    labels: evidenceVarLabels(db, routingVarKeys),
    now: opts.now,
  });
}

/**
 * Extract one `key: value` line from a repository-written not_applicable
 * detail. The detail format is a stable contract of
 * db/repositories/compliance.repository.ts (constraint 3); the engine
 * re-verifies the classification citation rather than trusting
 * invalidated_at alone.
 */
export function detailField(detail: string | null, field: string): string | null {
  if (!detail) return null;
  for (const line of detail.split("\n")) {
    const match = line.match(new RegExp(`^${field}:\\s*(.+)$`));
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * A not_applicable row still justifies its skip only when BOTH hold:
 *   1. invalidated_at IS NULL (reclassification retires it — ADR-0048 §5), and
 *   2. its detail cites the CURRENT live classification row id (defense in
 *      depth: even a row that somehow missed the invalidation sweep stops
 *      counting the moment the classification it cited is no longer live).
 */
function skipStillLive(row: ComplianceCheckCoverageRow, liveClassificationId: string | null): boolean {
  if (row.invalidated_at !== null) return false;
  const cited = detailField(row.detail, "classification");
  return liveClassificationId !== null && cited === liveClassificationId;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Evaluate six-validator completeness for one project. Emits the 3-number
 * record and per-validator coverage; missing APPLICABLE validators surface
 * as the kill-criterion trigger (halt), never as a written row.
 *
 * Fail-closed (spec §3 scenario 2): no live classification row, NULL or
 * unknown-enum classification values → every registry predicate resolves to
 * APPLIES (PR-5a fail-closed semantics / the negated-skip-condition forms),
 * so the ADR-0037 default — all six — survives every corruption scenario,
 * and the engine never throws on a corrupt row.
 */
export function evaluateValidatorCompleteness(
  projectId: string,
  runId: string | null = null,
  db: Database = getDb(),
  opts: { now?: Date } = {},
): ValidatorCompletenessEvaluation {
  const now = opts.now ?? new Date();
  const evaluatedAt = now.toISOString();

  const header = db.query(SQL_LIVE_CLASSIFICATION_HEADER).get(projectId) as
    | CompletenessClassificationHeader
    | undefined;

  const decisions = evaluateApplicabilityForProject(projectId, db, { now });

  const validators: ValidatorCoverage[] = [];
  const haltMissing: MaValidatorKey[] = [];
  const undocumentedSkips: MaValidatorKey[] = [];
  let applicableCount = 0;
  let completedCount = 0;

  for (const row of MA_VALIDATOR_APPLICABILITY) {
    const decision = decisions.get(row.key)!;
    const check = db.query(SQL_NEWEST_VALIDATOR_ROW).get(projectId, SIX_VALIDATOR_GATE, maValidatorRuleKey(row.key)) as
      | ComplianceCheckCoverageRow
      | undefined;

    if (decision.applies) applicableCount++;

    let status: ValidatorCoverageStatus;
    let covered = false;

    if (check && check.result === "not_applicable") {
      if (!decision.applies && skipStillLive(check, header?.id ?? null)) {
        // covered-with-reason: the skip is justified and its justification is live
        status = "not_applicable";
        covered = true;
      } else {
        // an invalid or stale skip row is no coverage at all
        status = "missing";
      }
    } else if (check) {
      // pass / blocked / reason_required / waived — the validator ran; the
      // row is its record (constraint 2 counts all four as completed)
      status = "completed";
      covered = true;
    } else {
      status = "missing";
    }

    if (covered) completedCount++;
    if (decision.applies && status === "missing") haltMissing.push(row.key);
    if (!decision.applies && status === "missing") undocumentedSkips.push(row.key);

    validators.push({
      key: row.key,
      step: row.step,
      applies: decision.applies,
      basis: decision.basis,
      rendered_reason_ko: decision.applies ? null : decision.rendered_reason_ko,
      rendered_reason_en: decision.applies ? null : decision.rendered_reason_en,
      status,
      compliance_check_id: check?.id ?? null,
    });
  }

  return {
    project_id: projectId,
    run_id: runId,
    gate: "dd",
    classification: header ?? null,
    declared: 6,
    applicable_count: applicableCount,
    completed_count: completedCount,
    validators,
    halt: {
      triggered: haltMissing.length > 0,
      kill_criterion: SIX_VALIDATOR_HALT_CRITERION,
      missing: haltMissing,
    },
    undocumented_skips: undocumentedSkips,
    evaluated_at: evaluatedAt,
  };
}
