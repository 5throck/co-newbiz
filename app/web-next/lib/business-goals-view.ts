// Pure, client-safe view helpers for the S8 business-goals UI (ADR-0159).
// No DB / server imports — the components and unit tests share these.
import type { TargetDirection, TargetUnit } from "./business-targets-format.ts";

export type GoalSource = "project" | "affiliate" | "group";
export type AttainmentStatus = "met" | "missed" | "indeterminate" | "manual";

export interface GoalCountBySource {
  project: number;
  affiliate: number;
  group: number;
}

export interface CaseAttainmentEntry {
  metric_key: string;
  label: string;
  direction: TargetDirection;
  target_value: number;
  unit: TargetUnit;
  source: GoalSource;
  status: AttainmentStatus;
  actual: number | null;
  actual_basis: string;
}

// ── S8 tab model ─────────────────────────────────────────────────────────

/** Tab keys that live inside the business-case page (?tab=). */
export const S8_TAB_KEYS = ["goals", "scenarios", "targets", "wacc", "financial-analysis", "overview", "params", "target-costing", "decision"] as const;
export type S8TabKey = (typeof S8_TAB_KEYS)[number];

/** Stage-level tab order (INTERIM-WORDING labels live in lib/stage-tabs.ts). */
export const S8_PRIMARY_TAB_ORDER: readonly S8TabKey[] = ["goals", "scenarios", "targets", "wacc", "financial-analysis"];

export function isGreenfieldTrack(track: string | null | undefined): boolean {
  return track === "greenfield";
}

/** Greenfield has no target axis: the target compare/select tab is hidden. */
export function primaryTabKeys(greenfield: boolean): S8TabKey[] {
  return S8_PRIMARY_TAB_ORDER.filter((k) => !(greenfield && k === "targets"));
}

/** Resolve the ?tab= value to a tab key. Old greenfield deep links to the
 * hidden targets tab land on scenarios; unknown values fall back to scenarios. */
export function resolveS8Tab(tabParam: string | null | undefined, opts: { greenfield: boolean }): S8TabKey {
  const known = (S8_TAB_KEYS as readonly string[]).includes(tabParam ?? "") ? (tabParam as S8TabKey) : "scenarios";
  if (known === "targets" && opts.greenfield) return "scenarios";
  return known;
}

/** True when the URL's tab must be rewritten (greenfield + ?tab=targets). */
export function shouldRedirectTargetsTab(tabParam: string | null | undefined, greenfield: boolean): boolean {
  return greenfield && tabParam === "targets";
}

// ── State banner ─────────────────────────────────────────────────────────

export type BannerState =
  | { kind: "none"; standardsApply: boolean }
  | { kind: "applied"; total: number; counts: GoalCountBySource; standardsApply: boolean };

export function goalsBannerState(counts: GoalCountBySource | null | undefined, standardsResolvable: boolean): BannerState {
  const c = counts ?? { project: 0, affiliate: 0, group: 0 };
  const total = c.project + c.affiliate + c.group;
  return total === 0 ? { kind: "none", standardsApply: standardsResolvable } : { kind: "applied", total, counts: c, standardsApply: standardsResolvable };
}

// INTERIM-WORDING: all Korean strings below are provisional pending glossary review.
export function bannerText(state: BannerState): { message: string; standardsNote: string; actionLabel: string } {
  const standardsNote = state.standardsApply
    ? "그룹/계열사 기준이 함께 적용됩니다." // INTERIM-WORDING
    : "적용되는 그룹/계열사 기준 범위가 없습니다."; // INTERIM-WORDING
  if (state.kind === "none") {
    return {
      message: "사업 목표가 설정되지 않았습니다. 시나리오는 목표 없이 비교됩니다.", // INTERIM-WORDING
      standardsNote,
      actionLabel: "목표 설정", // INTERIM-WORDING
    };
  }
  const parts: string[] = [];
  if (state.counts.project > 0) parts.push(`프로젝트 ${state.counts.project}`);
  if (state.counts.affiliate > 0) parts.push(`계열사 ${state.counts.affiliate}`);
  if (state.counts.group > 0) parts.push(`그룹 ${state.counts.group}`);
  return {
    message: `목표 ${state.total}건 적용 중 — ${parts.join(" · ")}`, // INTERIM-WORDING
    standardsNote,
    actionLabel: "목표 검토", // INTERIM-WORDING
  };
}

// ── Source + attainment presentation (icon + text, never colour alone) ───

export const SOURCE_VIEW: Record<GoalSource, { icon: string; label: string; cls: string }> = {
  project: { icon: "◆", label: "프로젝트", cls: "status-green" }, // INTERIM-WORDING
  affiliate: { icon: "▲", label: "계열사", cls: "status-in-progress" }, // INTERIM-WORDING
  group: { icon: "●", label: "그룹", cls: "status-not-started" }, // INTERIM-WORDING
};

export const ATTAINMENT_VIEW: Record<AttainmentStatus | "not_set", { icon: string; label: string; cls: string }> = {
  met: { icon: "✓", label: "충족", cls: "status-green" }, // INTERIM-WORDING
  missed: { icon: "✕", label: "미달", cls: "status-red" }, // INTERIM-WORDING
  indeterminate: { icon: "?", label: "판정불가", cls: "status-amber" }, // INTERIM-WORDING
  manual: { icon: "✎", label: "수동 확인", cls: "status-not-started" }, // INTERIM-WORDING
  not_set: { icon: "–", label: "목표 미설정", cls: "status-not-started" }, // INTERIM-WORDING
};

export function attainmentView(status: AttainmentStatus | null | undefined): { icon: string; label: string; cls: string } {
  return ATTAINMENT_VIEW[status ?? "not_set"] ?? ATTAINMENT_VIEW.not_set;
}

/** Count statuses for a case's attainment entries (empty = no goals). */
export function summarizeAttainment(entries: CaseAttainmentEntry[] | null | undefined): Record<AttainmentStatus, number> {
  const out: Record<AttainmentStatus, number> = { met: 0, missed: 0, indeterminate: 0, manual: 0 };
  for (const e of entries ?? []) out[e.status] += 1;
  return out;
}

// ── Starter suggestions (METRIC_PRESETS keys only) ───────────────────────

/** Greenfield starter chips: NPV p50, IRR p50, final-year revenue, final-year
 * operating margin, plan period — all existing presets, nothing new. */
export const STARTER_METRIC_KEYS = ["npv", "irr", "revenue", "operating_margin", "period"] as const;

// ── Adoption ack ─────────────────────────────────────────────────────────

export const GOALS_ACK_REQUIRED_CODE = "goals_ack_required";
/** 400: the acknowledgement was sent without the mandatory non-empty note. */
export const GOALS_ACK_NOTE_REQUIRED_CODE = "goals_ack_note_required";
/** 503: the schema migration for goals has not been applied to the running server yet. */
export const MIGRATION_PENDING_CODE = "migration_pending";

/** Readable Korean text for a failed goals / target-check load; migration_pending gets a specific instruction. */
export function goalsLoadErrorText(err: unknown, fallback: string): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === MIGRATION_PENDING_CODE) return "서버를 재시작해 마이그레이션을 적용해야 합니다."; // INTERIM-WORDING
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Text for a failed adoption acknowledgement (the note is mandatory). */
export function goalsAckErrorText(err: unknown): string | null {
  const code = (err as { code?: string } | null)?.code;
  if (code === GOALS_ACK_NOTE_REQUIRED_CODE) return "목표 없이 채택하는 사유를 입력해야 합니다."; // INTERIM-WORDING
  return null;
}
