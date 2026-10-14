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

/** Tab keys that live inside the business-case page (?tab=). `technical` and `financial`
 * are the two lens tabs (ADR-0169); the former five analysis tabs are financial sub-tabs. */
export const S8_TAB_KEYS = ["technical", "financial", "goals", "scenarios", "targets", "wacc", "financial-analysis", "overview", "params", "target-costing", "decision"] as const;
export type S8TabKey = (typeof S8_TAB_KEYS)[number];

/** Stage-level tab order (INTERIM-WORDING labels live in lib/stage-tabs.ts). */
export const S8_PRIMARY_TAB_ORDER: readonly S8TabKey[] = ["goals", "technical", "financial", "targets", "decision"];

/** Sub-tabs inside the financial part (goals and targets are primary tabs; the more-menu holds only 요약 and the risk heatmap). */
export const S8_FINANCIAL_SUBTABS: readonly S8TabKey[] = ["scenarios", "wacc", "financial-analysis", "overview", "params", "target-costing"];

/** Alias ?tab= values that land on an existing tab key. */
export const S8_TAB_ALIASES: Readonly<Record<string, S8TabKey>> = {
  capability: "technical", // 역량 달성 가능성 lives in the technical lens
  financial: "scenarios", // umbrella lens link lands on its default sub-tab
};

/** The three major parts of the S8 screen: what to achieve, can it be realised, does it pay. */
export type S8Part = "goals" | "technical" | "financial";
export type S8Lens = Exclude<S8Part, "goals">;

/** One-line purpose shown under each part heading (INTERIM-WORDING). */
export const S8_PART_VIEW: Record<S8Part, { title: string; purpose: string }> = {
  goals: { title: "사업 목표", purpose: "무엇을 달성하려는가" },
  technical: { title: "기술적 타당성", purpose: "실현할 수 있는가" },
  financial: { title: "재무적 타당성", purpose: "돈이 되는가" },
};

export function isGreenfieldTrack(track: string | null | undefined): boolean {
  return track === "greenfield";
}

/** Greenfield has no target axis: the target compare/select tab is hidden. */
export function primaryTabKeys(greenfield: boolean): S8TabKey[] {
  return S8_PRIMARY_TAB_ORDER.filter((k) => !(greenfield && k === "targets"));
}

/** Which of the three parts a tab key belongs to (null = target comparison and decision). */
export function partOfS8Tab(key: S8TabKey): S8Part | null {
  if (key === "goals" || key === "technical") return key;
  if (S8_FINANCIAL_SUBTABS.includes(key)) return "financial";
  return null;
}

/** The primary tab that is highlighted for a tab key (null = not a primary tab). */
export function primaryKeyOfS8Tab(key: S8TabKey): S8TabKey | null {
  if (key === "goals" || key === "technical" || key === "targets" || key === "decision") return key;
  if (partOfS8Tab(key) === "financial") return "financial";
  return null;
}

/** Resolve the ?tab= value to a tab key. Old keys keep working (goals stays goals; scenarios/wacc/
 * financial-analysis resolve into the financial part with the right sub-tab; overview/params/
 * target-costing/decision are unchanged), aliases map to their lens
 * (`capability` -> technical, `financial` -> scenarios, the financial default sub-tab), a `#item` suffix is ignored, old
 * greenfield deep links to the hidden targets tab land on scenarios, and unknown values
 * fall back to scenarios (the financial lens default). */
export function resolveS8Tab(tabParam: string | null | undefined, opts: { greenfield: boolean }): S8TabKey {
  const raw = (tabParam ?? "").split("#")[0];
  const aliased = S8_TAB_ALIASES[raw];
  if (aliased) return aliased;
  const known = (S8_TAB_KEYS as readonly string[]).includes(raw) ? (raw as S8TabKey) : "scenarios";
  if (known === "financial") return "scenarios";
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
    : "적용되는 그룹/계열사 기준은 없습니다."; // INTERIM-WORDING
  if (state.kind === "none") {
    return {
      message: "사업 목표가 설정되지 않았습니다. 시나리오는 목표 없이 비교됩니다.", // INTERIM-WORDING
      standardsNote,
      actionLabel: "목표 설정", // INTERIM-WORDING
    };
  }
  const parts: string[] = [];
  if (state.counts.project > 0) parts.push(`프로젝트 목표 ${state.counts.project}건`);
  if (state.counts.affiliate > 0) parts.push(`계열사 목표 ${state.counts.affiliate}건`);
  if (state.counts.group > 0) parts.push(`그룹 목표 ${state.counts.group}건`);
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
