// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import dynamic from "next/dynamic";
import type { CompetitiveCrossCheck, CrossCheckVerdict } from "./types.ts";

export const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

export const PROFILE_TABS = [
  ["overview", "개요"],
  ["financials", "재무"],
  ["swot", "강·약점 SWOT"],
  ["industry", "산업 연계"],
  ["competitive", "경쟁"],
  ["sources", "출처·데이터"],
] as const;

export const CROSSCHECK_STATUS_META: Record<CompetitiveCrossCheck["status"], { label: string; chip: string }> = {
  cross_checked: { label: "공시 원문 대조 완료", chip: "status-green" },
  dart_unavailable: { label: "공시 대조 불가", chip: "status-amber" },
  research_only: { label: "리서치 대조만 (비상장)", chip: "status-in-progress" },
};
export const CROSSCHECK_VERDICT_META: Record<CrossCheckVerdict, { label: string; chip: string }> = {
  confirmed: { label: "확인", chip: "status-green" },
  directional: { label: "방향성 일치", chip: "status-in-progress" },
  contradicted: { label: "상충", chip: "status-red" },
  unverified: { label: "검증 불가", chip: "status-amber" },
};