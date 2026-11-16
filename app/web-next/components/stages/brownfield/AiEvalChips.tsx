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
  type RunProgressView,
  type VersionChip,
} from "./aiEvalTypes.ts";

const STEP_KEYS = ["financial_sync", "financial_draft", "technical_draft"] as const;

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
    t("evidenceGrade", { grade: chip.evidence_grade }),
    unchanged ? t("checkedUnchanged", { date: checked }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="ai-draft-chip" title={tip} data-category={category}>
        <span aria-hidden="true">✎</span>
        <span className="sr-only">{t("draftIconLabel")}</span>
        {t("provisionalChip", { n: chip.version_no, date })} · {t(`category.${category}`)}{" "}
        {chip.provisional_score ?? "—"}
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
}: {
  draft: EvalDraftView | undefined;
  dartCorpCode: string | null;
  /** Id of the currently active run; a pending item of any other (cancelled/finished) run is not "in progress". */
  activeRunId?: string | null;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const item = draft?.run_item;
  const failed = item?.state === "failed";
  const inProgress =
    !!item &&
    item.run_id === activeRunId &&
    ["pending", "financial_sync", "financial_draft", "technical_draft"].includes(item.state);
  const notDart = !dartCorpCode || item?.state === "skipped_not_dart" || item?.state === "skipped_no_company";
  if (!draft?.financial && !draft?.technical && !notDart && !failed && !inProgress) return null;
  const code = knownCode(item?.error, KNOWN_ITEM_CODES, "unknown");
  return (
    <span className="flex flex-col gap-1 mt-1">
      {draft?.financial && (
        <CategoryChip category="financial" chip={draft.financial} kept={failed} inProgress={inProgress} />
      )}
      {draft?.technical && (
        <CategoryChip category="technical" chip={draft.technical} kept={failed} inProgress={inProgress} />
      )}
      {notDart && (
        <span className="status-chip status-not-started" title={t("notDartHint")}>
          <span aria-hidden="true">⊘ </span>
          {t("notDart")}
        </span>
      )}
      {failed && (
        <span className="status-chip status-red" title={item?.error ?? undefined}>
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
