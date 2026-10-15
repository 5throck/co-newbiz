// S5 Green Field screen: tab structure and pure presentation helpers (no behaviour, API or storage).
// Tabs follow the dependency order of the data: entry strategy -> required capability -> staffing ->
// investment -> simulation (ADR-0176, not implemented) -> review/confirm.

export const GF_TAB_KEYS = ["entry", "capability", "staffing", "investment", "simulation", "review"] as const;
export type GfTabKey = (typeof GF_TAB_KEYS)[number];

export const GF_TAB_LABELS: Record<GfTabKey, string> = {
  entry: "진출전략",
  capability: "필요 역량",
  staffing: "인력 운영 계획",
  investment: "투자비",
  simulation: "투자 시뮬레이션",
  review: "검토/확정",
};

export const GF_DEFAULT_TAB: GfTabKey = "entry";

/** URL ?tab= parser: a `#item` suffix is ignored, unknown or missing values land on the entry tab. */
export function parseGfTab(raw: string | null | undefined): GfTabKey {
  const key = (raw ?? "").split("#")[0];
  return (GF_TAB_KEYS as readonly string[]).includes(key) ? (key as GfTabKey) : GF_DEFAULT_TAB;
}

// ── Unsaved-change aggregation ───────────────────────────────────────────

/** Tabs that own editable state. Simulation owns none. */
export type GfDirtyKey = Exclude<GfTabKey, "simulation">;
export type GfDirtyFlags = Partial<Record<GfDirtyKey, boolean>>;

export interface DirtyAggregate {
  count: number;
  /** Tab keys with unsaved changes, in tab order. */
  tabs: GfDirtyKey[];
  /** Tab labels, in tab order. */
  labels: string[];
}

export function aggregateDirty(flags: GfDirtyFlags): DirtyAggregate {
  const tabs = GF_TAB_KEYS.filter((k): k is GfDirtyKey => k !== "simulation" && flags[k] === true);
  return { count: tabs.length, tabs, labels: tabs.map((k) => GF_TAB_LABELS[k]) };
}

export function dirtyIndicatorText(agg: DirtyAggregate): string | null {
  return agg.count === 0 ? null : `저장하지 않은 변경 ${agg.count}곳`;
}

// ── 출처 요약 (investment tab strip) ─────────────────────────────────────

export interface SourceSummaryInput {
  reflectedCapabilityCount: number;
  staffingKrwM: number;
  manualCount: number;
  needsConfirmCount: number;
}
export interface SourceSummaryChip { key: "capability" | "staffing" | "manual" | "confirm"; text: string; tab: GfTabKey; icon: string }

const fmtKrwM = (n: number) => (Math.round(n * 100) / 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 });

export function buildSourceSummary(i: SourceSummaryInput): SourceSummaryChip[] {
  return [
    { key: "capability", icon: "⛓", text: `역량 ${i.reflectedCapabilityCount}건 반영`, tab: "capability" },
    { key: "staffing", icon: "👥", text: `인력 운영 계획 인건비 ${fmtKrwM(i.staffingKrwM)}백만원`, tab: "staffing" },
    { key: "manual", icon: "✎", text: `수동 항목 ${i.manualCount}건`, tab: "investment" },
    { key: "confirm", icon: "!", text: `확인 필요 ${i.needsConfirmCount}건`, tab: "investment" },
  ];
}

// ── Completion checklist (review tab) and per-tab markers ────────────────

export type CompletionStatus = "dirty" | "issues" | "filled" | "empty";
export interface CompletionItem {
  key: "entry" | "capability" | "staffing" | "investment";
  label: string;
  tab: GfTabKey;
  status: CompletionStatus;
  issues: number;
  /** Chip text: 채움 / 확인 필요 N건 / 저장 전 변경 / 미입력. */
  statusText: string;
}
export interface CompletionInput {
  entry: { filled: boolean; dirty: boolean };
  /** issues = rows without a grade or needing re-judgement. */
  capability: { filled: boolean; dirty: boolean; issues: number };
  staffing: { filled: boolean; dirty: boolean; issues: number };
  /** issues = capability rows needing re-judgement + staffing/manual lines that need confirmation. */
  investment: { filled: boolean; dirty: boolean; issues: number };
}

export function statusOf(filled: boolean, dirty: boolean, issues: number): CompletionStatus {
  if (dirty) return "dirty";
  if (!filled) return "empty";
  return issues > 0 ? "issues" : "filled";
}

export function statusText(status: CompletionStatus, issues: number): string {
  return status === "dirty" ? "저장 전 변경" : status === "issues" ? `확인 필요 ${issues}건` : status === "filled" ? "채움" : "미입력";
}

export function buildCompletionChecklist(input: CompletionInput): CompletionItem[] {
  const rows: Array<[CompletionItem["key"], string, GfTabKey, { filled: boolean; dirty: boolean; issues?: number }]> = [
    ["entry", "진출전략", "entry", input.entry],
    ["capability", "필요 역량 판정", "capability", input.capability],
    ["staffing", "인력 운영 계획", "staffing", input.staffing],
    ["investment", "투자비", "investment", input.investment],
  ];
  return rows.map(([key, label, tab, s]) => {
    const issues = s.issues ?? 0;
    const status = statusOf(s.filled, s.dirty, issues);
    return { key, label, tab, status, issues, statusText: statusText(status, issues) };
  });
}

/** "N/4 구성요소" counter: components with content. */
export function filledComponentCount(items: CompletionItem[]): number {
  return items.filter((i) => i.status !== "empty").length;
}

export interface TabMarker { kind: "dirty" | "issues" | "done" | "none"; text: string }

/** Tab-level marker (icon is rendered by the caller; text is never colour-only). Issues win over done; dirty wins over both. */
export function tabMarker(item: Pick<CompletionItem, "status" | "issues"> | null): TabMarker {
  if (!item) return { kind: "none", text: "" };
  if (item.status === "dirty") return { kind: "dirty", text: "저장 전 변경" };
  if (item.status === "issues") return { kind: "issues", text: `확인 필요 ${item.issues}` };
  if (item.status === "filled") return { kind: "done", text: "✓" };
  return { kind: "none", text: "" };
}
