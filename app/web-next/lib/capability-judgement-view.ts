// Pure view helpers for the S5/S8 required-capability summary table and judgement dialog:
// the one-sentence 판정 요약, the to-do filter (tabs + counts) and prev/next navigation.
import { ATTAINABILITY_GRADE_LABEL, RESOLUTION_LABEL, type GapResolution } from "./capability-gap.ts";

export interface SummaryDraft { resolution: string; expectedLevel: string; months: string; grade: string }

const resLabel = (d: SummaryDraft) => (d.resolution ? RESOLUTION_LABEL[d.resolution as GapResolution] ?? "" : "");
const gradeLabel = (d: SummaryDraft) => (d.grade ? ATTAINABILITY_GRADE_LABEL[d.grade as keyof typeof ATTAINABILITY_GRADE_LABEL] ?? "" : "");
const monthsLabel = (d: SummaryDraft) => (d.months.trim() !== "" ? `${d.months.trim()}개월` : "");

/** Short table sentence: "인수 통합 · 높음 · 12개월" (해소 방식 · 달성 가능성 · optional months); "" when empty. */
export function buildJudgementSummary(d: SummaryDraft): string {
  return [resLabel(d), gradeLabel(d), monthsLabel(d)].filter(Boolean).join(" · ");
}

/** Full detail for the tooltip: "인수 통합 → <기대 수준 전체> · 12개월 · 높음". */
export function buildJudgementDetail(d: SummaryDraft): string {
  const lvl = d.expectedLevel.trim().replace(/\s+/g, " ");
  const head = [resLabel(d), lvl ? `→ ${lvl}` : ""].filter(Boolean).join(" ");
  return [head, monthsLabel(d), gradeLabel(d)].filter(Boolean).join(" · ");
}

export type JudgementFilter = "todo" | "confirmed" | "all";
export interface FilterRow { id: string; stale: boolean; grade: string | null; confirmed_at: string | null }

export const isTodo = (r: FilterRow, dirty: ReadonlySet<string>) => r.stale || !r.grade || dirty.has(r.id);
export const isConfirmed = (r: FilterRow) => !!r.confirmed_at && !r.stale;

export function filterCounts(rows: FilterRow[], dirty: ReadonlySet<string>) {
  return { todo: rows.filter((r) => isTodo(r, dirty)).length, confirmed: rows.filter(isConfirmed).length, all: rows.length };
}

export const defaultFilter = (todoCount: number): JudgementFilter => (todoCount > 0 ? "todo" : "all");

export function filterRows<T extends FilterRow>(rows: T[], f: JudgementFilter, dirty: ReadonlySet<string>): T[] {
  return f === "todo" ? rows.filter((r) => isTodo(r, dirty)) : f === "confirmed" ? rows.filter(isConfirmed) : rows;
}

/** Id of the neighbour of `id` in `ids` (dir +1 next, -1 previous); null at either end or when absent. */
export function neighborId(ids: string[], id: string, dir: 1 | -1): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + dir] ?? null;
}
