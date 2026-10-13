// View model for the S4 route-decision history detail row. The compact table
// truncates rationale/alternatives; this builds the full, untruncated content.
export interface DecisionDetailInput {
  rationale: string;
  alternatives_considered: string | null;
  decided_by: string;
  decided_at: string;
  staging_recommended: string | null;
  total_score: number | null;
  scores?: { criterion: string; score: number; evidence_note: string }[] | null;
}

export interface DecisionDetail {
  rationale: string;
  alternatives: string;
  alternativesRecorded: boolean;
  scores: { criterion: string; score: number; evidenceNote: string }[];
  totalScore: number | null;
  staging: string | null;
  decidedBy: string;
  decidedAtFull: string;
}

export const NO_ALTERNATIVES_LABEL = "기록된 대안 없음";

/** "2026-10-13T09:03:17.853Z" -> "2026-10-13 09:03:17 UTC"; non-ISO input is returned trimmed. */
export function formatDecidedAtFull(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/.exec(iso ?? "");
  if (!m) return (iso ?? "").trim() || "-";
  return `${m[1]} ${m[2]}${/(Z|[+-]00:?00)$/.test(iso) ? " UTC" : ""}`;
}

export function buildDecisionDetail(d: DecisionDetailInput): DecisionDetail {
  const alt = (d.alternatives_considered ?? "").trim();
  return {
    rationale: d.rationale ?? "",
    alternatives: alt || NO_ALTERNATIVES_LABEL,
    alternativesRecorded: alt.length > 0,
    scores: (d.scores ?? []).map((s) => ({ criterion: s.criterion, score: s.score, evidenceNote: s.evidence_note })),
    totalScore: d.total_score,
    staging: d.staging_recommended?.trim() || null,
    decidedBy: d.decided_by,
    decidedAtFull: formatDecidedAtFull(d.decided_at),
  };
}
