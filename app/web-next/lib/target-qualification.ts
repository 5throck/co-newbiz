// design 2026-11-21-s67-completion-visibility Fix ②-c — client-side mirror of
// `longListCandidateGaps` (lib/brownfield-targets.ts) for the candidate detail
// screen, where the server `gaps` field (list payload) is not present. The
// server field stays authoritative for the s67 screen; the parity between this
// helper and the engine helper is pinned by tests/unit/s67-candidate-gaps-parity.test.ts.

export type CandidateGap = "attributes" | "source";

/** The fields of the candidate detail payload (`bt.*` row + resolved company_id) the helper reads. */
export interface QualificationTarget {
  company_name: string;
  dart_corp_code: string | null;
  universe_note: string | null;
  company_id?: string | null;
  discovery_source?: string | null;
  proposal_accepted_at?: string | null;
}

/** One row of the detail payload's `evidence` array — only discovery rows matter. */
export interface QualificationEvidence {
  kind: string;
  detail: string | null;
  source_url: string | null;
}

/**
 * Same rule as `longListCandidateGaps`:
 *  - attributes: an identity (DART corp code or a resolved md_company) AND the universe-fit note,
 *    next to the company name;
 *  - source: an accepted master/web proposal (discovery_source !== "manual" AND proposal_accepted_at),
 *    OR ≥1 discovery evidence row carrying a source URL or a detail note.
 * Returns the missing parts ([] = qualified).
 */
export function clientCandidateGaps(t: QualificationTarget, evidence: QualificationEvidence[]): CandidateGap[] {
  const gaps: CandidateGap[] = [];
  const hasIdentity = Boolean((t.dart_corp_code ?? "").trim() || t.company_id);
  if (!t.company_name.trim() || !hasIdentity || !(t.universe_note ?? "").trim()) gaps.push("attributes");
  const acceptedProposal = t.discovery_source !== "manual" && Boolean(t.proposal_accepted_at);
  // TRIM(COALESCE(source_url,'')) != '' OR TRIM(COALESCE(detail,'')) != '' — the engine helper's SQL, verbatim.
  const discovery = evidence.some(
    (e) => e.kind === "discovery" && ((e.source_url ?? "").trim() !== "" || (e.detail ?? "").trim() !== ""),
  );
  if (!acceptedProposal && !discovery) gaps.push("source");
  return gaps;
}
