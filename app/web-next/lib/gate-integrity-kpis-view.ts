// View helpers for the admin "Gate integrity" KPI screen. The API (GET /api/admin/gate-integrity/kpis) owns every number;
// these helpers only shape the request and flatten `value` objects for compact tables.

export const KPI_GATE_OPTIONS = ["screening", "pre_fs", "target_screening", "fs", "dd", "entity_ic", "group_ic"] as const;

export interface KpiBreach { breached: boolean; reasons: string[] }
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
