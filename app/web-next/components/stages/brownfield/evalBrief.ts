// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SCREENING_VERDICT_KO, normalizeVerdict } from "../../../lib/brownfield-precheck.ts";
import { TranslatorFn } from "../../../i18n/config.ts";
import type { TargetRow, ChecklistItem, PrecheckDraftItem } from "./types.ts";

// 사전 검토(대상 사전 검토 체크리스트) 판정 척도 — 5단 세분화(2026-09-16). 정의·
// 라벨·정규화는 lib/brownfield-precheck.ts(클라이언트 세이프 공용)에서 온다.

// 위원회 심의(target-longlist-shortlist-committee) 판정 근거 — 후보별 사전
// 검토(스크리닝 9개 항목) 판정 현황을 표로 압축해 소집 topic에 붙인다
// (사용자 요청 2026-09-15 · 2026-09-16 — 위원회 근거는 9개 항목, 랭킹에 쓰는
// 재무·기술 평가와 역할을 분리). 판정 기록은 이 화면 "사전 검토" 섹션에서
// 인라인으로 한다. 종합 점수는 참고로만 덧붙인다. 제외된 후보는 뺀다.
// 프롬프트 비대화 방지로 최대 12개 후보만 담는다.
export function buildEvalBriefMd(targets: TargetRow[], checklist: ChecklistItem[], overrides: Record<string, Record<string, PrecheckDraftItem>> | undefined, t: TranslatorFn): string | undefined {
  const candidates = targets.filter((t) => t.status !== "excluded").slice(0, 12);
  if (candidates.length === 0) return undefined;
  const ids = checklist.map((it) => it.id);
  if (ids.length === 0) return undefined;
  // 안건 — 위원회가 심의할 "요청된 결정"을 한눈에 알 수 있게 brief 최상단에
  // 명시한다(사용자 리포트, 2026-09-16: 무슨 안건인지 불명확).
  const agenda = [
    t("stages.s67.evalBrief.dealsShortlistFinalRecommendationTarget"),
    "",
    t("stages.s67.evalBrief.targetCandidatesP1", { p1: candidates.map((t) => `${t.company_name}${t.rank ? ` (rank ${t.rank})` : ""}`).join(", ") }),
    t("stages.s67.evalBrief.requestedDecisionBasedOnEach"),
    t("stages.s67.evalBrief.deliberatesAndProposesOneOf"),
  ].join("\n");
  const header = t("stages.s67.evalBrief.candidateP1JudgementCompositeScore", { p1: ids.join(" | ") });
  const sep = `| --- |${" --- |".repeat(ids.length + 1)}`;
  let hasProposed = false;
  const rows = candidates.map((t) => {
    const saved = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};
    const proposed = overrides?.[t.id] ?? {};
    const states: Record<string, string> = { ...saved };
    for (const [itemId, d] of Object.entries(proposed)) {
      if (d.verdict) {
        states[itemId] = d.verdict;
        if (!saved[itemId] || saved[itemId] === "pending") hasProposed = true;
      }
    }
    const verdicts = ids.map((id) => SCREENING_VERDICT_KO[normalizeVerdict(states[id])]);
    const assessed = ids.filter((id) => normalizeVerdict(states[id]) !== "pending").length;
    return `| ${t.company_name} | ${verdicts.join(" | ")} | ${assessed}/${ids.length} | ${t.eval_summary?.combined ?? "—"} |`;
  });
  const legend = t("stages.s67.evalBrief.judgementScaleMetClearEvidence") + (hasProposed ? t("stages.s67.evalBrief.someJudgementsAreCommitteeProposal") : "");
  return [agenda, "", header, sep, ...rows, "", legend].join("\n").slice(0, 4000);
}
