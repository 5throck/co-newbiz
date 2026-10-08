// @version 1.0.0
/**
 * calibration.ts — RAG outcome calibration suite (Wave B-3).
 *
 * Method of record: docs/methodology/rag-calibration.md. Maps an overall RAG
 * grade to a proposed probability of a favourable outcome, then computes the
 * Brier score and a per-grade reliability table with bootstrap intervals —
 * twice, with and without the data-confidence cap.
 *
 * Only outcome-labelled cases (`public_outcome`) with a PRE-decision
 * `rag_overall` expectation that carries a real grade are eligible. Two tracks:
 *  - engine:    the grade db/lib/rag-engine.ts produces from the fixture.
 *  - reference: the grade the pilot record states (the golden label).
 * Results are evidence for people. They never retune weights (design §7).
 */
import { computeOverall, evaluateRag, type RagDimension, type RagGrade, type StageGate } from "../../db/lib/rag-engine.ts";
import { killHitsFor, ragInputFromFacts } from "./deterministic.ts";
import type { GoldenSet } from "./loader.ts";
import type { CouldNotEvaluate, SuiteResult } from "./types.ts";

/** Versioned grade -> P(favourable) mapping (design §7 initial values). Change = methodology doc version bump. */
export const MAPPING_VERSION = "1.0.0";
export const GRADE_PROBABILITY: Record<RagGrade, number> = { green: 0.8, amber: 0.5, red: 0.2 };

export interface CalibrationPoint {
  caseId: string;
  grade: RagGrade;
  favourable: boolean;
}

export interface ReliabilityRow {
  grade: RagGrade;
  n: number;
  predicted: number;
  /** Observed favourable rate; null when the bin is empty. */
  observed: number | null;
  /** 95% percentile bootstrap interval of the observed rate; null when n = 0. */
  ci: [number, number] | null;
}

export interface CalibrationReport {
  n: number;
  brier: number | null;
  brierCi: [number, number] | null;
  reliability: ReliabilityRow[];
  /** Green predictions on unfavourable outcomes (the overconfidence count). */
  greenOnUnfavourable: number;
}

/** Deterministic PRNG (mulberry32) so bootstrap intervals are reproducible run to run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function brierScore(points: CalibrationPoint[]): number | null {
  if (points.length === 0) return null;
  return points.reduce((a, p) => a + (GRADE_PROBABILITY[p.grade] - (p.favourable ? 1 : 0)) ** 2, 0) / points.length;
}

function percentile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Percentile bootstrap (resample with replacement) of a statistic. */
export function bootstrapCi<T>(items: T[], stat: (s: T[]) => number, b = 2000, seed = 20261008): [number, number] | null {
  if (items.length === 0) return null;
  const rnd = mulberry32(seed);
  const vals: number[] = [];
  for (let k = 0; k < b; k++) {
    const s: T[] = [];
    for (let i = 0; i < items.length; i++) s.push(items[Math.floor(rnd() * items.length)]);
    vals.push(stat(s));
  }
  vals.sort((x, y) => x - y);
  return [percentile(vals, 0.025), percentile(vals, 0.975)];
}

export function calibrate(points: CalibrationPoint[], b = 2000): CalibrationReport {
  const reliability: ReliabilityRow[] = (["green", "amber", "red"] as const).map((grade) => {
    const bin = points.filter((p) => p.grade === grade);
    const rate = (s: CalibrationPoint[]) => s.filter((p) => p.favourable).length / s.length;
    return { grade, n: bin.length, predicted: GRADE_PROBABILITY[grade], observed: bin.length ? rate(bin) : null, ci: bootstrapCi(bin, rate, b) };
  });
  return {
    n: points.length,
    brier: brierScore(points),
    brierCi: bootstrapCi(points, (s) => brierScore(s) ?? 0, b),
    reliability,
    greenOnUnfavourable: points.filter((p) => p.grade === "green" && !p.favourable).length,
  };
}

/** The same grade with the data-confidence cap removed: data_confidence is treated as Green. */
export function uncappedGrade(dimensions: Array<{ dimension: string; grade: RagGrade; assessed: boolean }>, killHit: boolean, capped: RagGrade): RagGrade {
  const all = dimensions.filter((d) => d.dimension !== "overall");
  if (killHit || all.some((d) => d.assessed && d.grade === "red")) return capped;
  if (!all.every((d) => d.assessed)) return capped;
  const grades = Object.fromEntries(all.map((d) => [d.dimension, d.dimension === "data_confidence" ? "green" : d.grade])) as Record<RagDimension, RagGrade>;
  return computeOverall(grades, false).grade;
}

export interface CalibrationTracks {
  engineCapped: CalibrationPoint[];
  engineUncapped: CalibrationPoint[];
  reference: CalibrationPoint[];
  couldNotEvaluate: CouldNotEvaluate[];
}

export function collectPoints(set: GoldenSet): CalibrationTracks {
  const out: CalibrationTracks = { engineCapped: [], engineUncapped: [], reference: [], couldNotEvaluate: [] };
  for (const lc of set.cases) {
    const outcome = lc.case.public_outcome;
    if (!outcome) continue;
    const id = lc.case.case_id;
    const eligible = lc.case.expectations.filter((e) => e.function === "rag_overall" && e.input_basis === "pre_decision");
    if (eligible.length === 0) {
      out.couldNotEvaluate.push({ caseId: id, fn: "calibration", reason: "outcome-labelled, but no pre-decision rag_overall expectation" });
      continue;
    }
    for (const e of eligible) {
      if (e.function !== "rag_overall") continue;
      if (e.expected.overall !== "not_graded") out.reference.push({ caseId: id, grade: e.expected.overall, favourable: outcome.favourable });
      else out.couldNotEvaluate.push({ caseId: id, fn: "calibration.reference", reason: `pilot record gives no overall grade at ${e.gate} (not_graded)` });
      const { input } = ragInputFromFacts(e.gate as StageGate, lc.inputs.facts);
      const killHit = killHitsFor(lc, e.gate, lc.inputs.facts).hits.length > 0;
      if (killHit) input.killCriteriaTriggered = true;
      const ev = evaluateRag(input);
      if (!ev.overall) {
        out.couldNotEvaluate.push({ caseId: id, fn: "calibration.engine", reason: `engine produces no overall grade from the pre-decision fixture at ${e.gate}` });
        continue;
      }
      out.engineCapped.push({ caseId: id, grade: ev.overall.grade, favourable: outcome.favourable });
      out.engineUncapped.push({ caseId: id, grade: uncappedGrade(ev.dimensions, killHit, ev.overall.grade), favourable: outcome.favourable });
    }
  }
  return out;
}

const f3 = (n: number | null): string => (n === null ? "n/a" : n.toFixed(3));
const ci = (c: [number, number] | null): string => (c ? `[${c[0].toFixed(3)}, ${c[1].toFixed(3)}]` : "n/a");

export function renderReport(label: string, r: CalibrationReport): string[] {
  const l = [`**${label}** — n = ${r.n}, Brier ${f3(r.brier)} (95% bootstrap ${ci(r.brierCi)}), Green on unfavourable: ${r.greenOnUnfavourable}`, "", "| Grade | n | Predicted P(fav) | Observed | 95% bootstrap |", "|---|---|---|---|---|"];
  for (const row of r.reliability) l.push(`| ${row.grade} | ${row.n} | ${row.predicted.toFixed(2)} | ${f3(row.observed)} | ${ci(row.ci)} |`);
  l.push("");
  return l;
}

export function runCalibrationSuite(set: GoldenSet): SuiteResult {
  const t = collectPoints(set);
  const capped = calibrate(t.engineCapped);
  const uncapped = calibrate(t.engineUncapped);
  const reference = calibrate(t.reference);
  const metrics: Record<string, number> = { n_engine: capped.n, n_reference: reference.n };
  if (capped.brier !== null && uncapped.brier !== null) {
    metrics.brier_engine_capped = capped.brier;
    metrics.brier_engine_uncapped = uncapped.brier;
    metrics.brier_cap_delta = capped.brier - uncapped.brier;
  }
  if (reference.brier !== null) metrics.brier_reference = reference.brier;
  const detail = [
    `Mapping v${MAPPING_VERSION}: green ${GRADE_PROBABILITY.green}, amber ${GRADE_PROBABILITY.amber}, red ${GRADE_PROBABILITY.red}. Method: docs/methodology/rag-calibration.md.`,
    "",
    ...renderReport("Engine, with data-confidence cap", capped),
    ...renderReport("Engine, without data-confidence cap", uncapped),
    ...renderReport("Reference (pilot-record grade)", reference),
    "Insufficient for weight changes: n is far below what a calibration claim needs. Results never retune RAG weights; any change goes through the policy path with an ADR.",
  ];
  return { name: "calibration", kind: "deterministic", cases: [], couldNotEvaluate: t.couldNotEvaluate, metrics, detail };
}
