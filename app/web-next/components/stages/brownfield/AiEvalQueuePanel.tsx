"use client";

// Queue pieces of the S6 AI evaluation UI (ADR-0200 part B, design 2026-11-17 §10.9): the per-run summary line of the
// progress panel and the per-candidate queue state of a longlist row (waiting, skipped as already running, cancelled,
// with `대기 취소` for a waiting row). Bulk and single runs render identically. Text always wraps, never truncates.
import { useTranslations } from "next-intl";
import { queueSummaryText, runCounts, type RowQueueState } from "./aiEvalQueueState.ts";
import type { RunProgressView } from "./aiEvalTypes.ts";

/** `3/20 완료 · 2건 진행 중 · 15건 대기` (full wording), plus skipped / cancelled / failed counts when there are any. */
export function QueueSummaryLine({ view }: { view: RunProgressView }) {
  const t = useTranslations("stages.s67.aiEval");
  return <span className="tabular-nums">{queueSummaryText(t, runCounts(view))}</span>;
}

/** Row-level queue state chips. Icon + text on every chip (never color alone). `onCancelQueued` is null for a viewer. */
export function RowQueueChips({
  state,
  companyName,
  busy,
  onCancelQueued,
}: {
  state: RowQueueState | null;
  companyName: string;
  busy: boolean;
  onCancelQueued: ((runId: string, itemId: string) => void) | null;
}) {
  const t = useTranslations("stages.s67.aiEval");
  if (!state) return null;
  const { kind, runId, itemId, pausedRunId } = state;
  return (
    <span className="flex flex-wrap items-center gap-1 mt-1">
      {kind === "queued" && (
        <>
          <span className="status-chip status-not-started" title={t("queuedHint")}>
            <span aria-hidden="true">… </span>
            {t("queued")}
          </span>
          {onCancelQueued && runId && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy}
              aria-label={t("cancelQueuedLabel", { company: companyName })}
              onClick={() => onCancelQueued(runId, itemId)}
            >
              {t("cancelQueued")}
            </button>
          )}
        </>
      )}
      {kind === "skipped_active" && (
        <>
          <span className="status-chip status-not-started" title={t("skippedActiveHint")}>
            <span aria-hidden="true">⇄ </span>
            {t("skippedActive")}
          </span>
          {pausedRunId && (
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("pausedRunHint")}</span>
          )}
        </>
      )}
      {kind === "cancelled" && (
        <span className="status-chip status-not-started">
          <span aria-hidden="true">⊘ </span>
          {t("itemCancelled")}
        </span>
      )}
    </span>
  );
}
