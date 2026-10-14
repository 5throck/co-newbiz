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
  /** Extra ?tab= values that highlight this tab (old deep links, aliases). */
  aliases?: string[];
  /** Extra path segments whose pages belong under this tab (e.g. /wacc under the financial lens). */
  extraSegs?: string[];
  /** Highlighted for its own seg when no other entry matches (unknown or missing ?tab=). */
  isDefault?: boolean;
  /** S8 lens the tab belongs to (ADR-0169); the financial lens owns a sub-tab row. */
  lens?: "technical" | "financial";
}

export interface StageTabGroup {
  stage: ProjectStageId;
  name: string;
  tabs: StageTabDef[];
  more: StageTabDef[];
  /** Second row shown while a tab with `lens: "financial"` is active (S8 only). */
  subtabs?: StageTabDef[];
}

export const MAX_PRIMARY_TABS = 5;

export const STAGE_TAB_GROUPS: StageTabGroup[] = [
  {
    stage: "S8", name: "사업성 분석",
    // ADR-0169: three parts (사업 목표 / 기술적 타당성 / 재무적 타당성); WACC, 재무분석 and the
    // scenario comparison are the financial sub-tab row. INTERIM-WORDING: labels are provisional.
    tabs: [
      { seg: "/business-case", query: "goals", label: "사업 목표" }, // INTERIM-WORDING (ADR-0159)
      { seg: "/business-case", query: "technical", label: "기술적 타당성", aliases: ["capability"], lens: "technical" },
      { seg: "/business-case", query: "financial", label: "재무적 타당성", aliases: ["scenarios", "overview", "params", "target-costing"], extraSegs: ["/wacc", "/financial-analysis"], isDefault: true, lens: "financial" },
      { seg: "/business-case", query: "targets", label: "대상 비교·선정" },
      { seg: "/business-case", query: "decision", label: "결정" },
    ],
    more: [
      { seg: "", label: "요약" },
      { seg: "/risk-heatmap", label: "리스크 히트맵" },
    ],
    subtabs: [
      { seg: "/business-case", query: "overview", label: "설명·생성·권고", isDefault: true },
      { seg: "/business-case", query: "scenarios", label: "시나리오 비교" },
      { seg: "/wacc", label: "WACC" },
      { seg: "/financial-analysis", label: "재무분석" },
      { seg: "/business-case", query: "params", label: "파라미터·스냅샷" },
      { seg: "/business-case", query: "target-costing", label: "타겟코스팅" },
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
      { seg: "/ic-review", label: "투자심의" },
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
    STAGE_TAB_GROUPS.find((g) => allDefs(g).some((t) => t.seg === seg || t.extraSegs?.includes(seg))) ?? null
  );
}

/** Every destination a group exposes: primary tabs, more-menu and the sub-tab row. */
export function allDefs(group: StageTabGroup): StageTabDef[] {
  return [...group.tabs, ...group.more, ...(group.subtabs ?? [])];
}

function matchIndex(defs: StageTabDef[], seg: string, tabParam: string | null): number {
  const param = tabParam === null ? null : tabParam.split("#")[0];
  const exact = defs.findIndex((t) => t.seg === seg && t.query !== undefined && param !== null && (t.query === param || (t.aliases?.includes(param) ?? false)));
  if (exact >= 0) return exact;
  const extra = defs.findIndex((t) => t.extraSegs?.includes(seg));
  if (extra >= 0) return extra;
  const plain = defs.findIndex((t) => t.seg === seg && t.query === undefined);
  if (plain >= 0) return plain;
  return defs.findIndex((t) => t.seg === seg && t.isDefault);
}

/** Index into [...tabs, ...more] of the active entry (tab-query match wins). */
export function activeTabIndex(group: StageTabGroup, seg: string, tabParam: string | null): number {
  return matchIndex([...group.tabs, ...group.more], seg, tabParam);
}

/** Index into group.subtabs of the active sub-tab, or -1 when the sub-row is not shown
 * (the active primary tab is not a financial-lens tab, or the group has no sub-row). */
export function activeSubtabIndex(group: StageTabGroup, seg: string, tabParam: string | null): number {
  if (!group.subtabs || group.subtabs.length === 0) return -1;
  const primary = activeTabIndex(group, seg, tabParam);
  const def = primary >= 0 ? [...group.tabs, ...group.more][primary] : undefined;
  if (def?.lens !== "financial") return -1;
  return matchIndex(group.subtabs, seg, tabParam);
}

export function tabHref(projectId: string, t: StageTabDef): string {
  const base = `/projects/${projectId}${t.seg}`;
  return t.query ? `${base}?tab=${t.query}` : base;
}

/** Greenfield has no target axis (ADR-0159): drop the target compare/select tab. */
export function groupForTrack(group: StageTabGroup, track: string | null | undefined): StageTabGroup {
  if (track !== "greenfield") return group;
  const keep = (t: StageTabDef) => !(t.seg === "/business-case" && t.query === "targets");
  return { ...group, tabs: group.tabs.filter(keep), more: group.more.filter(keep), ...(group.subtabs ? { subtabs: group.subtabs.filter(keep) } : {}) };
}

/**
 * ADR-0161 PMI guard for the tab map: the S12 PMI tab is shown only when
 * `pmiKickoffApplies(track, subTrack)` is true (pass that result in). Pure;
 * every other tab and every group for PMI-applicable projects is returned
 * unchanged (same object identity), so brownfield M&A renders byte-identical.
 */
export function stageTabGroupsFor(opts: { pmiApplies: boolean }, groups: StageTabGroup[] = STAGE_TAB_GROUPS): StageTabGroup[] {
  if (opts.pmiApplies) return groups;
  return groups.map((g) =>
    g.tabs.some((t) => t.seg === "/pmi") || g.more.some((t) => t.seg === "/pmi")
      ? { ...g, tabs: g.tabs.filter((t) => t.seg !== "/pmi"), more: g.more.filter((t) => t.seg !== "/pmi") }
      : g,
  );
}
