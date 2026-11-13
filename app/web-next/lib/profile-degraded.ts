// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14 (3): a company profile generated while external search returned nothing carries
 * qualitative text (strengths, weaknesses, assessment, SWOT, competitors) that is an LLM guess. The pipeline marks
 * it through the existing `degraded` field with this reason prefix so screens can show a warning chip and the S3
 * holding check can treat that text as unverified. Stored historical profiles are never rewritten.
 */
export const NO_RESEARCH_DEGRADED_PREFIX = "외부 검색 근거 없음";

/** DART outcome of the same run (design 2026-11-13-profile-headless-fallback §5): when the disclosure
 * lookup succeeded the degraded reason must say so, so a DART-successful profile is never read as
 * "DART AND market research failed". years is the " / "-joined coverage, accounts the item count. */
export interface DartGroundingInfo {
  found: boolean;
  years: string;
  accounts: number;
}

/**
 * No-search degraded reason. The `외부 검색 근거 없음` prefix is load-bearing (isNoResearchDegraded
 * consumers: chip suppression, analyst-edit clearing, holding-check evidence labels, structural tests).
 * With dart.found the tail splits honestly — financial analysis is disclosure-based and only the
 * qualitative items are AI estimates; without DART the original wording is kept unchanged
 * (there "no grounds at all" is true and the message must not soften).
 */
export function noResearchDegradedReason(
  causes: string[],
  searchConfigured: boolean,
  dart?: DartGroundingInfo,
): string {
  const why = causes.length > 0 ? ` (${causes.join(", ")})` : searchConfigured ? "" : " (웹 검색 미구성)";
  if (dart?.found) {
    return `${NO_RESEARCH_DEGRADED_PREFIX}${why} — DART 재무는 정상 입수(${dart.years}, ${dart.accounts}계정): 재무 분석은 공시 기반이므로 유지되며, 정성 항목(강점·약점·SWOT·경쟁)만 AI 추정이며 검증되지 않았습니다`;
  }
  return `${NO_RESEARCH_DEGRADED_PREFIX}${why} — 정성 항목은 AI 추정이며 검증되지 않았습니다`;
}

export function isNoResearchDegraded(degraded: string | null | undefined): boolean {
  return typeof degraded === "string" && degraded.startsWith(NO_RESEARCH_DEGRADED_PREFIX);
}

/** Chip wording for a degraded profile (icon is added by the component). With dartGrounded the label
 * distinguishes the DART-grounded split (financial analysis kept on disclosure data, only qualitative
 * items unverified); the full reason stays the chip title, so the year/account detail is one hover away. */
export function degradedChip(degraded: string, dartGrounded?: boolean): { label: string; hint: string } {
  return isNoResearchDegraded(degraded)
    ? dartGrounded
      ? {
          label: "검색 근거 없음 — 재무는 공시 기반, 정성 항목 미검증(AI 추정)",
          hint: "검색이 복구되면 재분석해 프로필을 다시 생성하세요.",
        }
      : {
          label: "검색 근거 없음 — 정성 항목 미검증(AI 추정)",
          hint: "검색이 복구되면 재분석해 프로필을 다시 생성하세요.",
        }
    : { label: "부분 분석(폴백)", hint: "재분석을 권장합니다." };
}
