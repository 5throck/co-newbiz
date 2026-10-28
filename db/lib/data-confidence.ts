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
//   U         ADR-0187 D1 (migration 0180): NO proxy hop recorded and the
//               source is not direct data -> U (unknown), never a defaulted
//               B; rationale `no_chain_recorded`. U caps RAG at Amber and is
//               never Green. Write-time only: stored grades are not re-graded.
import type { Database } from "bun:sqlite";
import { type DataConfidence, gradeDataConfidence } from "../../packages/core-scoring/src/data-confidence.ts";

export * from "../../packages/core-scoring/src/data-confidence.ts";

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

  return gradeDataConfidence({
    chainHops: hops.c,
    statisticalHops: hops.stat ?? 0,
    minR2: hops.min_r2,
    provenance,
    synthesized: opts.synthesized,
  });
}
