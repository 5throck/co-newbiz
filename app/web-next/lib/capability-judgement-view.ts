// Pure view helpers for the S5/S8 required-capability summary table and judgement dialog:
// the one-sentence 판정 요약, the to-do filter (tabs + counts) and prev/next navigation.
import { ATTAINABILITY_GRADE_LABEL, RESOLUTION_LABEL, type GapResolution } from "./capability-gap.ts";

export interface SummaryDraft { resolution: string; expectedLevel: string; months: string; grade: string }

const resLabel = (d: SummaryDraft) => (d.resolution ? RESOLUTION_LABEL[d.resolution as GapResolution] ?? "" : "");
const gradeLabel = (d: SummaryDraft) => (d.grade ? ATTAINABILITY_GRADE_LABEL[d.grade as keyof typeof ATTAINABILITY_GRADE_LABEL] ?? "" : "");
const monthsLabel = (d: SummaryDraft) => (d.months.trim() !== "" ? `${d.months.trim()}개월` : "");

/** Short table sentence: "인수 통합 · 높음" (해소 방식 · 달성 가능성; months only in the detail); "" when empty. */
export function buildJudgementSummary(d: SummaryDraft): string {
  return [resLabel(d), gradeLabel(d)].filter(Boolean).join(" · ");
}

/** Full detail for the tooltip: "인수 통합 → <기대 수준 전체> · 12개월 · 높음". */
export function buildJudgementDetail(d: SummaryDraft): string {
  const lvl = d.expectedLevel.trim().replace(/\s+/g, " ");
  const head = [resLabel(d), lvl ? `→ ${lvl}` : ""].filter(Boolean).join(" ");
  return [head, monthsLabel(d), gradeLabel(d)].filter(Boolean).join(" · ");
}

export type JudgementFilter = "todo" | "all";
export interface FilterRow { id: string; stale: boolean; grade: string | null; confirmed_at: string | null }

export const isTodo = (r: FilterRow, dirty: ReadonlySet<string>) => r.stale || !r.grade || dirty.has(r.id);

export function filterCounts(rows: FilterRow[], dirty: ReadonlySet<string>) {
  return { todo: rows.filter((r) => isTodo(r, dirty)).length, all: rows.length };
}

export const defaultFilter = (todoCount: number): JudgementFilter => (todoCount > 0 ? "todo" : "all");

export function filterRows<T extends FilterRow>(rows: T[], f: JudgementFilter, dirty: ReadonlySet<string>): T[] {
  return f === "todo" ? rows.filter((r) => isTodo(r, dirty)) : rows;
}

/** Id of the neighbour of `id` in `ids` (dir +1 next, -1 previous); null at either end or when absent. */
export function neighborId(ids: string[], id: string, dir: 1 | -1): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + dir] ?? null;
}

/** Green Field: S3 changed. Brown Field S7 (ADR-0171): S3 and/or the target's evaluation state changed. */
export const staleChipText = (r: { stale_reasons?: Array<"s3" | "eval"> }): string => {
  const x = r.stale_reasons ?? [];
  if (x.length > 0 && !x.includes("s3")) return "S7 평가 변경 — 재판정 필요";
  return x.includes("s3") && x.includes("eval") ? "S3·S7 평가 변경 — 재판정 필요" : "S3 변경 — 재판정 필요";
};

