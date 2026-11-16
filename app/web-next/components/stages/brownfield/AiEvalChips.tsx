"use client";

// Provisional (AI draft) chips and run progress panel for the S6 longlist (ADR-0199 §10).
// Provisional state is text + icon + dashed outline (never color alone) and is never mixed into the confirmed score.
import { useFormatter, useTranslations } from "next-intl";
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

const STEP_KEYS = ["financial_sync", "financial_draft", "technical_draft"] as const;

/** States in which a run item is still working (S1-style row progress, 2026-11-16 user report). */
const PROGRESS_STATES = ["pending", "financial_sync", "financial_draft", "technical_draft", "versioning"] as const;

/** Per-category progress mark for an in-flight run item: done when the category step has produced an outcome. */
export function categoryMarks(
  state: string,
  financialOutcome: string | null,
  technicalOutcome: string | null,
): { financial: "done" | "waiting"; technical: "done" | "waiting" } {
  const financial =
    financialOutcome !== null || ["technical_draft", "versioning", "done"].includes(state) ? "done" : "waiting";
  const technical = technicalOutcome !== null || state === "done" ? "done" : "waiting";
  return { financial, technical };
}

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
  const label =
    chip.provisional_score !== null || unverified === undefined
      ? t("chipScore", { category: categoryLabel, score: chip.provisional_score ?? "—", n: chip.version_no })
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
  activeRunId = null,
  live = null,
}: {
  draft: EvalDraftView | undefined;
  dartCorpCode: string | null;
  /** Id of the currently active run; a pending item of any other (cancelled/finished) run is not "in progress". */
  activeRunId?: string | null;
  /** Latest run's item for this candidate (from the run view) — drives the S1-style row progress / unchanged feedback. */
  live?: { runActive: boolean; item: RunItemView } | null;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const item = draft?.run_item;
  const liveEval = !!live && live.runActive && (PROGRESS_STATES as readonly string[]).includes(live.item.state);
  const failed = item?.state === "failed" || (!!live && !live.runActive && live.item.state === "failed");
  const inProgress =
    liveEval || (!!item && item.run_id === activeRunId && (PROGRESS_STATES as readonly string[]).includes(item.state));
  const marks = live ? categoryMarks(live.item.state, live.item.financial_outcome, live.item.technical_outcome) : null;
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
      {liveEval && marks && (
        <span className="status-chip status-not-started" title={t("rowEvaluatingTitle")}>
          <span aria-hidden="true">⋯ </span>
          {t("rowEvaluating")} · {t("category.financial")}{" "}
          <span aria-hidden="true">{marks.financial === "done" ? "✓" : "…"}</span>
          <span className="sr-only">{marks.financial === "done" ? t("markDone") : t("markWaiting")}</span> ·{" "}
          {t("category.technical")} <span aria-hidden="true">{marks.technical === "done" ? "✓" : "…"}</span>
          <span className="sr-only">{marks.technical === "done" ? t("markDone") : t("markWaiting")}</span>
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

/** Progress panel under the toolbar: determinate bar, aria-live line, paused / interrupted states with resume. */
export function AiEvalProgress({
  view,
  canAct,
  busy,
  onResume,
  onCancel,
}: {
  view: RunProgressView;
  canAct: boolean;
  busy: boolean;
  onResume: (runId: string) => void;
  onCancel: (runId: string) => void;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const run = view.run;
  if (!run || !isRunActive(run.status)) return null;
  const { done, total } = view.progress;
  const current = view.items.find((i) => STEP_KEYS.includes(i.state as (typeof STEP_KEYS)[number]));
  const step = current ? t(`step.${current.state}`) : t("step.waiting");
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const paused = run.status === "paused_budget";
  const interrupted = run.status === "interrupted";
  const reason = knownCode(run.pause_reason, KNOWN_PAUSE_REASONS, "dart_budget_reserve");
  return (
    <section className="ai-eval-progress sizing-grade-card mb-2" aria-label={t("progressRegion")}>
      <div aria-live="polite" className="text-[length:var(--fs-body)]">
        {run.status === "running" && t("progress", { done, total, company: current?.company_name ?? "—", step })}
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
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => onCancel(run.id)}>
            {t("cancel")}
          </button>
        </div>
      )}
    </section>
  );
}
