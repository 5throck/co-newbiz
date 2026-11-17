"use client";

// Run-state chips and run progress panel for the S6 longlist (ADR-0199 §10, ADR-0200).
import { useTranslations } from "next-intl";
import { PROGRESS_STATES, RUNNING_STATES } from "./aiEvalActive.ts";
import { ElapsedTime, PhaseText } from "./AiEvalPhase.tsx";
import { QueueSummaryLine } from "./AiEvalQueuePanel.tsx";
import {
  KNOWN_ITEM_CODES,
  KNOWN_PAUSE_REASONS,
  isRunActive,
  knownCode,
  type EvalDraftView,
  type RunItemView,
  type RunProgressView,
} from "./aiEvalTypes.ts";

/** Run-state chips of the `재무·기술 평가` cell (below the score chips): the live progress phrase, the not-DART and failed
 * states, and the "unchanged" feedback. Scores and review markers live in AiEvalCoverage (ADR-0200: no provisional
 * chip layer — verdicts are applied directly). Returns null when there is nothing to show. */
export function RunStateChips({
  draft,
  dartCorpCode,
  activeRunIds = [],
  live = null,
}: {
  draft: EvalDraftView | undefined;
  dartCorpCode: string | null;
  /** Ids of the currently active runs; a pending item of any other (cancelled/finished) run is not "in progress". */
  activeRunIds?: readonly string[];
  /** The run item driving this row (any active run, else the latest run's) — S1-style row progress / unchanged feedback. */
  live?: { runActive: boolean; item: RunItemView } | null;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const item = draft?.run_item;
  // A queued (`pending`) item is not "in progress": the row shows its own 대기 중 chip (AiEvalQueuePanel).
  const inFlight = (state: string) => (RUNNING_STATES as readonly string[]).includes(state);
  const liveEval = !!live && live.runActive && inFlight(live.item.state);
  const failed = item?.state === "failed" || (!!live && !live.runActive && live.item.state === "failed");
  const inProgress = liveEval || (!!item && activeRunIds.includes(item.run_id) && inFlight(item.state));
  // "변경 없음" 피드백 — outcome이 unchanged인데 무표시였던 침묵 버그(2026-11-16 사용자 리포트)를 막는다.
  const unchanged =
    !!live && !liveEval && (live.item.financial_outcome === "unchanged" || live.item.technical_outcome === "unchanged");
  const notDart = !dartCorpCode || item?.state === "skipped_not_dart" || item?.state === "skipped_no_company";
  if (!notDart && !failed && !inProgress && !unchanged) return null;
  const code = knownCode(item?.error ?? live?.item.error_message, KNOWN_ITEM_CODES, "unknown");
  return (
    <span className="flex flex-wrap gap-1 mt-1">
      {liveEval && (
        <span className="status-chip status-not-started" title={t("rowEvaluatingTitle")}>
          <span aria-hidden="true">⋯ </span>
          {t("rowEvaluating")} — <PhaseText state={live.item.state} />
        </span>
      )}
      {unchanged && (
        <span className="status-chip status-not-started" title={t("unchangedHint")}>
          <span aria-hidden="true">= </span>
          {t("unchangedNoChange")}
        </span>
      )}
      {notDart && (
        <span className="status-chip status-not-started" title={t("notDartHint")}>
          <span aria-hidden="true">⊘ </span>
          {t("notDart")}
        </span>
      )}
      {failed && (
        <span className="status-chip status-red" title={item?.error ?? live?.item.error_message ?? undefined}>
          <span aria-hidden="true">✕ </span>
          {`${t("failedNoVersion")} · ${t(`itemErrors.${code}`)}`}
        </span>
      )}
      {inProgress && !liveEval && (
        <span className="status-chip status-not-started">
          <span aria-hidden="true">… </span>
          {t("inProgress")}
        </span>
      )}
    </span>
  );
}

/** Progress panel under the toolbar: determinate bar, aria-live line, paused / interrupted states with resume.
 * Per running run: candidate name(s), the current step as a full phrase, elapsed time, and a cancel button. All text
 * wraps (no ellipsis, no fixed height): the 730 px pane must show every word. */
export function AiEvalProgress({
  view,
  canAct,
  busy,
  onResume,
  onCancel,
  compact = false,
  live = true,
  nowMs,
}: {
  view: RunProgressView;
  canAct: boolean;
  busy: boolean;
  onResume: (runId: string) => void;
  onCancel: (runId: string) => void;
  /** One row of the multi-run list: no card of its own, the cancel button names the candidate. */
  compact?: boolean;
  /** Announce changes (aria-live); a run inside an already-live list passes false. */
  live?: boolean;
  /** Pins the elapsed-time clock (tests). */
  nowMs?: number;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const run = view.run;
  if (!run || !isRunActive(run.status)) return null;
  const { done, total } = view.progress;
  const current = view.items.find(
    (i) => (PROGRESS_STATES as readonly string[]).includes(i.state) && i.state !== "pending",
  );
  const first =
    current ?? view.items.find((i) => (PROGRESS_STATES as readonly string[]).includes(i.state)) ?? view.items[0];
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const paused = run.status === "paused_budget";
  const interrupted = run.status === "interrupted";
  const reason = knownCode(run.pause_reason, KNOWN_PAUSE_REASONS, "dart_budget_reserve");
  const company = first?.company_name ?? "—";
  const names = view.items.length > 1 ? t("runNames", { first: company, n: view.items.length - 1 }) : company;
  const Wrapper = compact ? "div" : "section";
  return (
    <Wrapper
      className={compact ? "ai-eval-progress" : "ai-eval-progress sizing-grade-card mb-2"}
      aria-label={compact ? undefined : t("progressRegion")}
      aria-live={live ? "polite" : undefined}
    >
      <div className="text-[length:var(--fs-body)]">
        {run.status === "running" && (
          <>
            <strong>{names}</strong>
            {view.items.length <= 1 && (
              <>
                {" — "}
                <PhaseText state={current?.state ?? first?.state ?? "pending"} />
              </>
            )}
          </>
        )}
        {paused && (
          <>
            <span aria-hidden="true">⏸ </span>
            {t(`pauseReason.${reason}`, { done, total })}
          </>
        )}
        {interrupted && (
          <>
            <span aria-hidden="true">⚠ </span>
            <strong>{t("interrupted")}</strong> — {t("interruptedHint", { done, total })}
          </>
        )}
      </div>
      <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        <QueueSummaryLine view={view} />
        {" · "}
        <ElapsedTime startedAt={run.started_at} nowMs={nowMs} />
      </p>
      <progress className="w-full" max={total || 1} value={done} aria-label={t("progressBar", { pct })} />
      {/* 예산 소모는 이미 A2 페이로드에 있다 — 데이터가 있을 때만 노출(API 변경 없음). */}
      {view.budget && view.budget.budget > 0 && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">
          {t("dartCalls", { used: view.budget.calls, est: view.budget.budget })}
        </p>
      )}{" "}
      {canAct && (
        <div className="actions-row mt-1">
          {(paused || interrupted) && (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => onResume(run.id)}>
              {t("resume")}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy}
            aria-label={t("cancelRun", { company: names })}
            onClick={() => onCancel(run.id)}
          >
            {t("cancel")}
          </button>
        </div>
      )}
    </Wrapper>
  );
}

/** Progress area: every engine-active run as one compact row; the latest run joins when it is paused / interrupted
 * (resume) and not already listed. A single run renders exactly like the former one-run panel. */
export function AiEvalRunsPanel({
  activeRuns,
  latest,
  canAct,
  busy,
  onResume,
  onCancel,
}: {
  activeRuns: readonly RunProgressView[];
  latest: RunProgressView | null;
  canAct: boolean;
  busy: boolean;
  onResume: (runId: string) => void;
  onCancel: (runId: string) => void;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const listed = new Set(activeRuns.flatMap((v) => (v.run ? [v.run.id] : [])));
  const extra = latest?.run && isRunActive(latest.run.status) && !listed.has(latest.run.id) ? [latest] : [];
  const runs = [...activeRuns, ...extra].filter((v) => v.run && isRunActive(v.run.status));
  if (runs.length === 0) return null;
  const props = { canAct, busy, onResume, onCancel };
  if (runs.length === 1) return <AiEvalProgress view={runs[0]} {...props} />;
  return (
    <section className="sizing-grade-card mb-2" aria-label={t("progressRegion")} aria-live="polite">
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {runs.map((v) => (
          <li key={v.run?.id}>
            <AiEvalProgress view={v} compact live={false} {...props} />
          </li>
        ))}
      </ul>
    </section>
  );
}
