// @version 1.1.0
/**
 * RAG grading engine — DB adapter (Wave D). The pure grading core (evaluateRag,
 * computeOverall, hysteresis, the data-confidence ceiling) lives in
 * packages/core-scoring/src/rag-engine.ts and is re-exported here unchanged;
 * this file keeps only assessRun, which persists an evaluation to SQLite.
 * Rules: design v1.0 §4-2, docs/governance/rag-framework.md, ADR-0016.
 */

import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";
import {
  applyConfidenceCeiling,
  applyHysteresis,
  confidenceCeilingOf,
  evaluateRag,
  type RagEvaluation,
  type RagEvaluationInput,
  type RagGrade,
} from "../../packages/core-scoring/src/rag-engine.ts";

export * from "../../packages/core-scoring/src/rag-engine.ts";

export interface AssessRunOptions {
  projectId: string;
  runId: string;
  input: RagEvaluationInput;
  /** IRR-over-hurdle margin (pp) at this assessment — required for hysteresis. */
  irrOverHurdlePp: number;
  /**
   * Same margin at the previous assessment. If omitted while a previous
   * assessment exists, promotion is WITHHELD (unknown history is treated as
   * "not sustained") — hysteresis errs toward holding, never toward Green.
   */
  previousIrrOverHurdlePp?: number | null;
  now: string;
  /**
   * Wave F-5 (design 2026-10-08-wave-f-process-closure-design.md §5): when
   * true, the data-confidence grade — when genuinely assessed — is an
   * IMMEDIATE ceiling on the recorded overall grade. The cap can pull a
   * grade DOWN the moment confidence worsens (bypassing hysteresis' 7-day
   * hold, which exists to stop flapping, never to prop up a grade above
   * what the data supports — boundary #4), and can never push it up.
   * computeOverall already enforces this structurally for complete
   * assessments; this flag closes the hysteresis gap for WEB recompute only
   * (the CLI keeps its historic semantics with the flag unset).
   */
  enforceConfidenceCeiling?: boolean;
}

export interface AssessRunResult extends RagEvaluation {
  /**
   * Grade actually recorded for the overall row (after hysteresis), or
   * null when the assessment is incomplete and no assessed dimension
   * forced Red — no overall row is written to `rag_assessment` in that
   * case, and no hysteresis/transition logic runs at all (there is
   * nothing to compare against a prior grade).
   */
  recordedOverall: RagGrade | null;
  hysteresisRationale: string | null;
  transition: { from: RagGrade | null; to: RagGrade } | null;
}

/**
 * Full persisted assessment: evaluate, and ONLY IF a real overall grade
 * resulted (evaluation.overall !== null — see evaluateRag's doc comment),
 * apply hysteresis against the project's previous overall grade and write
 * an `overall` row + `rag_transition` row. Only genuinely-assessed
 * dimensions (`assessed: true`) are persisted to `rag_assessment` at
 * all — an unassessed dimension gets no row, so the read side (API/UI/
 * MCP) sees a genuinely missing dimension, not a defaulted Amber
 * indistinguishable from a real one. Triggered-rule ids are left empty
 * here — they come from the rag_rule seed data once the admin console
 * (Wave 5.6) edits rules; the engine's rationales already cite the
 * governing requirement per row.
 */
export function assessRun(db: Database, options: AssessRunOptions): AssessRunResult {
  const evaluation = evaluateRag(options.input);

  for (const d of evaluation.dimensions) {
    if (!d.assessed) continue;
    db.run(
      "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, remedy_shape, triggered_rules, rationale, assessed_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), options.runId, options.projectId, d.dimension, d.grade, d.remedyShape ?? null, "[]", d.rationale, options.now],
    );
  }

  if (evaluation.overall === null) {
    return { ...evaluation, recordedOverall: null, hysteresisRationale: null, transition: null };
  }

  const prev = db
    .query(
      "SELECT grade, assessed_at, rationale FROM rag_assessment WHERE project_id = ? AND dimension = 'overall' ORDER BY assessed_at DESC LIMIT 1",
    )
    .get(options.projectId) as { grade: RagGrade; assessed_at: string; rationale: string } | null;

  // Unknown previous margin = null, which withholds promotion rather than
  // granting it (see AssessRunOptions.previousIrrOverHurdlePp).
  const previousMargin: number | null = options.previousIrrOverHurdlePp ?? null;

  const hyst = applyHysteresis({
    candidateGrade: evaluation.overall.grade,
    currentGrade: prev?.grade ?? null,
    currentGradeAt: prev?.assessed_at ?? null,
    irrOverHurdlePp: options.irrOverHurdlePp,
    previousIrrOverHurdlePp: previousMargin,
    now: options.now,
  });

  // Boundary #4 immediate ceiling (Wave F-5): the recorded grade of record
  // may sit BELOW the confidence ceiling (other dimensions pulled it down)
  // but never ABOVE it. Demotion by the cap is immediate — hysteresis exists
  // to stop flapping between like-for-like bands, never to delay a
  // confidence downgrade; promotion is untouched (the cap only ever lowers).
  const capped = options.enforceConfidenceCeiling
    ? applyConfidenceCeiling(hyst.grade, confidenceCeilingOf(evaluation))
    : { grade: hyst.grade, capNote: "" };
  const gradeOfRecord = capped.grade;
  const capNote = capped.capNote;

  // The overall row carries the POST-hysteresis grade — the grade of record.
  db.run(
    "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, remedy_shape, triggered_rules, rationale, assessed_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      ulid(),
      options.runId,
      options.projectId,
      "overall",
      gradeOfRecord,
      null,
      "[]",
      `${evaluation.overall.rationale} ${hyst.rationale}${capNote}`,
      options.now,
    ],
  );

  let transition: AssessRunResult["transition"] = null;
  if (prev && prev.grade !== gradeOfRecord) {
    db.run(
      "INSERT INTO rag_transition (id, project_id, from_grade, to_grade, run_id, at, reason, notified) VALUES (?,?,?,?,?,?,?,0)",
      [ulid(), options.projectId, prev.grade, gradeOfRecord, options.runId, options.now, `${hyst.rationale}${capNote}`],
    );
    transition = { from: prev.grade, to: gradeOfRecord };
  } else if (!prev) {
    db.run(
      "INSERT INTO rag_transition (id, project_id, from_grade, to_grade, run_id, at, reason, notified) VALUES (?,?,NULL,?,?,?,?,0)",
      [ulid(), options.projectId, gradeOfRecord, options.runId, options.now, `Initial assessment — no prior grade.${capNote}`],
    );
    transition = { from: null, to: gradeOfRecord };
  }

  return {
    ...evaluation,
    recordedOverall: gradeOfRecord,
    hysteresisRationale: `${hyst.rationale}${capNote}`,
    transition,
  };
}
