// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { TranslatorFn } from "../../../i18n/config.ts";
import type { EvalItem, TargetRow } from "./types.ts";
import { useTranslations } from "next-intl";

export const EVAL_CATEGORY_LABEL = (tr: TranslatorFn): Record<EvalItem["category"], string> => ({ financial: "stages.s67.constants.financialEvaluation", technical: "stages.s67.constants.technicalEvaluation" });

export const STATUS_LABEL = (tr: TranslatorFn): Record<TargetRow["status"], string> => ({ pending: "stages.s67.constants.underReview", shortlisted: "stages.s67.constants.shortlist", excluded: "common.exclude" });

// mockup baseline-v5.html의 S6/S7은 탭으로 나뉘지 않은 단일 연속 화면이다
// (Universe 정의 → 후보 발굴 → 후보 전체 목록(판정·랭킹·최종 후보 목록) → 위원회 심의
// → 게이트, 전부 한 페이지). 탭을 없애고 흐름 배너는 섹션으로 스크롤 이동만
// 한다(사용자 요청, 2026-09-15).
export const SECTION_IDS = { universe: "s6s7-universe", longlist: "s6s7-longlist", shortlist: "s6s7-shortlist" } as const;
/**
 * Column shares (%) of the S6/S7 pre-review / committee recommendation table (candidate, one column
 * per checklist item, confirm). The item count comes from the checklist, so the preset is computed;
 * it always sums to 100 (the remainder goes to the last column).
 */
export function shortlistColPct(itemCount: number): number[] {
  const first = 14;
  const itemShare = Math.floor((77 / Math.max(1, itemCount)) * 100) / 100;
  const last = Math.round((100 - first - itemShare * itemCount) * 100) / 100;
  return [first, ...Array.from({ length: itemCount }, () => itemShare), last];
}
