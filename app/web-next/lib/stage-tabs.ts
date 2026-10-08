// Per-stage tab map (Wave U-1, design §3.4) — the single config that replaces
// the ~30-link ProjectSubNav. Layer 1 is the sidebar, layer 2 the stage
// stepper; everything here is content inside a stage: at most MAX_PRIMARY_TABS
// primary tabs per stage and a "More" overflow for the long tail. Pure data so
// the mapping is unit-testable without a DOM.
import type { StageMetaId } from "./stage-meta.ts";

export type ProjectStageId = Extract<StageMetaId, "S8" | "S9" | "S10" | "S11" | "S12">;

export interface StageTabDef {
  /** Path segment under /projects/[id] ("" = project overview). */
  seg: string;
  label: string;
  /** Optional ?tab= value for tabs that live inside one page (e.g. business-case). */
  query?: string;
}

export interface StageTabGroup {
  stage: ProjectStageId;
  name: string;
  tabs: StageTabDef[];
  more: StageTabDef[];
}

export const MAX_PRIMARY_TABS = 5;

export const STAGE_TAB_GROUPS: StageTabGroup[] = [
  {
    stage: "S8", name: "사업성 분석",
    tabs: [
      { seg: "", label: "요약" },
      { seg: "/business-case", label: "분석" },
      { seg: "/wacc", label: "WACC" },
      { seg: "/financial-analysis", label: "재무분석" },
    ],
    more: [
      { seg: "/business-case", query: "target-costing", label: "타겟코스팅" },
      { seg: "/risk-heatmap", label: "리스크 히트맵" },
    ],
  },
  {
    stage: "S9", name: "실사·검증",
    tabs: [
      { seg: "/dd", label: "실사 워크스페이스" },
      { seg: "/proxy-chain", label: "가치사슬 연계" },
    ],
    more: [
      { seg: "/interviews", label: "인터뷰" },
      { seg: "/comp-parity", label: "보상·형평" },
      { seg: "/customer-coc", label: "고객 CoC" },
      { seg: "/backtest", label: "백테스트" },
    ],
  },
  {
    stage: "S10", name: "투자구조 설계",
    tabs: [
      { seg: "/deal-structure", label: "투자구조" },
      { seg: "/debt", label: "부채" },
    ],
    more: [
      { seg: "/incentives", label: "인센티브" },
      { seg: "/sites", label: "부지·시설" },
      { seg: "/permits", label: "인허가·인증" },
    ],
  },
  {
    stage: "S11", name: "투자심사·실행",
    tabs: [
      { seg: "/ic-review", label: "IC 심의" },
      { seg: "/reports", label: "보고서" },
    ],
    more: [
      { seg: "/share", label: "외부 공유" },
      { seg: "/agent-runs", label: "에이전트 이력" },
    ],
  },
  {
    stage: "S12", name: "사후 관리",
    tabs: [
      { seg: "/portfolio", label: "포트폴리오" },
      { seg: "/pmi", label: "PMI" },
      { seg: "/charter", label: "추진계획" },
    ],
    more: [
      { seg: "/partnership", label: "파트너·JV" },
      { seg: "/process", label: "프로세스" },
      { seg: "/timeline", label: "타임라인·SLA" },
    ],
  },
];

/** Segment ("" for the overview) of a /projects/{id}/… pathname, or null. */
export function projectSegment(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/[^/]+(\/[^/?#]*)?\/?$/);
  if (!m) return null;
  return m[1] ?? "";
}

/** The stage group that owns a path segment; the overview belongs to S8. */
export function groupForSegment(seg: string): StageTabGroup | null {
  return (
    STAGE_TAB_GROUPS.find((g) => [...g.tabs, ...g.more].some((t) => t.seg === seg)) ?? null
  );
}

/** Index into [...tabs, ...more] of the active entry (tab-query match wins). */
export function activeTabIndex(group: StageTabGroup, seg: string, tabParam: string | null): number {
  const all = [...group.tabs, ...group.more];
  const exactQuery = all.findIndex((t) => t.seg === seg && t.query !== undefined && t.query === tabParam);
  if (exactQuery >= 0) return exactQuery;
  return all.findIndex((t) => t.seg === seg && t.query === undefined);
}

export function tabHref(projectId: string, t: StageTabDef): string {
  const base = `/projects/${projectId}${t.seg}`;
  return t.query ? `${base}?tab=${t.query}` : base;
}
