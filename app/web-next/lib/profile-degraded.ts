// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14 (3): a company profile generated while external search returned nothing carries
 * qualitative text (strengths, weaknesses, assessment, SWOT, competitors) that is an LLM guess. The pipeline marks
 * it through the existing `degraded` field with this reason prefix so screens can show a warning chip and the S3
 * holding check can treat that text as unverified. Stored historical profiles are never rewritten.
 */
export const NO_RESEARCH_DEGRADED_PREFIX = "외부 검색 근거 없음";

/** "외부 검색 근거 없음 (Tavily 쿼터 초과(432), DuckDuckGo 봇 차단) — 정성 항목은 AI 추정이며 검증되지 않았습니다" */
export function noResearchDegradedReason(causes: string[], searchConfigured: boolean): string {
  const why = causes.length > 0 ? ` (${causes.join(", ")})` : searchConfigured ? "" : " (웹 검색 미구성)";
  return `${NO_RESEARCH_DEGRADED_PREFIX}${why} — 정성 항목은 AI 추정이며 검증되지 않았습니다`;
}

export function isNoResearchDegraded(degraded: string | null | undefined): boolean {
  return typeof degraded === "string" && degraded.startsWith(NO_RESEARCH_DEGRADED_PREFIX);
}

/** Chip wording for a degraded profile (icon is added by the component). */
export function degradedChip(degraded: string): { label: string; hint: string } {
  return isNoResearchDegraded(degraded)
    ? { label: "검색 근거 없음 — 정성 항목 미검증(AI 추정)", hint: "검색이 복구되면 재분석해 프로필을 다시 생성하세요." }
    : { label: "부분 분석(폴백)", hint: "재분석을 권장합니다." };
}
