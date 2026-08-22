// @version 1.1.0
/**
 * Compliance repository — the governance write layer for the six-validator
 * completeness artifacts (PR-5c; ADR-0048 §3-§5): the durable 3-number
 * record writer, the not_applicable writer, and the invalidation sweep.
 *
 * PLACEMENT DECISION (spec §2.4 "your call, state it"): a NEW repository,
 * not an extension of classification.repository — classification rows and
 * compliance_check rows are different audit trails with different authority
 * models; the certification/classification repository doctrine (one
 * repository per governed table family) keeps them separate.
 *
 * There is exactly one deliberately-documented import cycle with
 * classification.repository (supersede() imports invalidateNotApplicable
 * here for its transaction; this file imports isReducingOrigin from there).
 * It is safe because both sides use the other's binding ONLY inside
 * functions (ESM live bindings resolve at call time, after both modules
 * have finished initializing) — neither module touches the other at
 * top level. The live classification row itself is read here with a
 * parameterized SELECT of our own (the applies-when.ts precedent), not via
 * the classification repository's getter.
 *
 * ADR-0048 §3's PRICING RULE: a not-applicable determination must be at
 * least as auditable as a waiver — the detail carries the rendered
 * applies_when sentence (renderKo + English mirror), the classification row
 * id, classified_by, and (for validator-set-reducing origins) the approver
 * trace. A skip whose classification row lacks that trace is REJECTED here:
 * a waiver without an approver is exactly what ADR-0036 refuses to issue,
 * and a skip is priced at no less than a waiver.
 *
 * LAYERING (same doctrine as every repository here): the DB CHECKs from
 * migration 0016 constrain SHAPE (gate='dd', declared pinned to 6, 0..6
 * bounds); THIS layer enforces GOVERNANCE — registry agreement (a skip is
 * writable only when the applicability engine says not-applicable),
 * approver-trace completeness, FR-SEC-08 membership, FR-SEC-06 insider
 * status on MNPI projects, and write logging on every mutation.
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess, requireActiveMember, requireInsiderIfMnpi } from "../lib/access-control.ts";
import type { ValidatorCompletenessEvaluation } from "../lib/validator-completeness.ts";
import {
  SIX_VALIDATOR_GATE,
  SIX_VALIDATOR_RECORD_GATE,
  evaluateApplicabilityForProject,
} from "../lib/validator-completeness.ts";
import {
  MA_VALIDATOR_APPLICABILITY,
  maValidatorRuleKey,
  type MaValidatorKey,
} from "../lib/validator-applicability.ts";
import { isReducingOrigin } from "./classification.repository.ts";

export interface PersistedCompletenessRecord {
  id: string;
  project_id: string;
  run_id: string | null;
  gate: string;
  declared: number;
  applicable_count: number;
  completed_count: number;
  validator_rows: string;
  created_at: string;
}

/**
 * Persist one 3-number completeness record — the durable artifact step 14
 * emits (ADR-0048 §4). The evaluation must be internally coherent (six
 * validators, unique keys, counts matching the per-validator statuses) —
 * a hand-assembled record that disagrees with its own rows is rejected,
 * because the record is the artifact an auditor reconciles against.
 */
export function persistCompletenessRecord(
  input: { evaluation: ValidatorCompletenessEvaluation; recorded_by: string; now?: string },
  db: ReturnType<typeof getDb> = getDb()
): PersistedCompletenessRecord {
  const now = input.now ?? new Date().toISOString();
  const ev = input.evaluation;

  if (ev.declared !== 6 || ev.validators.length !== 6) {
    throw new Error(
      `completeness_record_rejected: the six-validator record is 6 declared — received declared=${ev.declared} with ${ev.validators.length} validator rows; the no-waiver core's size is a governance fact (design §8.9-1(f)), not a variable.`,
    );
  }
  const keys = new Set(ev.validators.map((v) => v.key));
  if (keys.size !== 6) {
    throw new Error(
      "completeness_record_rejected: duplicate or missing validator keys — one row per validator (antitrust, hr-comp, customer, incentive, contingent-liability, certification).",
    );
  }
  const recomputedCompleted = ev.validators.filter((v) => v.status !== "missing").length;
  const recomputedApplicable = ev.validators.filter((v) => v.applies).length;
  if (ev.completed_count !== recomputedCompleted || ev.applicable_count !== recomputedApplicable) {
    throw new Error(
      `completeness_record_rejected: counts disagree with the per-validator rows (applicable ${ev.applicable_count} vs ${recomputedApplicable}, completed ${ev.completed_count} vs ${recomputedCompleted}) — the record must reconcile with itself.`,
    );
  }

  requireActiveMember(db, ev.project_id, input.recorded_by);
  requireInsiderIfMnpi(db, ev.project_id, input.recorded_by);

  const id = ulid();
  const validatorRows = JSON.stringify(
    ev.validators.map((v) => ({ key: v.key, status: v.status, compliance_check_id: v.compliance_check_id })),
  );
  db.transaction(() => {
    db.run(
      `INSERT INTO validator_completeness_record
         (id, project_id, run_id, gate, declared, applicable_count, completed_count, validator_rows, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, ev.project_id, ev.run_id, SIX_VALIDATOR_RECORD_GATE, ev.declared, ev.applicable_count, ev.completed_count, validatorRows, now],
    );
    logDataAccess(db, {
      userId: input.recorded_by,
      tableKey: "validator_completeness_record",
      recordRef: `${ev.project_id}:${id}`,
      projectId: ev.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.recorded_by,
      action: "completeness_record_written",
      target: `${ev.project_id}:${ev.declared}/${ev.applicable_count}/${ev.completed_count}${ev.halt.triggered ? ":HALT" : ""}`,
      now,
    });
  })();
  return {
    id,
    project_id: ev.project_id,
    run_id: ev.run_id,
    gate: SIX_VALIDATOR_RECORD_GATE,
    declared: ev.declared,
    applicable_count: ev.applicable_count,
    completed_count: ev.completed_count,
    validator_rows: validatorRows,
    created_at: now,
  };
}

// ---------------------------------------------------------------------------
// not_applicable writer (ADR-0048 §2-§3) + invalidation sweep (§5)
// ---------------------------------------------------------------------------

/** The live classification row shape the skip detail cites (0013 columns). */
interface LiveClassificationForSkip {
  id: string;
  case_type: string;
  origin: string;
  technology_track: string;
  classified_by: string;
  approver_role: string | null;
  approved_by: string | null;
  rationale: string;
}

const SQL_LIVE_CLASSIFICATION_FOR_SKIP = `SELECT id, case_type, origin, technology_track,
  classified_by, approver_role, approved_by, rationale
  FROM project_case_classification WHERE project_id = ? AND superseded_by IS NULL`;

export interface RecordNotApplicableInput {
  validator_key: MaValidatorKey;
  project_id: string;
  /** The member recording the skip (FR-SEC-08 membership + FR-SEC-06 insider checked). */
  recorded_by: string;
  now?: string;
}

export interface NotApplicableRow {
  id: string;
  project_id: string;
  gate: string;
  rule_key: string;
  layer: string;
  result: string;
  detail: string;
  detected_at: string;
}

/**
 * Record one validator's classification-justified skip as a compliance_check
 * row with result='not_applicable' — NEVER 'pass' (ADR-0048 §2: a skipped
 * validator recorded as pass is a false statement in the audit trail).
 *
 * Rejections (all BEFORE the transaction opens — no partial state):
 *   - unknown validator key;
 *   - no live classification row (nothing justifies a skip — fail-closed);
 *   - the applicability registry says the validator APPLIES (or resolved
 *     fail-closed on unassessed routing values) — a skip is writable only
 *     when the engine says not-applicable on an affirmatively assessed
 *     predicate-false basis;
 *   - the classification origin is validator-set-reducing but the row lacks
 *     its approver trace (approved_by/approver_role) — the skip would be
 *     cheaper than the waiver it is priced against (ADR-0048 §3);
 *   - a live not_applicable row already exists for this validator;
 *   - membership/insider guards for recorded_by.
 */
export function recordNotApplicable(
  input: RecordNotApplicableInput,
  db: ReturnType<typeof getDb> = getDb()
): NotApplicableRow {
  const now = input.now ?? new Date().toISOString();
  const nowDate = new Date(now);

  const registryRow = MA_VALIDATOR_APPLICABILITY.find((r) => r.key === input.validator_key);
  if (!registryRow) {
    throw new Error(
      `not_applicable_write_rejected: '${input.validator_key}' is not one of the six M&A validators (antitrust, hr-comp, customer, incentive, contingent-liability, certification).`,
    );
  }

  const classification = db.query(SQL_LIVE_CLASSIFICATION_FOR_SKIP).get(input.project_id) as
    | LiveClassificationForSkip
    | undefined;
  if (!classification) {
    throw new Error(
      `not_applicable_write_rejected: project '${input.project_id}' has no live classification row — a skip without a classification to justify it is exactly the false-skip path the fail-closed default exists to prevent (ADR-0048 §5).`,
    );
  }

  const decision = evaluateApplicabilityForProject(input.project_id, db, { now: nowDate }).get(input.validator_key)!;
  if (decision.applies || decision.basis !== "predicate-false") {
    throw new Error(
      `not_applicable_write_rejected: validator '${input.validator_key}' is APPLICABLE under the live classification (${decision.basis}; project ${input.project_id}) — only a predicate-false registry verdict may be recorded as not_applicable, never an applies or fail-closed-applies decision.`,
    );
  }

  const reducing = isReducingOrigin(classification.origin);
  if (reducing && (!classification.approved_by?.trim() || !classification.approver_role?.trim())) {
    throw new Error(
      `not_applicable_write_rejected: the live classification (origin='${classification.origin}', row ${classification.id}) lacks its approver trace (approved_by/approver_role) — a not-applicable determination must be at least as auditable as a waiver, and a waiver without an approver is what ADR-0036 refuses to issue (ADR-0048 §3).`,
    );
  }

  const duplicate = db
    .query(
      "SELECT id FROM compliance_check WHERE project_id = ? AND gate = ? AND rule_key = ? AND result = 'not_applicable' AND invalidated_at IS NULL",
    )
    .get(input.project_id, SIX_VALIDATOR_GATE, maValidatorRuleKey(input.validator_key)) as { id: string } | undefined;
  if (duplicate) {
    throw new Error(
      `not_applicable_write_rejected: a live not_applicable row (${duplicate.id}) already exists for '${input.validator_key}' on project '${input.project_id}' — one live skip row per validator; re-classification invalidates the old one, it never stacks a second.`,
    );
  }

  requireActiveMember(db, input.project_id, input.recorded_by);
  requireInsiderIfMnpi(db, input.project_id, input.recorded_by);

  // Detail contract (constraint 3): the `classification:` line carries the
  // row id ALONE — the completeness engine re-extracts it with detailField
  // and compares for equality against the live row id, so the routing values
  // ride a separate line instead of decorating the id.
  const detail = [
    `not_applicable: ${input.validator_key} (shared-brownfield-dd step ${registryRow.step})`,
    `reason (renderKo): ${decision.rendered_reason_ko}`,
    `reason (english mirror): ${decision.rendered_reason_en}`,
    `rationale: ${registryRow.rationale}`,
    `classification: ${classification.id}`,
    `classified: case_type=${classification.case_type}, origin=${classification.origin}, technology_track=${classification.technology_track}`,
    `classified_by: ${classification.classified_by}`,
    ...(reducing ? [`approver_role: ${classification.approver_role}`, `approved_by: ${classification.approved_by}`] : []),
  ].join("\n");

  const id = ulid();
  db.transaction(() => {
    db.run(
      "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, waiver_id, detected_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, input.project_id, SIX_VALIDATOR_GATE, maValidatorRuleKey(input.validator_key), "procedure", "not_applicable", detail, null, now],
    );
    logDataAccess(db, {
      userId: input.recorded_by,
      tableKey: "compliance_check",
      recordRef: `${input.project_id}:ma-validator-${input.validator_key}:${id}`,
      projectId: input.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.recorded_by,
      action: "validator_not_applicable",
      target: `${input.project_id}:${input.validator_key}:${classification.id}`,
      now,
    });
  })();
  return {
    id,
    project_id: input.project_id,
    gate: SIX_VALIDATOR_GATE,
    rule_key: maValidatorRuleKey(input.validator_key),
    layer: "procedure",
    result: "not_applicable",
    detail,
    detected_at: now,
  };
}

export interface InvalidateNotApplicableOptions {
  project_id: string;
  /** The classification row being retired (the one the live skips cite). */
  retired_classification_id: string;
  /** The classification row becoming live — stamped as the invalidation cause. */
  superseded_by_classification_id: string;
  actor: string;
  now: string;
}

/**
 * Invalidate every live not_applicable row of a project (ADR-0048 §5),
 * stamping invalidated_by_classification with the row that superseded the
 * justification. The sweep is all-live-rows BY DESIGN: at most one live
 * classification row exists (0013 partial unique index), so every
 * non-invalidated skip row of the project cites the retired row or an even
 * older one — in both cases its justification is no longer live, and a skip
 * can never outlive the classification that justified it. Called from
 * classification.repository.supersede() INSIDE its transaction, so a
 * reclassification and the retirement of its skips are one atomic event.
 * Rows are marked, never deleted — compliance_check is an audit trail.
 */
export function invalidateNotApplicable(
  db: ReturnType<typeof getDb>,
  opts: InvalidateNotApplicableOptions
): number {
  const invalidated = db
    .query(
      "SELECT COUNT(*) AS c FROM compliance_check WHERE project_id = ? AND result = 'not_applicable' AND invalidated_at IS NULL",
    )
    .get(opts.project_id) as { c: number };
  if (invalidated.c === 0) return 0;

  db.run(
    "UPDATE compliance_check SET invalidated_at = ?, invalidated_by_classification = ? WHERE project_id = ? AND result = 'not_applicable' AND invalidated_at IS NULL",
    [opts.now, opts.superseded_by_classification_id, opts.project_id],
  );
  appendAudit(db, {
    actor: opts.actor,
    action: "not_applicable_invalidated",
    target: `${opts.project_id}:${invalidated.c} row(s) -> classification ${opts.superseded_by_classification_id} superseded ${opts.retired_classification_id}`,
    now: opts.now,
  });
  return invalidated.c;
}
