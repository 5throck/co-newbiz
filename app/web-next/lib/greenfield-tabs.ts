// S5 Green Field screen: tab structure and pure presentation helpers (no behaviour, API or storage).
// Tabs follow the dependency order of the data: entry strategy -> required capability -> staffing ->
// investment -> simulation (ADR-0176, not implemented) -> review/confirm.
// Display text is catalog-driven (ADR-0184): helpers return catalog keys/values and every render
// site resolves them with the `stages.s5.tabs` translator (ADR-0184 i18n adoption).
import { formatNumber, type Locale } from "./format.ts";

export const GF_TAB_KEYS = ["entry", "capability", "staffing", "investment", "simulation", "review"] as const;
export type GfTabKey = (typeof GF_TAB_KEYS)[number];

export const GF_DEFAULT_TAB: GfTabKey = "entry";

/** Translator shape accepted by the text helpers below (a bound next-intl translator satisfies it). */
export type TabsTextFn = (key: string, values?: Record<string, string | number>) => string;

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
  /** Tab keys with unsaved changes, in tab order; labels come from the catalog at the render site. */
  tabs: GfDirtyKey[];
}

export function aggregateDirty(flags: GfDirtyFlags): DirtyAggregate {
  const tabs = GF_TAB_KEYS.filter((k): k is GfDirtyKey => k !== "simulation" && flags[k] === true);
  return { count: tabs.length, tabs };
}

export function dirtyIndicatorText(agg: DirtyAggregate, tf: TabsTextFn): string | null {
  return agg.count === 0 ? null : tf("unsavedCount", { count: agg.count });
}

// ── 출처 요약 (investment tab strip) ─────────────────────────────────────

export interface SourceSummaryInput {
  reflectedCapabilityCount: number;
  staffingKrwM: number;
  manualCount: number;
  needsConfirmCount: number;
}
export interface SourceSummaryChip {
  key: "capability" | "staffing" | "manual" | "confirm";
  /** Catalog key under stages.s5.tabs; rendered with `values` by the translator. */
  textKey: string;
  values: Record<string, string | number>;
  tab: GfTabKey;
  icon: string;
}

const fmtKrwM = (n: number, locale: Locale | string = "ko") =>
  formatNumber(Math.round(n * 100) / 100, locale, { maximumFractionDigits: 2 });

export function buildSourceSummary(i: SourceSummaryInput): SourceSummaryChip[] {
  return [
    {
      key: "capability",
      icon: "⛓",
      textKey: "srcCapability",
      values: { count: i.reflectedCapabilityCount },
      tab: "capability",
    },
    {
      key: "staffing",
      icon: "👥",
      textKey: "srcStaffing",
      values: { amount: fmtKrwM(i.staffingKrwM) },
      tab: "staffing",
    },
    { key: "manual", icon: "✎", textKey: "srcManual", values: { count: i.manualCount }, tab: "investment" },
    { key: "confirm", icon: "!", textKey: "srcConfirm", values: { count: i.needsConfirmCount }, tab: "investment" },
  ];
}

// ── Completion checklist (review tab) and per-tab markers ────────────────

export type CompletionStatus = "dirty" | "issues" | "filled" | "empty";
export interface CompletionItem {
  key: "entry" | "capability" | "staffing" | "investment";
  tab: GfTabKey;
  status: CompletionStatus;
  issues: number;
  /** Catalog key under stages.s5.tabs; rendered with `values` by the translator. */
  statusTextKey: string;
  statusTextValues: Record<string, string | number>;
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

export function statusParts(
  status: CompletionStatus,
  issues: number,
): { key: string; values: Record<string, string | number> } {
  return status === "dirty"
    ? { key: "statusDirty", values: {} }
    : status === "issues"
      ? { key: "statusIssues", values: { count: issues } }
      : status === "filled"
        ? { key: "statusFilled", values: {} }
        : { key: "statusEmpty", values: {} };
}

export function buildCompletionChecklist(input: CompletionInput): CompletionItem[] {
  const rows: Array<[CompletionItem["key"], GfTabKey, { filled: boolean; dirty: boolean; issues?: number }]> = [
    ["entry", "entry", input.entry],
    ["capability", "capability", input.capability],
    ["staffing", "staffing", input.staffing],
    ["investment", "investment", input.investment],
  ];
  return rows.map(([key, tab, s]) => {
    const issues = s.issues ?? 0;
    const status = statusOf(s.filled, s.dirty, issues);
    const parts = statusParts(status, issues);
    return { key, tab, status, issues, statusTextKey: parts.key, statusTextValues: parts.values };
  });
}

/** "N/4 구성요소" counter: components with content. */
export function filledComponentCount(items: CompletionItem[]): number {
  return items.filter((i) => i.status !== "empty").length;
}

export interface TabMarker {
  kind: "dirty" | "issues" | "done" | "none";
  /** Resolved text ("" when none); the caller renders the icon itself. */
  text: string;
}

/** Tab-level marker (icon is rendered by the caller; text is never colour-only). Issues win over done; dirty wins over both. */
export function tabMarker(item: Pick<CompletionItem, "status" | "issues"> | null, tf: TabsTextFn): TabMarker {
  if (!item) return { kind: "none", text: "" };
  if (item.status === "dirty") return { kind: "dirty", text: tf("statusDirty") };
  if (item.status === "issues") return { kind: "issues", text: tf("markerIssues", { count: item.issues }) };
  if (item.status === "filled") return { kind: "done", text: "✓" };
  return { kind: "none", text: "" };
}

/** True when the simulation result needs a rerun: the server marked it stale (saved data changed)
 *  OR the person has unsaved plan edits the server cannot see (ADR-0176 chip, review fix 2026-11-17). */
export function simRerunNeeded(simStale: boolean, investPlanDirty: boolean): boolean {
  return simStale || investPlanDirty;
}
