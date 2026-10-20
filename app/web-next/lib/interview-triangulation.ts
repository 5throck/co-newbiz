// @version 1.0.0
/**
 * interview-triangulation — cdd-07 (checklists/commercial-dd-checklist.yaml,
 * mandatory): "전문가 인터뷰 삼각검증 준수 (주요 주장당 독립 출처 2~3개)". A
 * dd_interview row is ONE source for the key claim it names (`claim`, migration
 * 0159); this summary groups sources per claim and reports whether the claim
 * reaches the minimum independent-source count. Independence is counted by
 * distinct interviewee — two interviews with the same person are one source.
 * The cdd-07 verdict itself stays a human checklist judgement; this is its
 * evidence, not its decision.
 */

export const MIN_INDEPENDENT_SOURCES = 2;

export interface InterviewSourceRow {
  claim: string | null;
  interviewee: string;
  evidence_ref: string | null;
}

export interface ClaimTriangulation {
  claim: string;
  interview_count: number;
  independent_sources: number;
  evidence_refs: string[];
  triangulated: boolean;
}

export interface TriangulationSummary {
  claims: ClaimTriangulation[];
  /** Interviews recorded without a claim — they count toward no triangulation. */
  unclaimed: number;
  triangulated_count: number;
  pending_count: number;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function summarizeTriangulation(rows: InterviewSourceRow[]): TriangulationSummary {
  const byClaim = new Map<string, { claim: string; interviewees: Set<string>; count: number; refs: Set<string> }>();
  let unclaimed = 0;
  for (const r of rows) {
    const claim = (r.claim ?? "").trim();
    if (!claim) {
      unclaimed += 1;
      continue;
    }
    const k = norm(claim);
    const entry = byClaim.get(k) ?? { claim, interviewees: new Set<string>(), count: 0, refs: new Set<string>() };
    entry.count += 1;
    entry.interviewees.add(norm(r.interviewee));
    if (r.evidence_ref?.trim()) entry.refs.add(r.evidence_ref.trim());
    byClaim.set(k, entry);
  }
  const claims: ClaimTriangulation[] = [...byClaim.values()]
    .map((e) => ({
      claim: e.claim,
      interview_count: e.count,
      independent_sources: e.interviewees.size,
      evidence_refs: [...e.refs].sort(),
      triangulated: e.interviewees.size >= MIN_INDEPENDENT_SOURCES,
    }))
    .sort((a, b) => Number(a.triangulated) - Number(b.triangulated) || a.claim.localeCompare(b.claim, "ko"));
  const triangulated_count = claims.filter((c) => c.triangulated).length;
  return { claims, unclaimed, triangulated_count, pending_count: claims.length - triangulated_count };
}
