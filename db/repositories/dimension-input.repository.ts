// @version 1.3.0
/**
 * Dimension-input repository — the single write path for `dimension_input`
 * rows (PR-5b, design of record Decision 3, migration 0013).
 *
 * LAYERING (certification-repository doctrine): migration 0013's XOR CHECK
 * constrains the value columns' SHAPE (num rows carry value_num only,
 * text/bool rows carry value_text only); THIS layer enforces COHERENCE with
 * the evidence registry (value_kind must match the var's value_type — the
 * registry's type must not be reinterpretable at assertion time), run
 * scoping, cross-domain review separation (reviewed_by ≠ asserted_by,
 * Decision 3's non-negotiable boundary #2), FR-SEC-08 membership,
 * FR-SEC-06 insider status, and write logging.
 *
 * Live-row semantics feed db/lib/applies-when.ts: an assertion drives
 * routing only while it is BOTH live (superseded_by IS NULL) AND reviewed
 * (reviewed_by IS NOT NULL). assert() may supersede an existing live
 * assertion in the same transaction (the new row is born unreviewed — a
 * re-assertion RESETS the review state; routing drops the var until the
 * cross-domain review happens again); review() is the only path that
 * fills reviewed_by. Re-assertion while an unreviewed live row exists is
 * allowed (correcting your own unreviewed assertion is not a governance
 * event).
 */

import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";
import { appendAudit, logDataAccess, requireActiveMember, requireInsiderIfMnpi } from "../lib/access-control.ts";
import { isValidEvidenceRef, EVIDENCE_REF_SHAPES } from "../lib/evidence-ref.ts";
import { isIsoCalendarDate, seoulToday } from "../lib/iso-date.ts";

export interface DimensionInputRow {
  id: string;
  run_id: string;
  project_id: string;
  var_key: string;
  value_kind: "num" | "text" | "bool";
  value_text: string | null;
  value_num: number | null;
  unit: string | null;
  evidence_ref: string;
  asserted_by: string;
  reviewed_by: string | null;
  rationale: string;
  observed_at: string;
  /**
   * ADR-0194 item B (migration 0189): the date on which the asserted fact became true in the world, ISO `YYYY-MM-DD`.
   * Distinct from observed_at (when it was recorded). Only infra.plan_finalized = 'yes' requires it today.
   */
  effective_on: string | null;
  superseded_by: string | null;
}

export interface EvidenceVarRegistryRow {
  var_key: string;
  value_type: "number" | "string" | "boolean";
  unit: string | null;
  requires_evidence_ref: number;
}

export type AssertValue =
  | { kind: "num"; value: number }
  | { kind: "text"; value: string }
  | { kind: "bool"; value: boolean };

export interface AssertInput {
  project_id: string;
  /** Must exist and belong to the same project (run snapshots never cross projects). */
  run_id: string;
  var_key: string;
  value: AssertValue;
  evidence_ref: string;
  asserted_by: string;
  rationale: string;
  /** ISO-8601 observation date; defaults to now. Also stamps asserted/observed bookkeeping. */
  observed_at?: string;
  /**
   * ISO date the asserted fact took effect (ADR-0194 item B). REQUIRED when var_key = 'infra.plan_finalized' and the value
   * is 'yes' - taken from the finalized plan document cited in evidence_ref, never defaulted from observed_at / now / a gate
   * date (risk-officer B-2). Must be a real calendar date and not later than today. Rejected on 'no' (a plan that is not
   * finalized has no finalization date). Optional elsewhere.
   */
  effective_on?: string | null;
  now?: string;
}

export interface ReviewInput {
  /** The assertion being reviewed. */
  input_id: string;
  /** Cross-domain second reviewer (Decision 3) — must differ from asserted_by. */
  reviewed_by: string;
  now?: string;
}

const SELECT_BY_ID = `SELECT id, run_id, project_id, var_key, value_kind, value_text, value_num,
  unit, evidence_ref, asserted_by, reviewed_by, rationale, observed_at, effective_on, superseded_by
  FROM dimension_input WHERE id = ?`;

const SELECT_LIVE = `SELECT id, run_id, project_id, var_key, value_kind, value_text, value_num,
  unit, evidence_ref, asserted_by, reviewed_by, rationale, observed_at, effective_on, superseded_by
  FROM dimension_input WHERE project_id = ? AND var_key = ? AND superseded_by IS NULL`;

/** The live assertion for one (project, var), or null — what applies-when reads. */
export function getLiveAssertion(projectId: string, varKey: string, db: ReturnType<typeof getDb> = getDb()): DimensionInputRow | null {
  return (db.query(SELECT_LIVE).get(projectId, varKey) as DimensionInputRow | undefined) ?? null;
}

/** Full assertion history for one (project, var), newest observed_at first. */
export function getAssertionHistory(
  projectId: string,
  varKey: string,
  db: ReturnType<typeof getDb> = getDb()
): DimensionInputRow[] {
  return db
    .query(
      `SELECT id, run_id, project_id, var_key, value_kind, value_text, value_num,
       unit, evidence_ref, asserted_by, reviewed_by, rationale, observed_at, effective_on, superseded_by
       FROM dimension_input WHERE project_id = ? AND var_key = ? ORDER BY observed_at DESC, id DESC`
    )
    .all(projectId, varKey) as DimensionInputRow[];
}

/** Every assertion row of a project (all vars, or one), newest observed_at first. Membership is the caller's check. */
export function listProjectAssertions(db: ReturnType<typeof getDb>, projectId: string, varKey?: string): DimensionInputRow[] {
  return db
    .query(
      `SELECT id, run_id, project_id, var_key, value_kind, value_text, value_num,
       unit, evidence_ref, asserted_by, reviewed_by, rationale, observed_at, effective_on, superseded_by
       FROM dimension_input WHERE project_id = ? AND (? IS NULL OR var_key = ?) ORDER BY observed_at DESC, id DESC`,
    )
    .all(projectId, varKey ?? null, varKey ?? null) as DimensionInputRow[];
}

/** One assertion row by id (review routes check it belongs to the project). */
export function getAssertionById(db: ReturnType<typeof getDb>, inputId: string): DimensionInputRow | null {
  return (db.query(SELECT_BY_ID).get(inputId) as DimensionInputRow | undefined) ?? null;
}

/** The var whose assertion carries the point-in-time effective date (ADR-0194 item B, kill criterion #5). */
export const PLAN_FINALIZED_VAR = "infra.plan_finalized";
/** Registered in evidence_var (migration 0189, source asserted) but filled from PLAN_FINALIZED_VAR's effective_on, never asserted itself. */
export const PLAN_FINALIZED_ON_VAR = "infra.plan_finalized_on";

/**
 * The variables the REST assertion route accepts: registry source_kind 'asserted', minus the filler-owned
 * infra.plan_finalized_on and the single-person routing var (which has its own route, greenfield-scope).
 */
export function listAssertableVars(db: ReturnType<typeof getDb>): Array<{ var_key: string; label_ko: string; value_type: "number" | "string" | "boolean"; unit: string | null; requires_evidence_ref: number }> {
  const rows = db
    .query("SELECT var_key, label_ko, value_type, unit, requires_evidence_ref FROM evidence_var WHERE source_kind = 'asserted' ORDER BY var_key")
    .all() as Array<{ var_key: string; label_ko: string; value_type: "number" | "string" | "boolean"; unit: string | null; requires_evidence_ref: number }>;
  return rows.filter((r) => r.var_key !== PLAN_FINALIZED_ON_VAR && !SINGLE_PERSON_CONFIRMATION_VARS.includes(r.var_key));
}

/**
 * Validate and normalize `effective_on` (ADR-0194 item B, risk-officer B-2). Returns the value to store (null = none).
 *  - a supplied date must be a real ISO calendar date and not later than today (Asia/Seoul);
 *  - infra.plan_finalized = 'yes' REQUIRES it, together with a resolvable evidence_ref: the date is read off the finalized
 *    plan document, so the citation is the proof. It is never defaulted from observed_at, now or a gate date;
 *  - infra.plan_finalized = 'no' refuses it (a plan that is not finalized has no finalization date).
 */
function validateEffectiveOn(input: AssertInput, now: string): string | null {
  const supplied = input.effective_on === undefined || input.effective_on === null || input.effective_on === "" ? null : input.effective_on;
  const isPlanFinalized = input.var_key === PLAN_FINALIZED_VAR && input.value.kind === "text";
  const planAnswer = isPlanFinalized ? (input.value as { value: string }).value.trim() : null;
  if (supplied !== null) {
    if (!isIsoCalendarDate(supplied)) {
      throw new Error(`dimension_input_write_rejected: effective_on '${String(supplied)}' must be a real calendar date in YYYY-MM-DD form.`);
    }
    if (supplied > seoulToday(now)) {
      throw new Error(`dimension_input_write_rejected: effective_on '${supplied}' is later than today - a fact cannot have taken effect in the future (ADR-0194, risk-officer B-2).`);
    }
  }
  if (planAnswer === "yes") {
    if (supplied === null) {
      throw new Error(
        `dimension_input_write_rejected: '${PLAN_FINALIZED_VAR}' = 'yes' requires effective_on - the date of the finalized plan document, as stated by the person asserting it; it is never taken from observed_at, the recording time or a gate date (ADR-0194, risk-officer B-2).`,
      );
    }
    const ref = (input.evidence_ref ?? "").trim();
    if (!ref || !isValidEvidenceRef(ref)) {
      throw new Error(
        `dimension_input_write_rejected: '${PLAN_FINALIZED_VAR}' = 'yes' requires an evidence_ref (${EVIDENCE_REF_SHAPES.join(" | ")}) citing the finalized plan document the effective_on date was read from (ADR-0194, risk-officer B-2).`,
      );
    }
  } else if (planAnswer === "no" && supplied !== null) {
    throw new Error(`dimension_input_write_rejected: '${PLAN_FINALIZED_VAR}' = 'no' cannot carry effective_on - a plan that is not finalized has no finalization date.`);
  }
  return supplied;
}

/**
 * Assert a judged input. Checks (all before the transaction opens — a
 * rejected assertion leaves zero partial state):
 *   - the var exists in the registry AND the payload kind matches the
 *     registry's value_type (coherence: 'num' only for number vars, 'text'
 *     only for string vars, 'bool' only for boolean vars);
 *   - requires_evidence_ref=1 vars get a non-empty evidence_ref (an
 *     evidenced variable asserted without evidence is exactly the
 *     unsupported-claim shape the certification repository rejects);
 *   - the run exists and belongs to the same project;
 *   - rationale is non-empty (same rule as classification);
 *   - FR-SEC-08 membership + FR-SEC-06 insider status for asserted_by.
 * The unit column snapshots the registry unit at assertion time (0013:
 * a later registry unit change cannot silently reinterpret past assertions).
 *
 * If a live assertion for the same (project, var) exists, it is superseded
 * in the SAME transaction, in the 0013-documented order (successor born
 * non-live → predecessor retires → successor goes live). The successor is
 * born UNREVIEWED — Decision 3: review attaches to a specific assertion,
 * never to a (project, var) slot, so a re-assertion drops the var out of
 * routing until re-reviewed.
 */
export function assert(input: AssertInput, db: ReturnType<typeof getDb> = getDb()): DimensionInputRow {
  const now = input.now ?? new Date().toISOString();
  const observedAt = input.observed_at ?? now;

  if (!input.rationale?.trim()) {
    throw new Error(
      `dimension_input_write_rejected: rationale is mandatory for every assertion of '${input.var_key}' — an unexplained judgement input is unauditable.`,
    );
  }

  if (input.var_key === PLAN_FINALIZED_ON_VAR) {
    throw new Error(
      `dimension_input_write_rejected: '${PLAN_FINALIZED_ON_VAR}' is not asserted directly - it is read from the effective_on of the live reviewed '${PLAN_FINALIZED_VAR}' = 'yes' assertion (ADR-0194 item B); assert '${PLAN_FINALIZED_VAR}' with effective_on instead, so the var has one writer.`,
    );
  }

  const registry = db
    .query("SELECT var_key, value_type, unit, requires_evidence_ref FROM evidence_var WHERE var_key = ?")
    .get(input.var_key) as EvidenceVarRegistryRow | undefined;
  if (!registry) {
    throw new Error(
      `dimension_input_write_rejected: var_key '${input.var_key}' is not in the evidence registry (evidence_var) — only registered variables can be asserted (2026-08-22 design Decision 2).`,
    );
  }
  const expectedKind: AssertValue["kind"] =
    registry.value_type === "number" ? "num" : registry.value_type === "string" ? "text" : "bool";
  if (input.value.kind !== expectedKind) {
    throw new Error(
      `dimension_input_write_rejected: value_kind '${input.value.kind}' is incoherent with the registry — '${input.var_key}' is value_type '${registry.value_type}' and must be asserted as '${expectedKind}' (the registry's type is not reinterpretable at assertion time).`,
    );
  }
  if (registry.requires_evidence_ref === 1) {
    const ref = (input.evidence_ref ?? "").trim();
    if (!ref) {
      throw new Error(
        `dimension_input_write_rejected: '${input.var_key}' requires an evidence_ref — an evidenced variable asserted without its citation is an unsupported claim.`,
      );
    }
    if (!isValidEvidenceRef(ref)) {
      throw new Error(
        `dimension_input_write_rejected: evidence_ref '${ref}' for '${input.var_key}' is not in the citation vocabulary (${EVIDENCE_REF_SHAPES.join(" | ")}) — a free-text citation names evidence only its author can find again (v1.1 hardening, ADR-0058 §2).`,
      );
    }
  }
  if (input.value.kind === "num" && (typeof input.value.value !== "number" || !Number.isFinite(input.value.value))) {
    throw new Error(`dimension_input_write_rejected: a num assertion of '${input.var_key}' requires a finite value_num.`);
  }
  if (input.value.kind === "text" && !(input.value.value ?? "").trim()) {
    throw new Error(`dimension_input_write_rejected: a text assertion of '${input.var_key}' requires a non-empty value_text.`);
  }

  const effectiveOn = validateEffectiveOn(input, now);

  const run = db.query("SELECT id, project_id FROM run WHERE id = ?").get(input.run_id) as
    | { id: string; project_id: string }
    | undefined;
  if (!run) {
    throw new Error(`dimension_input_write_rejected: run '${input.run_id}' does not exist — assertions are run-scoped (migration 0013).`);
  }
  if (run.project_id !== input.project_id) {
    throw new Error(
      `dimension_input_write_rejected: run '${input.run_id}' belongs to project '${run.project_id}', not '${input.project_id}' — a run snapshot can only be asserted against within one project (ADR-0005).`,
    );
  }

  requireActiveMember(db, input.project_id, input.asserted_by);
  requireInsiderIfMnpi(db, input.project_id, input.asserted_by);

  const valueText = input.value.kind === "num" ? null : input.value.kind === "bool" ? String(input.value.value) : input.value.value;
  const valueNum = input.value.kind === "num" ? input.value.value : null;

  let id = "";
  db.transaction(() => {
    const live = db.query("SELECT id FROM dimension_input WHERE project_id = ? AND var_key = ? AND superseded_by IS NULL").get(
      input.project_id,
      input.var_key
    ) as { id: string } | undefined;

    id = ulid();
    // (1) successor born non-live when a live row exists (superseded_by
    // points at the predecessor so the partial live index does not fire);
    // a FIRST assertion is simply born live (superseded_by NULL).
    db.run(
      `INSERT INTO dimension_input
         (id, run_id, project_id, var_key, value_kind, value_text, value_num, unit,
          evidence_ref, asserted_by, reviewed_by, rationale, observed_at, effective_on, superseded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.run_id,
        input.project_id,
        input.var_key,
        input.value.kind,
        valueText,
        valueNum,
        registry.unit,
        input.evidence_ref,
        input.asserted_by,
        null, // born unreviewed — review() is a separate deliberate act
        input.rationale,
        observedAt,
        effectiveOn,
        live?.id ?? null,
      ]
    );
    if (live) {
      // (2) predecessor retires, (3) successor goes live — same 0013-documented
      // order as the classification supersede; reversing trips the partial
      // unique live index.
      db.run("UPDATE dimension_input SET superseded_by = ? WHERE id = ?", [id, live.id]);
      db.run("UPDATE dimension_input SET superseded_by = NULL WHERE id = ?", [id]);
    }
    logDataAccess(db, {
      userId: input.asserted_by,
      tableKey: "dimension_input",
      recordRef: `${input.project_id}:${input.var_key}:${id}`,
      projectId: input.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.asserted_by,
      action: live ? "dimension_input_reasserted" : "dimension_input_asserted",
      target: `${input.project_id}:${input.var_key}`,
      now,
    });
  })();
  return db.query(SELECT_BY_ID).get(id) as DimensionInputRow;
}

/**
 * Record the cross-domain review of an assertion (Decision 3's boundary #2:
 * review is a separate, later act by a DIFFERENT person). Enforces:
 *   - the assertion exists and is the LIVE one (reviewing a superseded row
 *     is reviewing history — the row routing reads is the live one);
 *   - reviewer ≠ asserted_by;
 *   - reviewer is an active project_member (FR-SEC-08) and, on an MNPI
 *     project, a current insider (FR-SEC-06);
 *   - one review per assertion: a second review() on an already-reviewed row
 *     is refused — re-review happens by re-asserting (which resets the
 *     review state), so authority never silently moves between reviewers.
 */
export function review(input: ReviewInput, db: ReturnType<typeof getDb> = getDb()): DimensionInputRow {
  const now = input.now ?? new Date().toISOString();
  const row = db.query(SELECT_BY_ID).get(input.input_id) as DimensionInputRow | undefined;
  if (!row) {
    throw new Error(`dimension_input_write_rejected: assertion '${input.input_id}' does not exist — there is nothing to review.`);
  }
  if (row.superseded_by !== null) {
    throw new Error(
      `dimension_input_write_rejected: assertion '${input.input_id}' is superseded (history) — only the live assertion of '${row.var_key}' can be reviewed; re-assert instead of reviewing history.`,
    );
  }
  if (row.reviewed_by !== null) {
    throw new Error(
      `dimension_input_write_rejected: assertion '${input.input_id}' is already reviewed (by '${row.reviewed_by}') — one review per assertion; a re-assertion resets the review state if the judgement changed.`,
    );
  }
  if (input.reviewed_by === row.asserted_by) {
    throw new Error(
      `dimension_input_write_rejected: reviewed_by must differ from asserted_by ('${row.asserted_by}') — the cross-domain second review is the entire point of reviewed_by (Decision 3, non-negotiable boundary #2).`,
    );
  }
  requireActiveMember(db, row.project_id, input.reviewed_by);
  requireInsiderIfMnpi(db, row.project_id, input.reviewed_by);

  db.transaction(() => {
    db.run("UPDATE dimension_input SET reviewed_by = ? WHERE id = ?", [input.reviewed_by, input.input_id]);
    logDataAccess(db, {
      userId: input.reviewed_by,
      tableKey: "dimension_input",
      recordRef: `${row.project_id}:${row.var_key}:${row.id}:review`,
      projectId: row.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.reviewed_by,
      action: "dimension_input_reviewed",
      target: `${row.project_id}:${row.var_key}:${row.id}`,
      now,
    });
  })();
  return db.query(SELECT_BY_ID).get(input.input_id) as DimensionInputRow;
}

/**
 * Variables whose confirmation is effective on ONE person's assertion — by
 * explicit user decision (2026-10-12, ADR-0160 addendum (d)). The cross-person
 * review rule of review() is NOT weakened for any other variable: this path
 * refuses every var_key outside this allowlist.
 */
export const SINGLE_PERSON_CONFIRMATION_VARS: readonly string[] = ["project.site_required"];

/**
 * Assert AND record the review by the same person in ONE transaction, for an
 * allowlisted variable only. Every assert() check still applies (registry
 * coherence, rationale, run scope, membership, insider status). The row is
 * born live and reviewed (reviewed_by = asserted_by), so routing reads it
 * immediately; a re-confirmation supersedes the previous live row exactly as
 * assert() does. The audit trail carries a 'single_person_confirmation'
 * entry with the rationale so the weaker review is visible after the fact.
 */
export function assertWithSinglePersonConfirmation(input: AssertInput, db: ReturnType<typeof getDb> = getDb()): DimensionInputRow {
  if (!SINGLE_PERSON_CONFIRMATION_VARS.includes(input.var_key)) {
    throw new Error(
      `dimension_input_write_rejected: '${input.var_key}' is not eligible for single-person confirmation — its assertion needs a review by a different person (Decision 3, non-negotiable boundary #2).`,
    );
  }
  const now = input.now ?? new Date().toISOString();
  let row: DimensionInputRow | null = null;
  db.transaction(() => {
    const asserted = assert({ ...input, now }, db);
    db.run("UPDATE dimension_input SET reviewed_by = ? WHERE id = ?", [input.asserted_by, asserted.id]);
    logDataAccess(db, {
      userId: input.asserted_by,
      tableKey: "dimension_input",
      recordRef: `${input.project_id}:${input.var_key}:${asserted.id}:review`,
      projectId: input.project_id,
      action: "write",
      at: now,
    });
    appendAudit(db, {
      actor: input.asserted_by,
      action: "dimension_input_single_person_confirmation",
      target: `${input.project_id}:${input.var_key}:${asserted.id} single_person_confirmation rationale=${input.rationale.trim()}`,
      now,
    });
    row = db.query(SELECT_BY_ID).get(asserted.id) as DimensionInputRow;
  })();
  return row as unknown as DimensionInputRow;
}
