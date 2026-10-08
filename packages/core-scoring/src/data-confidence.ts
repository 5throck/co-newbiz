// @version 1.0.0
/**
 * Pure data-confidence grading (packages/core-scoring, Wave D) — no DB, fs or env.
 * Grade = the WORSE of the proxy-chain hop grade and the provenance cap;
 * see db/lib/data-confidence.ts for the SQL-backed adapter.
 */

export type ConfidenceGrade = "A" | "B" | "C";
/** Alias used by db/lib/rag-service.ts — the S1 sizing grade feeding the RAG data_confidence dimension. */
export type DataConfidenceGrade = ConfidenceGrade;

export interface DataConfidence {
  grade: ConfidenceGrade;
  chainHops: number;
  basis: string;
}

/** Hop-band logic — identical cut lines to migration 0125's backfill SQL. */
export function gradeFromHops(statisticalHops: number, minR2: number | null): ConfidenceGrade {
  if (statisticalHops === 0) return "A";
  if (statisticalHops === 1 && minR2 !== null && minR2 >= 0.6) return "B";
  return "C";
}

/** Provenance cap: frozen-research = A, anything else (llm-estimate/unknown) = B. */
export function provenanceCap(provenance: string | null | undefined): ConfidenceGrade {
  return provenance === "frozen-research" ? "A" : "B";
}

const GRADE_WORSE: Record<ConfidenceGrade, number> = { A: 2, B: 1, C: 0 };

/** The worse (lower) of two confidence grades. */
export function worseGrade(a: ConfidenceGrade, b: ConfidenceGrade): ConfidenceGrade {
  return GRADE_WORSE[a] <= GRADE_WORSE[b] ? a : b;
}

export interface ConfidenceInput {
  /** Total proxy hops touching the industry (engineering + statistical). */
  chainHops: number;
  statisticalHops: number;
  minR2: number | null;
  provenance: string | null | undefined;
  /** Deterministic synthesis (not a real estimate) caps at C. */
  synthesized?: boolean;
}

/** Grade one market-sizing analysis from already-loaded hop facts + provenance. */
export function gradeDataConfidence(input: ConfidenceInput): DataConfidence {
  // Absent provenance caps at B (the SQL treats it as 'llm-estimate') —
  // never guess A on unknown.
  const cap: ConfidenceGrade = input.synthesized ? "C" : provenanceCap(input.provenance);
  const stat = input.statisticalHops;
  const hopGrade = gradeFromHops(stat, input.minR2);
  const grade = worseGrade(hopGrade, cap);
  return {
    grade,
    chainHops: input.chainHops,
    basis: `proxy-chain hops=${stat} statistical / min r2 ${input.minR2 ?? "n/a"} -> hop grade ${hopGrade}; provenance ${input.provenance ?? "unknown"} -> cap ${cap}${input.synthesized ? " (deterministic synthesis, not a real estimate)" : ""}`,
  };
}
