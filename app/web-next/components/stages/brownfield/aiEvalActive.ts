// Parallel AI evaluation runs (ADR-0199, 2026-11-16): pure helpers over the `GET /eval-draft-runs/active` list.
// A single-candidate run may start while other single-candidate runs are active (server cap: 3 concurrent engines);
// a bulk run (more than one candidate) blocks every other start. The server enforces both rules; these helpers only
// decide what the UI disables up front and which message a 409 maps to.
import type { RunItemView, RunProgressView } from "./aiEvalTypes.ts";

/** Mirrors the server's concurrent-engine cap for single-candidate runs. */
export const MAX_CONCURRENT_RUNS = 3;

/** States in which a run item is still working (S1-style row progress, 2026-11-16 user report). */
export const PROGRESS_STATES = [
  "pending",
  "financial_sync",
  "financial_draft",
  "technical_draft",
  "versioning",
] as const;

export type RowBlock = "target" | "bulk" | "cap";

/** A run over more than one candidate is a bulk run (the server's `bulk_block` rule uses the same definition). */
export const isBulkRun = (v: RunProgressView): boolean => (v.run?.total_targets ?? 0) > 1;

/** The in-flight item of THIS candidate across all active runs, or null when it is idle. */
export function activeItemFor(runs: readonly RunProgressView[], targetId: string): RunItemView | null {
  for (const v of runs) {
    const item = v.items.find(
      (i) => i.brownfield_target_id === targetId && (PROGRESS_STATES as readonly string[]).includes(i.state),
    );
    if (item) return item;
  }
  return null;
}

/** Why a row's AI 평가 button is disabled by run state alone (null = startable): own run first, then bulk, then cap. */
export function rowBlock(runs: readonly RunProgressView[], targetId: string): RowBlock | null {
  if (activeItemFor(runs, targetId)) return "target";
  if (runs.some(isBulkRun)) return "bulk";
  if (runs.length >= MAX_CONCURRENT_RUNS) return "cap";
  return null;
}

/** Catalog key (under `callErrors`) for a failed call: a 409 engine_active carries a more specific `details.reason`. */
export function callErrorKey(code: string, details: Record<string, unknown> | undefined): string {
  const reason = details?.reason;
  if (code === "engine_active" && (reason === "bulk_block" || reason === "concurrency_cap")) {
    return `engine_active_${reason}`;
  }
  return code;
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
): { runActive: boolean; item: RunItemView } | null {
  const inFlight = activeItemFor(runs, targetId);
  if (inFlight) return { runActive: true, item: inFlight };
  for (const v of runs) {
    const item = v.items.find((i) => i.brownfield_target_id === targetId);
    if (item) return { runActive: true, item };
  }
  const item = latest?.items.find((i) => i.brownfield_target_id === targetId);
  return item ? { runActive: false, item } : null;
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
