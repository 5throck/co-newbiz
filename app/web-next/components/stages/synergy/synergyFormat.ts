// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import dynamic from "next/dynamic";
import type { SynergyAnalysis } from "./types.ts";

export const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

/** 회사 묶음 키 — 같은 대상(계열사/그룹/legacy 회사)의 분석을 한 묶음으로 나열한다. */
export function analysisGroupKey(a: SynergyAnalysis): string {
  return `${a.target_type ?? "legacy"}:${a.member_id ?? a.group_id ?? a.company_id ?? a.company_name}`;
}
/** 분석 대상 표기 — 신규(레지스트리)는 계열사/그룹명, legacy는 md_company 회사명 */
export function targetLabel(a: Pick<SynergyAnalysis, "target_type" | "member_name" | "group_name" | "company_name">): string {
  if (a.target_type === "affiliate") return a.member_name ?? a.company_name;
  if (a.target_type === "group") return a.group_name ?? "그룹 전체";
  return a.company_name;
}

export const STEP_TITLES = ["DART 재무 입수", "외부 리서치", "재무 강/약점 분석", "S1·S2 연계 시너지", "우선 시너지 영역 선별"];

// ADR-0094 역할 분리 — 재무 현황·강/약점 상세는 /our-company(그룹/계열사 분석)가
// 담당하고, /synergy는 시너지 고유 내용(연계 시너지·우선 시너지 영역)만 다룬다.
// ADR-0182: tab order follows the 4-element flow — 연계(후보) → 우선(선별) →
// 필요 역량(무엇이 필요한가) → 시너지 점수 평가(산정 근거·확정) → 의사결정 →
// 출처·노트. 프로파일 요약은 탭이 아니라 관계도 아래 컨텍스트로 상시 표시된다.
export const TABS = [
  ["linkage", "연계 시너지"],
  ["shortlist", "주요 검토 영역"],
  ["capability", "필요 역량"],
  ["scoreEval", "시너지 점수 평가"],
  ["decision", "의사결정"],
  ["refs", "출처·노트"],
] as const;

export type TabKey = (typeof TABS)[number][0];
/** Where the group / affiliate profile is registered: the deal's S3 company surface, or the standalone page. */
export function profileHrefFor(opportunityId?: string): string {
  return opportunityId ? `/deals/${encodeURIComponent(opportunityId)}/s3?surface=company` : "/our-company";
}
