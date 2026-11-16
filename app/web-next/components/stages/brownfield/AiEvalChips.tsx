"use client";

// Provisional (AI draft) chips and run progress panel for the S6 longlist (ADR-0199 §10).
// Provisional state is text + icon + dashed outline (never color alone) and is never mixed into the confirmed score.
import { useFormatter, useTranslations } from "next-intl";
import { draftCoverage, PROGRESS_STATES } from "./aiEvalActive.ts";
import { ElapsedTime, PhaseText } from "./AiEvalPhase.tsx";
import {
  KNOWN_ITEM_CODES,
  KNOWN_PAUSE_REASONS,
  isRunActive,
  knownCode,
  type DraftCategory,
  type EvalDraftView,
  type RunItemView,
  type RunProgressView,
  type VersionChip,
} from "./aiEvalTypes.ts";

/** Chip for one category: `AI 잠정 v3 · 11-16 · 재무 72` plus optional state chips (stale / kept / in progress). */
function CategoryChip({
  category,
  chip,
  kept,
  inProgress,
}: {
  category: DraftCategory;
  chip: VersionChip;
  kept: boolean;
  inProgress: boolean;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const f = useFormatter();
  const date = f.dateTime(new Date(chip.created_at), { month: "2-digit", day: "2-digit" });
  const checked = f.dateTime(new Date(chip.checked_at), { month: "2-digit", day: "2-digit" });
  const unchanged = chip.checked_at !== chip.created_at;
  const tip = [
    t("draftIconLabel"),
    t("draftTipDate", { date }),
    t("evidenceGrade", { grade: chip.evidence_grade }),
    unchanged ? t("checkedUnchanged", { date: checked }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const categoryLabel = t(`category.${category}`);
  const unverified = chip.unverified_count;
  // No score (nothing could be proposed): show the counts so it never reads as "not evaluated".
  const coverage = draftCoverage(chip);
  const label =
    chip.provisional_score !== null || unverified === undefined
      ? coverage
        ? t("chipScoreCoverage", {
            category: categoryLabel,
            score: chip.provisional_score ?? "—",
            judged: coverage.judged,
            total: coverage.total,
            n: chip.version_no,
          })
        : t("chipScore", { category: categoryLabel, score: chip.provisional_score ?? "—", n: chip.version_no })
      : t("chipUnverified", {
          category: categoryLabel,
          unverified,
          total: (chip.proposed_count ?? 0) + unverified,
          n: chip.version_no,
        });
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="ai-draft-chip" title={tip} data-category={category}>
        <span aria-hidden="true">✎</span>
        <span className="sr-only">{t("draftIconLabel")}</span>
        {label}
      </span>
      {chip.stale && (
        <span className="status-chip status-amber" title={t("staleHint")}>
          <span aria-hidden="true">⟳ </span>
          {t("stale")}
        </span>
      )}
      {kept && (
        <span className="status-chip status-not-started" title={t("versionKeptHint")}>
          <span aria-hidden="true">⏸ </span>
          {t("versionKept", { n: chip.version_no })}
        </span>
      )}
      {inProgress && (
        <span className="status-chip status-not-started">
          <span aria-hidden="true">… </span>
          {t("inProgress")}
        </span>
      )}
    </span>
  );
}

/** Row 2 of the `재무·기술 평가` cell. Returns null when there is nothing provisional to show. */
export function ProvisionalChips({
  draft,
  dartCorpCode,
  activeRunIds = [],
  live = null,
}: {
  draft: EvalDraftView | undefined;
  dartCorpCode: string | null;
  /** Ids of the currently active runs; a pending item of any other (cancelled/finished) run is not "in progress". */
  activeRunIds?: readonly string[];
  /** Latest run's item for this candidate (from the run view) — drives the S1-style row progress / unchanged feedback. */
  live?: { runActive: boolean; item: RunItemView } | null;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const item = draft?.run_item;
  const liveEval = !!live && live.runActive && (PROGRESS_STATES as readonly string[]).includes(live.item.state);
  const failed = item?.state === "failed" || (!!live && !live.runActive && live.item.state === "failed");
  const inProgress =
    liveEval ||
    (!!item && activeRunIds.includes(item.run_id) && (PROGRESS_STATES as readonly string[]).includes(item.state));
  // "변경 없음" 피드백 — outcome이 unchanged인데 무표시였던 침묵 버그(2026-11-16 사용자 리포트)를 막는다.
  const finUnchanged = !!live && !liveEval && live.item.financial_outcome === "unchanged";
  const techUnchanged = !!live && !liveEval && live.item.technical_outcome === "unchanged";
  const notDart = !dartCorpCode || item?.state === "skipped_not_dart" || item?.state === "skipped_no_company";
  if (!draft?.financial && !draft?.technical && !notDart && !failed && !inProgress && !finUnchanged && !techUnchanged)
    return null;
  const code = knownCode(item?.error ?? live?.item.error_message, KNOWN_ITEM_CODES, "unknown");
  const keptShort = draft?.financial || draft?.technical ? t("keptShort") : null;
  return (
    <span className="flex flex-wrap gap-1 mt-1">
      {liveEval && (
        <span className="status-chip status-not-started" title={t("rowEvaluatingTitle")}>
          <span aria-hidden="true">⋯ </span>
          {t("rowEvaluating")} — <PhaseText state={live.item.state} />
          {keptShort && <span className="sr-only">{keptShort}</span>}
        </span>
      )}
      {draft?.financial && (
        <CategoryChip category="financial" chip={draft.financial} kept={failed} inProgress={inProgress && !liveEval} />
      )}
      {draft?.technical && (
        <CategoryChip category="technical" chip={draft.technical} kept={failed} inProgress={inProgress && !liveEval} />
      )}
      {finUnchanged && draft?.financial && (
        <span className="status-chip status-not-started" title={t("unchangedHint")}>
          <span aria-hidden="true">= </span>
          {t("unchangedKept", { n: draft.financial.version_no })}
        </span>
      )}
      {techUnchanged && draft?.technical && (
        <span className="status-chip status-not-started" title={t("unchangedHint")}>
          <span aria-hidden="true">= </span>
          {t("unchangedKept", { n: draft.technical.version_no })}
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
          {draft?.financial || draft?.technical
            ? t(`itemErrors.${code}`)
            : `${t("failedNoVersion")} · ${t(`itemErrors.${code}`)}`}
        </span>
      )}
      {!draft?.financial && !draft?.technical && inProgress && (
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
  nowMs,
}: {
  view: RunProgressView;
  canAct: boolean;
  busy: boolean;
  onResume: (runId: string) => void;
  onCancel: (runId: string) => void;
  /** One row of the multi-run list: no card of its own, the cancel button names the candidate. */
  compact?: boolean;
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
    >
      <div aria-live="polite" className="text-[length:var(--fs-body)]">
        {run.status === "running" && (
          <>
            <strong>{names}</strong> — <PhaseText state={current?.state ?? first?.state ?? "pending"} />
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
        {t("runCount", { done, total })}
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
    <section className="sizing-grade-card mb-2" aria-label={t("progressRegion")}>
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {runs.map((v) => (
          <li key={v.run?.id}>
            <AiEvalProgress view={v} compact {...props} />
          </li>
        ))}
      </ul>
    </section>
  );
}
