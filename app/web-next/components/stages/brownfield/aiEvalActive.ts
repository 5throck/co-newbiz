// AI evaluation queue (ADR-0199, ADR-0200 part B): pure helpers over the `GET /eval-draft-runs/active` list.
// Starts never wait on other runs: the server enqueues one item per candidate for its worker pool and skips a candidate
// that is already active. The UI therefore disables a row only while THAT candidate is queued or running.
import type { RunItemView, RunProgressView } from "./aiEvalTypes.ts";

/** States in which a worker holds the item (S1-style row progress, 2026-11-16 user report). */
export const RUNNING_STATES = ["financial_sync", "financial_draft", "technical_draft", "versioning"] as const;

/** States in which a run item is still unfinished: waiting for a worker slot, or being worked on. */
export const PROGRESS_STATES = ["pending", ...RUNNING_STATES] as const;

/** Why a row's AI 평가 button is disabled by run state: this candidate waits for a worker, or a worker holds it. */
export type RowBlock = "queued" | "running";

/** The in-flight (queued or running) item of THIS candidate across all active runs, or null when it is idle. */
export function activeItemFor(runs: readonly RunProgressView[], targetId: string): RunItemView | null {
  for (const v of runs) {
    const item = v.items.find(
      (i) => i.brownfield_target_id === targetId && (PROGRESS_STATES as readonly string[]).includes(i.state),
    );
    if (item) return item;
  }
  return null;
}

/** Disabled reason of a row's AI 평가 button from run state alone (null = startable). Only this candidate's own queued or
 * running item blocks it: other runs, bulk or single, never do. */
export function rowBlock(runs: readonly RunProgressView[], targetId: string): RowBlock | null {
  const item = activeItemFor(runs, targetId);
  if (!item) return null;
  return item.state === "pending" ? "queued" : "running";
}

/** Ids present before and gone now: a run that finished (or stopped being engine-active) between two polls. */
export function finishedRunIds(prev: readonly string[], next: readonly string[]): string[] {
  const now = new Set(next);
  return prev.filter((id) => !now.has(id));
}

/** The run item that drives a row's chips: an in-flight item of any active run, else any item of an active run, else
 * the latest finished run's item (kept so "unchanged" / failed feedback stays visible after the run ends). */
export function liveFor(
  runs: readonly RunProgressView[],
  latest: RunProgressView | null,
  targetId: string,
): LiveItem | null {
  for (const v of runs) {
    const item = v.items.find(
      (i) => i.brownfield_target_id === targetId && (PROGRESS_STATES as readonly string[]).includes(i.state),
    );
    if (item) return { runActive: true, runId: v.run?.id ?? null, item };
  }
  for (const v of runs) {
    const item = v.items.find((i) => i.brownfield_target_id === targetId);
    if (item) return { runActive: true, runId: v.run?.id ?? null, item };
  }
  const item = latest?.items.find((i) => i.brownfield_target_id === targetId);
  return item ? { runActive: false, runId: latest?.run?.id ?? null, item } : null;
}

/** The run item driving a candidate row, with the run that holds it (needed to cancel a queued item). */
export interface LiveItem {
  runActive: boolean;
  runId: string | null;
  item: RunItemView;
}

/** One step of a run item, as glyph + catalog key (`rowSeg.<key>`): ✓ finished, ⋯ working, ○ waiting. */
export interface PhaseSegment {
  glyph: "✓" | "⋯" | "○";
  key: "pending" | "syncing" | "finDraft" | "finDone" | "techWait" | "techDraft" | "versioning" | "done";
}

/** Full phrase of a run item's state as segments, e.g. technical_draft → ✓ 재무 초안 완료 · ⋯ 기술 초안 작성 중(LLM 분석). */
export function phaseSegments(state: string): PhaseSegment[] {
  switch (state) {
    case "financial_sync":
      return [{ glyph: "⋯", key: "syncing" }];
    case "financial_draft":
      return [
        { glyph: "⋯", key: "finDraft" },
        { glyph: "○", key: "techWait" },
      ];
    case "technical_draft":
      return [
        { glyph: "✓", key: "finDone" },
        { glyph: "⋯", key: "techDraft" },
      ];
    case "versioning":
      return [{ glyph: "⋯", key: "versioning" }];
    case "done":
      return [{ glyph: "✓", key: "done" }];
    default:
      return [{ glyph: "⋯", key: "pending" }];
  }
}

/** DB timestamps are UTC; tolerate the SQLite `YYYY-MM-DD HH:MM:SS` form without a zone. */
export function parseUtcMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const iso = /(?:Z|[+-]\d\d:?\d\d)$/.test(ts) ? ts : `${ts.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Elapsed time split for the catalog: seconds under a minute, minutes + seconds under an hour, else hours + minutes. */
export function elapsedParts(ms: number): { unit: "s" | "ms" | "hm"; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return { unit: h > 0 ? "hm" : m > 0 ? "ms" : "s", h, m, s };
}

/** Judged-weight coverage of a confirmed category score (`eval_summary.<category>`); null when weights are absent. */
export function weightCoverage(
  c: { scoredWeight?: number; totalWeight?: number } | undefined,
): { scored: number; total: number; partial: boolean } | null {
  if (!c || typeof c.scoredWeight !== "number" || typeof c.totalWeight !== "number" || c.totalWeight <= 0) return null;
  return { scored: c.scoredWeight, total: c.totalWeight, partial: c.scoredWeight < c.totalWeight };
}

export interface SummaryMarkers {
  /** Any item of either category is still pending (judged weight below total weight). */
  partial: boolean;
  /** Non-pending, non-human verdicts nobody reviewed yet (rule + AI), both categories. */
  unreviewed: number;
  byCategory: { financial: number; technical: number };
}

/** Row-level markers from `eval_summary` (ADR-0200 §7.1): shown once per row, never repeated per category. */
export function summaryMarkers(
  s:
    | {
        financial: { scoredWeight?: number; totalWeight?: number; unreviewed?: number };
        technical: { scoredWeight?: number; totalWeight?: number; unreviewed?: number };
        complete?: boolean;
        unreviewed_total?: number;
      }
    | undefined,
): SummaryMarkers {
  if (!s) return { partial: false, unreviewed: 0, byCategory: { financial: 0, technical: 0 } };
  const covs = [weightCoverage(s.financial), weightCoverage(s.technical)];
  // Weights absent (older payload): fall back to the server's `complete` flag.
  const partial = covs.some((c) => c?.partial === true) || (covs.every((c) => c === null) && s.complete === false);
  const byCategory = { financial: s.financial.unreviewed ?? 0, technical: s.technical.unreviewed ?? 0 };
  return { partial, unreviewed: s.unreviewed_total ?? byCategory.financial + byCategory.technical, byCategory };
}

/** AI evaluation refresh recommended: the latest version of either category was last checked over 90 days ago. */
export const draftIsStale = (
  d: { financial?: { stale: boolean }; technical?: { stale: boolean } } | undefined,
): boolean => !!d && (d.financial?.stale === true || d.technical?.stale === true);
