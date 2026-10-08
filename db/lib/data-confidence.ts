// Data-confidence grade derivation — Wave F-5 (design
// 2026-10-08-wave-f-process-closure-design.md §5). THE TS twin of migration
// 0125's backfill SQL; tests/unit/wave-f5-rag.test.ts asserts parity.
//
// The grade is derived deterministically from the proxy chain and the sizing
// payload's provenance:
//   hops      = proxy_link rows incident to the analysed industry whose
//               hop_type is engineering|statistical (structural hops are
//               topology only and carry no conversion factor — ADR-0126).
//   hop grade = A  no statistical hop (direct data or engineering-only)
//               B  exactly one statistical hop with r2 >= 0.6
//               C  more than one statistical hop, or any statistical hop
//                  with r2 < 0.6
//               (same bands as db/lib/chain-grading.ts, D-M4-1)
//   source cap= A  provenance 'frozen-research'
//               B  anything else (llm-estimate / unknown) — the existing
//                  ragCapRecommendation principle: an unverified LLM estimate
//                  caps at Amber.
//               C  offline / failed-LLM deterministic synthesis (Wave C-3, pilot-009
//                  D-2): the matrix is placeholder data, never better than C.
//   grade     = the WORSE of hop grade and source cap.
import type { Database } from "bun:sqlite";

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

/**
 * Derive the data-confidence grade for one market-sizing analysis (by
 * industry) from the CURRENT proxy chain + the sizing matrix's provenance.
 * Mirrors migration 0125's backfill exactly (same WHERE, same cut lines) —
 * a parity test in tests/unit/wave-f5-rag.test.ts asserts the two agree.
 */
export function deriveDataConfidence(
  db: Database,
  industryId: string,
  provenance: string | null | undefined,
  opts: { synthesized?: boolean } = {},
): DataConfidence {
  const hops = db
    .query(
      `SELECT COUNT(*) AS c,
              SUM(p.hop_type = 'statistical') AS stat,
              MIN(CASE WHEN p.hop_type = 'statistical' THEN p.r2 END) AS min_r2
       FROM proxy_link p
       WHERE (p.from_industry_id = ? OR p.to_industry_id = ?)
         AND p.hop_type IN ('engineering', 'statistical')`,
    )
    .get(industryId, industryId) as { c: number; stat: number | null; min_r2: number | null };

  // Absent provenance caps at B (the SQL treats it as 'llm-estimate') —
  // never guess A on unknown.
  const cap: ConfidenceGrade = opts.synthesized ? "C" : provenanceCap(provenance);
  const stat = hops.stat ?? 0;
  const hopGrade = gradeFromHops(stat, hops.min_r2);
  const grade = worseGrade(hopGrade, cap);
  return {
    grade,
    chainHops: hops.c,
    basis: `proxy-chain hops=${stat} statistical / min r2 ${hops.min_r2 ?? "n/a"} -> hop grade ${hopGrade}; provenance ${provenance ?? "unknown"} -> cap ${cap}${opts.synthesized ? " (deterministic synthesis, not a real estimate)" : ""}`,
  };
}
