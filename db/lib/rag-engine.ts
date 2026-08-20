// @version 1.0.0
/**
 * RAG grading engine — design v1.0 §4-2, docs/rag-framework.md (meeting M3
 * decisions D-M3-1..D-M3-4), FR-RAG-01..08, ADR-0016.
 *
 * THE single most load-bearing rule (ADR-0016): overall grading is
 * priority-ordered, NEVER a weighted average —
 *   RED   if any dimension is Red or a Kill Criteria condition is triggered
 *   GREEN only if all six dimensions are Green (including data confidence)
 *   AMBER otherwise
 * Data confidence caps the ceiling structurally: a Grade-B proxy chain makes
 * an all-Green outcome impossible regardless of the other five dimensions.
 */

import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";

export type RagGrade = "green" | "amber" | "red";
export type RagDimension =
  | "financial"
  | "market"
  | "data_confidence"
  | "regulatory_permit"
  | "technical_execution"
  | "risk";
export type StageGate = "screening" | "pre_fs" | "fs" | "dd" | "entity_ic" | "group_ic";

export const RAG_DIMENSIONS: RagDimension[] = [
  "financial",
  "market",
  "data_confidence",
  "regulatory_permit",
  "technical_execution",
  "risk",
];

/** Percentage-point bands from meeting M3 (rag-framework.md §2/§4). */
export const FINANCIAL_GREEN_IRR_MARGIN_PP = 2.0;
export const FINANCIAL_GREEN_DSCR = 1.3;
export const DEMOTE_IRR_MARGIN_PP = 0.5;
export const MIN_HOLD_DAYS = 7;

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

/**
 * FR-RAG-02 financial bands (D-M3-1):
 *   Green = IRR >= hurdle + 2.0pp AND downside-scenario DSCR >= 1.3x
 *   Red   = IRR < hurdle in the base case
 *   Amber = IRR >= hurdle but below the Green band (either condition unmet)
 * Precondition: hurdle must be assumption kind='user' (meeting M1) — the
 * caller enforces that at data load; this function grades what it is given.
 */
export function financialBand(input: { irr: number; hurdle: number; dscrDownside: number }): {
  grade: RagGrade;
  rationale: string;
} {
  // Round to 1e-6 pp so a mathematically-on-the-band input (0.12 vs 0.10
  // hurdle = exactly +2.0pp) is not pushed off the band by float noise
  // ((0.12-0.10)*100 === 1.9999999999999836 in IEEE-754).
  const marginPp = Math.round((input.irr - input.hurdle) * 100 * 1e6) / 1e6;
  if (marginPp < 0) {
    return {
      grade: "red",
      rationale: `Base-case IRR ${input.irr} is below the hurdle ${input.hurdle} (D-M3-1 Red band).`,
    };
  }
  if (marginPp >= FINANCIAL_GREEN_IRR_MARGIN_PP && input.dscrDownside >= FINANCIAL_GREEN_DSCR) {
    return {
      grade: "green",
      rationale: `IRR is ${marginPp.toFixed(1)}pp over hurdle (>= +${FINANCIAL_GREEN_IRR_MARGIN_PP}pp) and downside DSCR ${input.dscrDownside}x >= ${FINANCIAL_GREEN_DSCR}x (D-M3-1 Green band).`,
    };
  }
  return {
    grade: "amber",
    rationale: `IRR clears the hurdle but sits below the Green band (margin ${marginPp.toFixed(1)}pp / downside DSCR ${input.dscrDownside}x) — Green needs both >= +${FINANCIAL_GREEN_IRR_MARGIN_PP}pp and >= ${FINANCIAL_GREEN_DSCR}x (D-M3-1).`,
  };
}

/**
 * FR-RAG-03 data-confidence mapping (D-M3-2):
 *   chain grade A -> Green, B -> Amber, C or a staleness-gate violation ->
 *   Red ("judgment withheld"). This is the dimension that structurally caps
 *   the overall grade — see computeOverall.
 */
export function dataConfidenceFromChain(chainGrade: "A" | "B" | "C", stalenessViolated: boolean): {
  grade: RagGrade;
  rationale: string;
} {
  if (stalenessViolated) {
    return {
      grade: "red",
      rationale: "Staleness-gate violation — judgment withheld (D-M3-2; data too old to support any conclusion).",
    };
  }
  switch (chainGrade) {
    case "A":
      return { grade: "green", rationale: "Proxy-chain reliability Grade A (all engineering hops) — direct-confidence data (D-M3-2)." };
    case "B":
      return { grade: "amber", rationale: "Proxy-chain reliability Grade B (single statistical hop, R2 >= 0.6) — caps the overall grade at Amber (D-M3-2/D-M3-3)." };
    case "C":
      return { grade: "red", rationale: "Proxy-chain reliability Grade C (multi-hop statistical or R2 < 0.6) — judgment withheld (D-M3-2)." };
  }
}

export interface RegulatoryInput {
  remedyType: "none" | "behavioral" | "structural" | "prohibited";
  /** Behavioral obligation still in force (not yet expired). */
  obligationActive?: boolean;
  /** Structural remedy discharge confirmed (one-time closing condition met). */
  dischargeConfirmedAt?: string | null;
}

/**
 * FR-RAG-05 (rag-framework.md §2.5, pilot 001 vs pilot 008): behavioral and
 * structural remedies are structurally different shapes and are NOT graded
 * with one pattern —
 *   behavioral: Amber for the FULL duration of the obligation; there is no
 *     discharge event partway through.
 *   structural: Amber while the closing condition is open (real closing
 *     risk), re-gradable toward Green once discharge is confirmed.
 *   prohibited: Red (pilot 010 — the Affinity/Lotte Rental prohibition).
 */
export function regulatoryPermitGrade(input: RegulatoryInput): {
  grade: RagGrade;
  remedyShape: "structural" | "behavioral" | "none";
  rationale: string;
} {
  switch (input.remedyType) {
    case "prohibited":
      return { grade: "red", remedyShape: "none", rationale: "Regulator prohibited the combination outright — Regulatory/Permit is Red (pilot 010 shape)." };
    case "behavioral":
      return {
        grade: "amber",
        remedyShape: "behavioral",
        rationale: input.obligationActive
          ? "Behavioral remedy obligation is active — Amber for the full obligation duration; no discharge event exists (FR-RAG-05, pilot 001 shape)."
          : "Behavioral remedy obligation has expired — re-evaluate the dimension (FR-RAG-05, pilot 001 shape).",
      };
    case "structural":
      return input.dischargeConfirmedAt
        ? {
            grade: "green",
            remedyShape: "structural",
            rationale: `Structural remedy discharge confirmed at ${input.dischargeConfirmedAt} — nothing remains to monitor post-discharge, re-gradable to Green (FR-RAG-05, pilot 008 shape).`,
          }
        : {
            grade: "amber",
            remedyShape: "structural",
            rationale: "Structural remedy still open (real closing risk, e.g. a divestiture buyer search could fail) — Amber while the condition is open (FR-RAG-05, pilot 008 shape).",
          };
    case "none":
      return { grade: "green", remedyShape: "none", rationale: "No remedy or prohibition condition identified." };
  }
}

// ---------------------------------------------------------------------------
// Overall grade + hysteresis
// ---------------------------------------------------------------------------

/**
 * FR-RAG-01 / ADR-0016: priority-ordered overall grade. Never averages.
 */
export function computeOverall(
  dimensions: Record<RagDimension, RagGrade>,
  killCriteriaTriggered: boolean,
): { grade: RagGrade; rationale: string } {
  const redDims = RAG_DIMENSIONS.filter((d) => dimensions[d] === "red");
  if (killCriteriaTriggered) {
    return { grade: "red", rationale: "A Kill Criteria condition is triggered — overall is Red regardless of dimension grades (FR-RAG-01)." };
  }
  if (redDims.length > 0) {
    return { grade: "red", rationale: `Dimension(s) ${redDims.join(", ")} graded Red — overall is Red (FR-RAG-01: any Red dimension sinks the overall grade; never averaged).` };
  }
  const notGreen = RAG_DIMENSIONS.filter((d) => dimensions[d] !== "green");
  if (notGreen.length === 0) {
    return { grade: "green", rationale: "All six dimensions Green, including data confidence (FR-RAG-01 Green rule)." };
  }
  const dataConfidenceCapped = notGreen.includes("data_confidence");
  return {
    grade: "amber",
    rationale: dataConfidenceCapped
      ? `Data confidence is ${dimensions.data_confidence} — the overall grade is capped at Amber by the data-confidence dimension regardless of the other five dimensions' strength (ADR-0016 structural cap).`
      : `Dimension(s) ${notGreen.join(", ")} not yet Green — overall Amber (FR-RAG-01).`,
  };
}

export interface HysteresisInput {
  /** What the raw rule-based computation says right now. */
  candidateGrade: RagGrade;
  /** Last recorded overall grade for the project (null on first assessment). */
  currentGrade: RagGrade | null;
  /** assessed_at of when the current grade was recorded. */
  currentGradeAt: string | null;
  /** IRR-over-hurdle margin in percentage points at THIS assessment. */
  irrOverHurdlePp: number;
  /** Same margin at the PREVIOUS assessment — "sustained for one full run
   *  cycle (not a single day's fetch)" means both must clear the bar. */
  previousIrrOverHurdlePp: number | null;
  now: string;
}

export interface HysteresisResult {
  grade: RagGrade;
  rationale: string;
}

function daysBetween(aIso: string, bIso: string): number {
  return (Date.parse(bIso) - Date.parse(aIso)) / 86_400_000;
}

/**
 * FR-RAG-04 hysteresis (D-M3-4):
 *   Promote Amber -> Green: IRR >= hurdle + 2.0pp sustained one full run
 *     cycle (previous assessment also cleared the bar) AND the current grade
 *     has been held >= 7 days measured against run timestamps.
 *   Demote Green -> Amber: IRR < hurdle + 0.5pp.
 *   Minimum hold: 7 days for BOTH directions — two same-day manually
 *     re-triggered runs never satisfy it, so grades cannot flap. A Red
 *     candidate takes effect immediately: hysteresis exists to stop
 *     flapping, never to delay a danger signal.
 */
export function applyHysteresis(input: HysteresisInput): HysteresisResult {
  const { candidateGrade, currentGrade, irrOverHurdlePp, previousIrrOverHurdlePp, now } = input;

  // Safety first: Red is never delayed by a hold period.
  if (candidateGrade === "red") {
    return { grade: "red", rationale: "Red candidate takes effect immediately — hysteresis never delays a danger signal (FR-RAG-04)." };
  }
  if (currentGrade === null) {
    return { grade: candidateGrade, rationale: "First assessment for the project — no hysteresis history to apply." };
  }
  if (candidateGrade === currentGrade) {
    return { grade: currentGrade, rationale: `Candidate matches the current grade (${currentGrade}) — held (FR-RAG-04).` };
  }

  const heldDays = input.currentGradeAt ? daysBetween(input.currentGradeAt, now) : Infinity;
  const holdSatisfied = heldDays >= MIN_HOLD_DAYS;

  if (currentGrade === "amber" && candidateGrade === "green") {
    const sustained = previousIrrOverHurdlePp !== null && previousIrrOverHurdlePp >= FINANCIAL_GREEN_IRR_MARGIN_PP;
    const clearsBar = irrOverHurdlePp >= FINANCIAL_GREEN_IRR_MARGIN_PP;
    if (clearsBar && sustained && holdSatisfied) {
      return {
        grade: "green",
        rationale: `Promoted Amber->Green: IRR ${irrOverHurdlePp.toFixed(1)}pp over hurdle (>= +${FINANCIAL_GREEN_IRR_MARGIN_PP}pp), sustained across the previous run cycle too, and the Amber grade was held ${Math.floor(heldDays)} days (>= ${MIN_HOLD_DAYS}) — all three D-M3-4 conditions met.`,
      };
    }
    return {
      grade: "amber",
      rationale: `Promotion to Green withheld: ${!clearsBar ? `IRR margin ${irrOverHurdlePp.toFixed(1)}pp is below +${FINANCIAL_GREEN_IRR_MARGIN_PP}pp` : !sustained ? "the bar was not yet sustained across a full run cycle" : `the current grade was held only ${Math.floor(heldDays)} of ${MIN_HOLD_DAYS} days`} (FR-RAG-04 hysteresis).`,
    };
  }

  if (currentGrade === "green" && candidateGrade === "amber") {
    if (irrOverHurdlePp < DEMOTE_IRR_MARGIN_PP && holdSatisfied) {
      return {
        grade: "amber",
        rationale: `Demoted Green->Amber: IRR margin ${irrOverHurdlePp.toFixed(1)}pp is below +${DEMOTE_IRR_MARGIN_PP}pp and the Green grade was held ${Math.floor(heldDays)} days (>= ${MIN_HOLD_DAYS}) (FR-RAG-04).`,
      };
    }
    return {
      grade: "green",
      rationale: `Demotion withheld: ${irrOverHurdlePp >= DEMOTE_IRR_MARGIN_PP ? `IRR margin ${irrOverHurdlePp.toFixed(1)}pp is still >= +${DEMOTE_IRR_MARGIN_PP}pp` : `the Green grade was held only ${Math.floor(heldDays)} of ${MIN_HOLD_DAYS} days`} — Green is held (FR-RAG-04 hysteresis).`,
    };
  }

  // Recovery out of Red (the D-M3-4 table defines only Amber->Green promote
  // and Green->Amber demote; a same-day Red->Green flip is exactly the
  // flapping hysteresis exists to stop — e.g. a proxy chain re-graded C then
  // A on consecutive runs). Two staged rules:
  //   Red -> Amber: allowed once the Red grade itself has been held >= 7 days.
  //   Red -> Green: never in one step — recorded as Amber; Green then needs
  //     the full promotion rule (bar + sustained + hold) from Amber.
  if (currentGrade === "red") {
    if (candidateGrade === "amber" || candidateGrade === "green") {
      if (holdSatisfied) {
        return {
          grade: "amber",
          rationale:
            candidateGrade === "amber"
              ? `Recovered Red->Amber: the cause of Red is resolved at this run and the Red grade was held ${Math.floor(heldDays)} days (>= ${MIN_HOLD_DAYS}) — hold-guarded recovery (FR-RAG-04).`
              : `Candidate is Green but the current grade is Red — recovery is staged through Amber, and Green then requires the full promotion rule (bar + sustained + hold) (FR-RAG-04; no one-step Red->Green).`,
        };
      }
      return {
        grade: "red",
        rationale: `Recovery withheld: the Red grade was held only ${Math.floor(heldDays)} of ${MIN_HOLD_DAYS} days — a resolved Red cause does not flip the grade same-day (FR-RAG-04 hysteresis).`,
      };
    }
  }

  // Any other movement (e.g. amber->amber handled above; green->green ditto).
  return { grade: candidateGrade, rationale: `Grade movement ${currentGrade}->${candidateGrade} applied (FR-RAG-04).` };
}

// ---------------------------------------------------------------------------
// Full evaluation + persistence
// ---------------------------------------------------------------------------

export interface RagEvaluationInput {
  stageGate: StageGate;
  /** Proxy-chain reliability grade (from db/lib/chain-grading.ts's output / proxy_chain.reliability_grade). */
  chainGrade?: "A" | "B" | "C";
  stalenessViolated?: boolean;
  /** Financial inputs — from FS onward; Screening/Pre-FS run a reduced check (rag-framework.md §5). */
  financial?: { irr: number; hurdle: number; dscrDownside: number };
  regulatory?: RegulatoryInput;
  /** Directly-scored dimensions (market intelligence / DD / risk agents). */
  marketGrade?: RagGrade;
  technicalGrade?: RagGrade;
  riskGrade?: RagGrade;
  killCriteriaTriggered?: boolean;
}

export interface DimensionAssessment {
  dimension: RagDimension | "overall";
  grade: RagGrade;
  remedyShape?: "structural" | "behavioral" | "none";
  rationale: string;
}

export interface RagEvaluation {
  dimensions: DimensionAssessment[];
  overall: { grade: RagGrade; rationale: string };
}

/**
 * Evaluate a full six-dimension RAG assessment. Dimensions without any input
 * default to Amber with an explicit "not yet assessed" rationale — an
 * unassessed dimension can never be Green (that would let the FR-RAG-01
 * Green rule fire on missing data), and it is not Red either (that would
 * sink projects whose review simply has not reached that axis yet).
 */
export function evaluateRag(input: RagEvaluationInput): RagEvaluation {
  const dims: DimensionAssessment[] = [];

  // Financial — reduced check before FS (rag-framework.md §5).
  if (input.stageGate === "screening" || input.stageGate === "pre_fs") {
    dims.push({
      dimension: "financial",
      grade: "amber",
      rationale: "Reduced check — the financial dimension is Amber-capped by default pending a completed model (rag-framework.md §5; full bands apply from FS onward).",
    });
  } else if (input.financial) {
    const f = financialBand(input.financial);
    dims.push({ dimension: "financial", grade: f.grade, rationale: f.rationale });
  } else {
    dims.push({
      dimension: "financial",
      grade: "amber",
      rationale: "Financial inputs not provided — Amber by default (an unassessed dimension is never Green).",
    });
  }

  dims.push(
    input.marketGrade
      ? { dimension: "market", grade: input.marketGrade, rationale: `Market dimension scored ${input.marketGrade} by the market-intelligence review.` }
      : { dimension: "market", grade: "amber", rationale: "Market dimension not yet assessed — Amber by default." },
  );

  if (input.chainGrade || input.stalenessViolated) {
    const dc = dataConfidenceFromChain(input.chainGrade ?? "A", input.stalenessViolated ?? false);
    dims.push({ dimension: "data_confidence", grade: dc.grade, rationale: dc.rationale });
  } else {
    dims.push({ dimension: "data_confidence", grade: "amber", rationale: "Data confidence not yet assessed — Amber by default." });
  }

  if (input.regulatory) {
    const r = regulatoryPermitGrade(input.regulatory);
    dims.push({ dimension: "regulatory_permit", grade: r.grade, remedyShape: r.remedyShape, rationale: r.rationale });
  } else {
    dims.push({ dimension: "regulatory_permit", grade: "amber", rationale: "Regulatory/Permit dimension not yet assessed — Amber by default." });
  }

  dims.push(
    input.technicalGrade
      ? { dimension: "technical_execution", grade: input.technicalGrade, rationale: `Technical/Execution dimension scored ${input.technicalGrade} by the DD review.` }
      : { dimension: "technical_execution", grade: "amber", rationale: "Technical/Execution dimension not yet assessed — Amber by default." },
  );
  dims.push(
    input.riskGrade
      ? { dimension: "risk", grade: input.riskGrade, rationale: `Risk dimension scored ${input.riskGrade} by the risk review.` }
      : { dimension: "risk", grade: "amber", rationale: "Risk dimension not yet assessed — Amber by default." },
  );

  const dimensionGrades = Object.fromEntries(dims.map((d) => [d.dimension, d.grade])) as Record<RagDimension, RagGrade>;
  const overall = computeOverall(dimensionGrades, input.killCriteriaTriggered ?? false);
  return { dimensions: dims, overall };
}

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
}

export interface AssessRunResult extends RagEvaluation {
  /** Grade actually recorded for the overall row (after hysteresis). */
  recordedOverall: RagGrade;
  hysteresisRationale: string;
  transition: { from: RagGrade | null; to: RagGrade } | null;
}

/**
 * Full persisted assessment: evaluate, apply hysteresis against the
 * project's previous overall grade, write rag_assessment rows (one per
 * dimension + overall) and a rag_transition row when the overall grade
 * changed. Triggered-rule ids are left empty here — they come from the
 * rag_rule seed data once the admin console (Wave 5.6) edits rules; the
 * engine's rationales already cite the governing requirement per row.
 */
export function assessRun(db: Database, options: AssessRunOptions): AssessRunResult {
  const evaluation = evaluateRag(options.input);

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

  for (const d of evaluation.dimensions) {
    db.run(
      "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, remedy_shape, triggered_rules, rationale, assessed_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), options.runId, options.projectId, d.dimension, d.grade, d.remedyShape ?? null, "[]", d.rationale, options.now],
    );
  }
  // The overall row carries the POST-hysteresis grade — the grade of record.
  db.run(
    "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, remedy_shape, triggered_rules, rationale, assessed_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      ulid(),
      options.runId,
      options.projectId,
      "overall",
      hyst.grade,
      null,
      "[]",
      `${evaluation.overall.rationale} ${hyst.rationale}`,
      options.now,
    ],
  );

  let transition: AssessRunResult["transition"] = null;
  if (prev && prev.grade !== hyst.grade) {
    db.run(
      "INSERT INTO rag_transition (id, project_id, from_grade, to_grade, run_id, at, reason, notified) VALUES (?,?,?,?,?,?,?,0)",
      [ulid(), options.projectId, prev.grade, hyst.grade, options.runId, options.now, hyst.rationale],
    );
    transition = { from: prev.grade, to: hyst.grade };
  } else if (!prev) {
    db.run(
      "INSERT INTO rag_transition (id, project_id, from_grade, to_grade, run_id, at, reason, notified) VALUES (?,?,NULL,?,?,?,?,0)",
      [ulid(), options.projectId, hyst.grade, options.runId, options.now, "Initial assessment — no prior grade."],
    );
    transition = { from: null, to: hyst.grade };
  }

  return {
    ...evaluation,
    recordedOverall: hyst.grade,
    hysteresisRationale: hyst.rationale,
    transition,
  };
}
