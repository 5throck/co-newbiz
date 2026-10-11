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

/** A profile analyzed more than this many days ago is flagged "stale" (re-analysis recommended). */
export const PROFILE_STALE_DAYS = 90;

// Copy for the 2026-10-11 /our-company refinement. Strings marked INTERIM-WORDING are new
// Korean wording pending human wording review; the rest reuses existing vocabulary.
export const OUR_COMPANY_COPY = {
  // INTERIM-WORDING
  s3Lead: "이 프로파일은 단계 S3 시너지·적합성 평가의 입력입니다.",
  // INTERIM-WORDING
  howUsedSummary: "활용 방식",
  howUsedBody: "자사 역량·포트폴리오 정보로 사용됩니다. 상장 계열사는 DART 재무제표, 전체는 애널리스트 리포트·산업 동향 리서치로 분석합니다.",
  // INTERIM-WORDING
  groupMore: "그룹 작업 더보기",
  groupEdit: "그룹명 수정",
  groupDelete: "그룹 삭제",
  // INTERIM-WORDING
  notAnalyzedYet: "아직 분석 전",
  // INTERIM-WORDING
  rowMore: "작업 더보기",
  // INTERIM-WORDING
  stale: "오래됨",
  // INTERIM-WORDING
  staleHint: `분석 후 ${PROFILE_STALE_DAYS}일 넘게 지났습니다 — 재분석을 권장합니다`,
  // INTERIM-WORDING
  groupLoading: "그룹을 불러오는 중...",
} as const;

/** Affiliate table column shares in percent (name, role, DART code, status, date, actions); must sum to 100 so every column scales together. */
export const MEMBER_COL_PCT = [24, 12, 14, 18, 14, 18] as const;
/** Confirmed-competitor table column shares in percent (name, DART code, relation, source, cross-check, actions); sums to 100. */
export const COMPETITOR_COL_PCT = [18, 12, 24, 16, 14, 16] as const;
