// View helpers for the admin "Gate integrity" KPI screen. The API (GET /api/admin/gate-integrity/kpis) owns every number;
// these helpers only shape the request and flatten `value` objects for compact tables.

import type { BreachCode, BreachItem, FamilyStatus, NotReadyReason } from "./gate-integrity-readiness.ts";

export const KPI_GATE_OPTIONS = ["screening", "pre_fs", "target_screening", "fs", "dd", "entity_ic", "group_ic"] as const;

export interface KpiBreach { breached: boolean; reasons: string[]; items?: BreachItem[] }
export interface KpiMigrationPending { section: string; missing: string[]; migrations: string[] }
export interface Kpi {
  id: string;
  name: string;
  li: boolean;
  li_families: string[];
  period: { from: string; to: string } | null;
  value: Record<string, unknown> | null;
  numerator: number | null;
  denominator: number | null;
  rate: number | null;
  breach: KpiBreach;
  status: "ok" | "migration_pending" | "unavailable";
  migration_pending?: KpiMigrationPending;
  note?: string;
}
export interface KpiReport {
  generated_at: string;
  period: { from: string; to: string; prior_from: string; prior_to: string };
  gate: string | null;
  unapplied_migrations: string[];
  families?: FamilyStatus[];
  kpis: Kpi[];
}

/** Monday 00:00 UTC of the week containing `now` (same default as the API), as a yyyy-mm-dd date. */
export function currentWeekStart(now: Date = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

export function todayDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface KpiQuery { from: string; to: string; gate: string; minWrites: string }

/** Query string for the KPI route; `to` is the END of the picked day (the API treats `to` as exclusive). */
export function kpiQueryString(q: KpiQuery): string {
  const p = new URLSearchParams();
  if (q.from) p.set("from", `${q.from}T00:00:00.000Z`);
  if (q.to) p.set("to", new Date(Date.parse(`${q.to}T00:00:00.000Z`) + 86_400_000).toISOString());
  if (q.gate) p.set("gate", q.gate);
  if (q.minWrites.trim() !== "") p.set("min_writes", q.minWrites.trim());
  return p.toString();
}

/** Why the picked period cannot be queried, or null. */
export function kpiQueryProblem(q: KpiQuery): "range" | "minWrites" | null {
  if (q.from && q.to && q.from > q.to) return "range";
  if (q.minWrites.trim() !== "" && !/^\d+$/.test(q.minWrites.trim())) return "minWrites";
  return null;
}

export function formatRate(rate: number | null): string {
  return rate === null ? "-" : `${(rate * 100).toFixed(1)}%`;
}

export type CellValue = string | number | boolean | null;
export interface FlatRow { key: string; value: CellValue }

/** Flatten a nested value object into dotted-key rows (arrays are summarised by length). */
export function flattenValue(v: unknown, prefix = ""): FlatRow[] {
  if (v === null || v === undefined) return prefix ? [{ key: prefix, value: null }] : [];
  if (typeof v !== "object") return [{ key: prefix, value: v as CellValue }];
  if (Array.isArray(v)) return [{ key: prefix, value: v.length }];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flattenValue(x, prefix ? `${prefix}.${k}` : k));
}

export interface MixRow { gate: string; total: number; go: number; hold: number; kill: number; goShare: number | null; priorTotal: number | null; priorGoShare: number | null }

/** G1 `by_gate` + `prior_4_weeks_by_gate` into one row per gate. */
export function mixRows(value: Record<string, unknown> | null): MixRow[] {
  const cur = (value?.by_gate ?? {}) as Record<string, Record<string, number | null>>;
  const prior = (value?.prior_4_weeks_by_gate ?? {}) as Record<string, Record<string, number | null>>;
  return Object.keys(cur).sort().map((gate) => ({
    gate,
    total: Number(cur[gate]?.total ?? 0), go: Number(cur[gate]?.go ?? 0), hold: Number(cur[gate]?.hold ?? 0), kill: Number(cur[gate]?.kill ?? 0),
    goShare: (cur[gate]?.go_share as number | null | undefined) ?? null,
    priorTotal: prior[gate] ? Number(prior[gate].total ?? 0) : null,
    priorGoShare: (prior[gate]?.go_share as number | null | undefined) ?? null,
  }));
}

export interface WeekCountRow { family: string; code: string; week: string; count: number }

/** G6 `by_family_code_week` into flat rows sorted by family, code, week. */
export function weekCountRows(value: Record<string, unknown> | null): WeekCountRow[] {
  const src = (value?.by_family_code_week ?? {}) as Record<string, Record<string, Record<string, number>>>;
  const out: WeekCountRow[] = [];
  for (const family of Object.keys(src).sort()) {
    for (const code of Object.keys(src[family]).sort()) {
      for (const week of Object.keys(src[family][code]).sort()) out.push({ family, code, week, count: Number(src[family][code][week]) });
    }
  }
  return out;
}

export interface StreakRow { family: string; streakDays: number; writes: number; qualifies: boolean }

/** G12 `by_family` into rows. */
export function streakRows(value: Record<string, unknown> | null): StreakRow[] {
  const src = (value?.by_family ?? {}) as Record<string, { streak_days: number; writes_in_streak: number; qualifies_14_days: boolean }>;
  return Object.keys(src).sort().map((family) => ({ family, streakDays: src[family].streak_days, writes: src[family].writes_in_streak, qualifies: !!src[family].qualifies_14_days }));
}

export const KPI_IDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"] as const;

// ---- redesign: grouping, empty detection, action list, label keys -------------------------------------------------

export type KpiGroupId = "quality" | "backlog" | "readiness";
export const KPI_GROUPS: ReadonlyArray<{ id: KpiGroupId; ids: readonly string[] }> = [
  { id: "quality", ids: ["G1", "G2", "G3", "G4", "G5"] },
  { id: "backlog", ids: ["G7", "G8", "G9", "G10"] },
  { id: "readiness", ids: ["G6", "G11", "G12"] },
];

/** Rule families in the order the enforce-flip runbook recommends flipping them. */
export const FAMILY_ORDER = ["rationale", "waiver", "ladder", "validators", "wacc", "snapshot_ack", "kill_binding", "divergence", "maker_checker"] as const;

export function sortFamilies(rows: readonly FamilyStatus[]): FamilyStatus[] {
  const rank = (f: string) => { const i = (FAMILY_ORDER as readonly string[]).indexOf(f); return i < 0 ? 99 : i; };
  return [...rows].sort((a, b) => rank(a.family) - rank(b.family));
}

/** Catalog key (under admin.gateIntegrity.family) of a family; unknown families fall back to the raw key at the call site. */
export function isKnownFamily(f: string): boolean { return (FAMILY_ORDER as readonly string[]).includes(f); }

/** A KPI that computed fine but has nothing to show for the period: no breach, no denominator, every figure zero. */
export function isEmptyKpi(k: Kpi): boolean {
  if (k.status !== "ok" || k.breach.breached || k.id === "G12") return false;
  if ((k.denominator ?? 0) !== 0 || (k.numerator ?? 0) !== 0) return false;
  return flattenValue(k.value).every((r) => r.value === null || r.value === 0 || r.value === false);
}

export interface ActionItem { key: string; kpiId: string; code: BreachCode | "unknown"; params: Record<string, string | number>; href: string; fallback: string }

const ACTION_HREF: Partial<Record<BreachCode, string>> = {
  reviewer_holders_low: "/admin/users",
  wacc_provisional: "/projects",
  na_unconfirmed_old: "/projects",
  countersign_pending_old: "/projects",
  conditions_old: "/projects",
  group_ic_conditions_open: "/projects",
  waivers_old: "/projects",
};
const ACTION_ORDER: BreachCode[] = ["reviewer_holders_low", "wacc_provisional", "na_unconfirmed_old", "countersign_pending_old", "conditions_old", "group_ic_conditions_open", "waivers_old"];

/** The "what to do now" list: one entry per breach finding, with a link to where it is fixed (or to its indicator card). */
export function breachActions(kpis: readonly Kpi[]): ActionItem[] {
  const out: ActionItem[] = [];
  for (const k of kpis) {
    if (k.status !== "ok" || !k.breach.breached) continue;
    const items = k.breach.items ?? [];
    k.breach.reasons.forEach((fallback, i) => {
      const it = items[i];
      const code = it?.code ?? "unknown";
      out.push({ key: `${k.id}:${i}`, kpiId: k.id, code, params: it?.params ?? {}, href: (it && ACTION_HREF[it.code]) || `#kpi-${k.id}`, fallback });
    });
  }
  const rank = (c: string) => { const i = ACTION_ORDER.indexOf(c as BreachCode); return i < 0 ? 99 : i; };
  return out.sort((a, b) => rank(a.code) - rank(b.code));
}

/** Catalog keys for a not-ready reason, with its interpolation params. */
export function notReadyText(r: NotReadyReason): { key: string; params: Record<string, number> } {
  switch (r.code) {
    case "mode_off": return { key: "readiness.reason.modeOff", params: {} };
    case "would_blocks_open": return { key: "readiness.reason.wouldBlocks", params: { count: r.count } };
    case "clean_days_short": return { key: "readiness.reason.cleanDays", params: { days: r.days, need: r.need } };
    case "decisions_few": return { key: "readiness.reason.decisions", params: { count: r.count, need: r.need } };
  }
}

/** Runbook document id in the /library hub for the active UI language. */
export function runbookHref(locale: string): string {
  return `/library?doc=${locale === "ko" ? "rb-gate-integrity-enforce-flip-ko" : "rb-gate-integrity-enforce-flip"}`;
}
