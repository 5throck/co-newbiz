// Value-chain proposal sanitizer (design 2026-09-13, methodology panel P0).
// The 1st-pass LLM proposal may return relation labels outside the stored
// taxonomy (전방|전전방|후방|후후방 — proxy_link CHECK, migration 0093). The
// panel ruled: never silently DROP a real relationship. Substitutes and
// complements (e.g. 전기식 브레이커 vs 유압식) are real 6-axis linkage
// findings, so they are separated out for the UI to surface as "대체 위협
// (검토 필요)" — not stored as chain candidates, never vanished.

export interface RelatedIndustryProposal {
  relation: string;
  name: string;
  note?: string;
}

export interface SanitizedProposals {
  /** Chain candidates — relation within the stored taxonomy. */
  accepted: RelatedIndustryProposal[];
  /** Substitute/complement findings — 6축 대체 위협 검토 대상 (not chain candidates). */
  substitutes: RelatedIndustryProposal[];
  /** Count of entries dropped for unusable relations or empty/self names. */
  dropped: number;
}

const CHAIN_RELATIONS = new Set(["전방", "전전방", "후방", "후후방"]);
const MAX_PROPOSALS = 6;

function norm(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

// LLM 응답이 산업명 안에 출처 인용 표기([2], [11] 등)를 그대로 남기는 경우가
// 있다 — 산업명은 저장·표시용 식별자이므로 인용 표기가 섞이면 안 된다
// (사용자 리포트, 2026-09-16 — "산업명에 [X]와 같은 표기가 나타나지 않는게
// 바람직할 듯"). 이름 어디에 붙어 있든 제거한다.
export function stripCitationMarkers(name: string): string {
  return name.replace(/\s*\[\d+\]/g, "").trim();
}

export function sanitizeRelatedProposals(
  items: Array<{ relation?: string; name?: string; note?: string }>,
  targetName: string,
): SanitizedProposals {
  const accepted: RelatedIndustryProposal[] = [];
  const substitutes: RelatedIndustryProposal[] = [];
  let dropped = 0;
  const targetNorm = norm(targetName);
  for (const item of items) {
    const name = stripCitationMarkers(item.name?.trim() ?? "");
    const relation = item.relation?.trim() ?? "";
    if (!name || norm(name) === targetNorm) {
      dropped += 1;
      continue;
    }
    if (CHAIN_RELATIONS.has(relation)) {
      if (accepted.length >= MAX_PROPOSALS) {
        dropped += 1;
        continue;
      }
      accepted.push({ relation, name, note: item.note?.trim() || undefined });
      continue;
    }
    if (/대체|보완/.test(relation)) {
      substitutes.push({ relation, name, note: item.note?.trim() || undefined });
      continue;
    }
    dropped += 1;
  }
  return { accepted, substitutes, dropped };
}
