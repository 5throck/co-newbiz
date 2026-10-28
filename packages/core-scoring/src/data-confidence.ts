// @version 1.1.0
/**
 * Pure data-confidence grading (packages/core-scoring, Wave D) — no DB, fs or env.
 * Grade = the WORSE of the proxy-chain hop grade and the provenance cap;
 * see db/lib/data-confidence.ts for the SQL-backed adapter.
 */

/**
 * A/B/C are the hop/provenance bands. U ("unknown", ADR-0187 D1) is the grade
 * when NO proxy chain is recorded for the industry and the source is not
 * direct data (frozen-research): the confidence is not derivable, so it is
 * never defaulted to a mid grade. U caps the overall RAG at Amber and can
 * never be Green (rag-engine dataConfidenceFromChain). Ordering, best to
 * worst: A > B > U > C.
 */
export type ConfidenceGrade = "A" | "B" | "C" | "U";
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

const GRADE_WORSE: Record<ConfidenceGrade, number> = { A: 3, B: 2, U: 1, C: 0 };

/** Rationale code for the zero-chain, non-direct-data case (ADR-0187 D1, design 4.1). */
export const NO_CHAIN_RECORDED = "no_chain_recorded";

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
  const prov = input.provenance ?? "unknown";
  const synth = input.synthesized ? " (deterministic synthesis, not a real estimate)" : "";
  // ADR-0187 D1: no proxy chain recorded and the source is not direct data ->
  // U (unknown), never a defaulted B. The rationale names the absent chain
  // instead of describing a hop that does not exist.
  if (input.chainHops === 0 && cap !== "A") {
    const grade = worseGrade("U", cap);
    return {
      grade,
      chainHops: 0,
      basis: `${NO_CHAIN_RECORDED}: no proxy chain recorded for the industry; provenance ${prov} is not direct data -> grade ${grade} (unknown caps at Amber, never Green)${synth}`,
    };
  }
  const hopGrade = gradeFromHops(stat, input.minR2);
  const grade = worseGrade(hopGrade, cap);
  const hopText =
    input.chainHops === 0
      ? "no proxy chain (direct data)"
      : stat === 0
        ? `${input.chainHops} engineering hop(s), no statistical hop`
        : `${input.chainHops} hop(s), ${stat} statistical, min r2 ${input.minR2 ?? "n/a"}`;
  return {
    grade,
    chainHops: input.chainHops,
    basis: `proxy-chain ${hopText} -> hop grade ${hopGrade}; provenance ${prov} -> cap ${cap}${synth}`,
  };
}
