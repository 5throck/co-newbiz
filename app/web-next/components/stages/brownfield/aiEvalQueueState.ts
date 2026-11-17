// Pure state mapping for the S6 evaluation queue UI (ADR-0200 part B, design 2026-11-17 §10.9): per-run counts and the
// summary line, the row state of a candidate, the start-response notice, the pre-start estimate and error parameters.
// No React and no catalog access here (the formatters take the translator), so every rule is unit-testable.
import { activeItemFor } from "./aiEvalActive.ts";
import type { RunItemCounts, RunItemView, RunProgressView } from "./aiEvalTypes.ts";

type Translate = (key: string, values?: Record<string, string | number>) => string;

const STEP_STATES = ["financial_sync", "financial_draft", "technical_draft", "versioning"];

/** The run's `counts` block, or the same numbers derived from its items when an older payload has none. */
export function runCounts(view: Pick<RunProgressView, "counts" | "items" | "progress">): RunItemCounts {
  if (view.counts) return view.counts;
  const c: RunItemCounts = {
    done: 0,
    running: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0,
    total: view.items.length,
  };
  for (const { state } of view.items) {
    if (state === "done") c.done++;
    else if (state === "pending") c.queued++;
    else if (STEP_STATES.includes(state)) c.running++;
    else if (state === "failed") c.failed++;
    else if (state === "cancelled") c.cancelled++;
    else c.skipped++;
  }
  if (c.total === 0) c.total = view.progress.total;
  return c;
}

/** Items that ended without a result, as `queueExtra.*` catalog parts; empty when everything is done, running or queued. */
export function extraCountParts(c: RunItemCounts): Array<{ key: "skipped" | "cancelled" | "failed"; n: number }> {
  return (["skipped", "cancelled", "failed"] as const).flatMap((key) => (c[key] > 0 ? [{ key, n: c[key] }] : []));
}

/** `{done}/{total} 완료 · {running}건 진행 중 · {queued}건 대기`, followed by the ended-without-result parts when any. */
export function queueSummaryText(t: Translate, c: RunItemCounts): string {
  const base = t("queueSummary", { done: c.done, total: c.total, running: c.running, queued: c.queued });
  const extra = extraCountParts(c).map((p) => t(`queueExtra.${p.key}`, { n: p.n }));
  return extra.length > 0 ? `${base} · ${extra.join(" · ")}` : base;
}

export type RowQueueKind = "queued" | "skipped_active" | "cancelled";

export interface RowQueueState {
  kind: RowQueueKind;
  runId: string | null;
  itemId: string;
  /** A paused or interrupted run holds the candidate (`skipped_active` with `paused_run:<runId>`): resume or cancel it. */
  pausedRunId: string | null;
}

/** The pending / skipped-elsewhere / cancelled state of a candidate row; null for running, finished and idle rows. */
export function rowQueueState(live: { runId: string | null; item: RunItemView } | null): RowQueueState | null {
  if (!live) return null;
  const { item, runId } = live;
  if (item.state === "pending") return { kind: "queued", runId, itemId: item.id, pausedRunId: null };
  if (item.state === "cancelled") return { kind: "cancelled", runId, itemId: item.id, pausedRunId: null };
  if (item.state === "skipped_active") {
    const m = /^paused_run:(.+)$/.exec(item.error_message ?? "");
    return { kind: "skipped_active", runId, itemId: item.id, pausedRunId: m ? m[1] : null };
  }
  return null;
}

/** Skip reasons the start route reports (A1); anything else folds into `other`. */
export const START_SKIP_REASONS = ["already_active", "paused_run", "taken_over", "not_dart", "no_company"] as const;

export interface StartResponse {
  run_id: string | null;
  status: string | null;
  queued: number;
  skipped: Array<{ target_id: string; reason: string; run_id?: string }>;
  taken_over: Array<{ target_id: string; from_run_id: string }>;
}

export interface StartSummary {
  queued: number;
  takenOver: number;
  skippedTotal: number;
  /** Skipped candidates by reason, in the fixed catalog order, zero counts omitted. */
  skippedByReason: Array<{ reason: (typeof START_SKIP_REASONS)[number] | "other"; n: number }>;
  hasPausedRun: boolean;
  /** 200 with `run_id: null`: nothing was enqueued. */
  nothingEnqueued: boolean;
}

export function summarizeStart(r: StartResponse): StartSummary {
  const by = new Map<string, number>();
  for (const s of r.skipped ?? []) {
    const reason = (START_SKIP_REASONS as readonly string[]).includes(s.reason) ? s.reason : "other";
    by.set(reason, (by.get(reason) ?? 0) + 1);
  }
  const order = [...START_SKIP_REASONS, "other"] as const;
  return {
    queued: r.queued ?? 0,
    takenOver: r.taken_over?.length ?? 0,
    skippedTotal: r.skipped?.length ?? 0,
    skippedByReason: order.flatMap((reason) => (by.has(reason) ? [{ reason, n: by.get(reason) ?? 0 }] : [])),
    hasPausedRun: (by.get("paused_run") ?? 0) > 0,
    nothingEnqueued: r.run_id === null,
  };
}

/** Notice shown after a start: what was queued, what was skipped and why, and the resume / cancel pointer for a held run. */
export function formatStartNotice(t: Translate, s: StartSummary): string {
  const parts: string[] = [s.nothingEnqueued ? t("startNotice.none") : t("startNotice.queued", { n: s.queued })];
  if (s.takenOver > 0) parts.push(t("startNotice.takenOver", { n: s.takenOver }));
  if (s.skippedTotal > 0) {
    const reasons = s.skippedByReason.map((x) => t(`startNotice.reason.${x.reason}`, { n: x.n })).join(" · ");
    parts.push(t("startNotice.skipped", { n: s.skippedTotal, reasons }));
  }
  if (s.hasPausedRun) parts.push(t("startNotice.pausedRun"));
  return parts.join(" ");
}

export interface BulkEstimate {
  queued: number;
  skippedActive: number;
  skippedNotDart: number;
}

/** Pre-start estimate for the bulk dialog from what the client already knows. The server decides: a candidate held by a
 * paused run can only be known from its response, so the estimate never promises more than "at most". */
export function estimateBulkStart(
  candidates: ReadonlyArray<{ id: string; hasDart: boolean }>,
  runs: readonly RunProgressView[],
): BulkEstimate {
  let skippedActive = 0;
  let skippedNotDart = 0;
  for (const c of candidates) {
    if (!c.hasDart) skippedNotDart++;
    else if (activeItemFor(runs, c.id)) skippedActive++;
  }
  return { queued: candidates.length - skippedActive - skippedNotDart, skippedActive, skippedNotDart };
}

/** Numeric / string error details as message parameters (`queue_full` carries `queued` and `limit`). */
export function errorParams(details: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(details ?? {})) {
    if (typeof v === "number" || typeof v === "string") out[k] = v;
  }
  return out;
}
