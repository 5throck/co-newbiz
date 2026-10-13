// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SCREENING_VERDICT_KO, normalizeVerdict } from "../../../lib/brownfield-precheck.ts";
import type { TargetRow, ChecklistItem, PrecheckDraftItem } from "./types.ts";

// 사전 검토(대상 사전 검토 체크리스트) 판정 척도 — 5단 세분화(2026-09-16). 정의·
// 라벨·정규화는 lib/brownfield-precheck.ts(클라이언트 세이프 공용)에서 온다.

// 위원회 심의(target-longlist-shortlist-committee) 판정 근거 — 후보별 사전
// 검토(스크리닝 9개 항목) 판정 현황을 표로 압축해 소집 topic에 붙인다
// (사용자 요청 2026-09-15 · 2026-09-16 — 위원회 근거는 9개 항목, 랭킹에 쓰는
// 재무·기술 평가와 역할을 분리). 판정 기록은 이 화면 "사전 검토" 섹션에서
// 인라인으로 한다. 종합 점수는 참고로만 덧붙인다. 제외된 후보는 뺀다.
// 프롬프트 비대화 방지로 최대 12개 후보만 담는다.
export function buildEvalBriefMd(targets: TargetRow[], checklist: ChecklistItem[], overrides?: Record<string, Record<string, PrecheckDraftItem>>): string | undefined {
  const candidates = targets.filter((t) => t.status !== "excluded").slice(0, 12);
  if (candidates.length === 0) return undefined;
  const ids = checklist.map((it) => it.id);
  if (ids.length === 0) return undefined;
  // 안건 — 위원회가 심의할 "요청된 결정"을 한눈에 알 수 있게 brief 최상단에
  // 명시한다(사용자 리포트, 2026-09-16: 무슨 안건인지 불명확).
  const agenda = [
    "# 안건 — 최종 후보 목록 최종 추천 여부 (대상 선정 게이트)",
    "",
    `대상 후보: ${candidates.map((t) => `${t.company_name}${t.rank ? ` (rank ${t.rank})` : ""}`).join(", ")}`,
    "요청 결정: 후보별로 대상 사전 검토 체크리스트(9개 항목) 판정(아래 표 — 확정값과 확정 전 제안값 포함)과 재무·기술 평가 종합 점수를 근거로,",
    "추천 / 조건부 추천 / 보류(근거 부족) / 제외 검토 중 하나의 의사를 심의해 제안한다. 최종 게이트 결정(진행/보류/중단)은 사람이 한다.",
  ].join("\n");
  const header = `| 후보 | ${ids.join(" | ")} | 판정 | 종합 점수 |`;
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
  const legend = "판정 척도: 충족(근거 명확)/충족(추정)/부분 충족/미충족/근거 부족/미판정 — 9개 항목는 대상 사전 검토 체크리스트 사전 검토(이 화면 최종 후보 목록 섹션에서 기록). 종합 점수는 재무·기술 평가(랭킹용)로 위원회 근거와 역할이 다르다." + (hasProposed ? " ※ 일부 판정은 사람이 아직 확정 전인 위원회 제안값입니다." : "");
  return [agenda, "", header, sep, ...rows, "", legend].join("\n").slice(0, 4000);
}