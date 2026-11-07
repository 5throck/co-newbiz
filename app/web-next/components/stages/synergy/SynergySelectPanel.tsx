"use client";

// S3 completion checklist + selection — rendered INSIDE the 의사결정 tab (design
// 2026-11-07-s3-completion-into-decision-tab §3; supersedes the above-tabs panel of
// 2026-11-06-ai-review-stage-scope-fit-i18n §Fix 2). Synergy-confirm never sets `selected`
// (ADR-0094 boundary #2); this block is the explicit human selection path:
// (1) synergy score confirmed, (2) synergy rationale recorded,
// (3) primary action "Select this opportunity" → PUT /api/opportunities/[id] {status:"selected"}
// (the route validates the transition and stamps the audit row). The GO record
// (GateDecisionPanel → advanceToRouteDecision) reaches the SAME terminal status — two human paths,
// no automatic one. The opportunity status is read ONCE by the parent (useOpportunityStatus) and
// passed in; this block only writes. It never navigates on its own and never auto-selects.
// Single-primary rule: "Select this opportunity" is the only primary here, and only while the score is
// confirmed and the opportunity is not yet selected. The way to S4 is the stage's handoff-cta (StageFrame).
import { useState } from "react";
import { api } from "../../../lib/api.ts";
import { PrimaryAction } from "../../ui.tsx";
import { useTranslations } from "next-intl";
import type { TabKey } from "./synergyFormat.ts";

export const COMPLETION_HEADING_ID = "s3-completion-heading";

export interface SynergySelectState {
  synergyScore: number | null;
  synergyRationale: string | null;
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export function SynergySelectPanel(props: {
  opportunityId: string;
  synState: SynergySelectState | null;
  canCurate: boolean;
  /** Opportunity status, owned by the parent's single GET (null while loading). */
  status: string | null;
  statusLoadFailed: boolean;
  onRetryStatus: () => void;
  /** Re-reads the status, then reloads the carrier screen after a successful selection. */
  onSelected: () => void | Promise<void>;
  onTab: (k: TabKey) => void;
}) {
  const t = useTranslations("stages.s3.synergySelectPanel");
  const tc = useTranslations("common");
  const tr = useTranslations();
  const { status, statusLoadFailed } = props;
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);

  const scoreConfirmed = !!props.synState?.confirmed;
  const rationaleRecorded = !!props.synState?.synergyRationale?.trim();
  const alreadySelected = status === "selected";

  // Enabled only when (1) and (2) are done, the user can write, and the
  // opportunity sits in the "assessed" pre-decision state.
  let disabledReason: string | undefined;
  if (!scoreConfirmed) disabledReason = t("blockerConfirmScoreFirst");
  else if (!rationaleRecorded) disabledReason = t("blockerRationaleFirst");
  else if (!props.canCurate) disabledReason = t("blockerRole");
  else if (statusLoadFailed) disabledReason = t("statusLoadFailed");
  else if (status === null) disabledReason = t("statusLoading");
  else if (status === "identified") disabledReason = t("blockerStatusAssessed");
  else if (status !== "assessed") disabledReason = t("blockerStatusNotSelectable");
  const canSelect = !disabledReason && !selecting;

  async function select() {
    if (!canSelect) return;
    setSelecting(true);
    setSelectError(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(props.opportunityId)}`, { status: "selected" });
      await props.onSelected();
    } catch (err) {
      setSelectError(err instanceof Error ? err.message : t("selectFailed"));
    } finally {
      setSelecting(false);
    }
  }

  const scoreEvalLabel = tr("stages.s3.synergyFormat.synergyScoreEvaluation");
  const rows: Array<{ done: boolean; label: string; jump: boolean }> = [
    { done: scoreConfirmed, label: t("stepScore"), jump: !scoreConfirmed },
    { done: rationaleRecorded, label: t("stepRationale"), jump: !rationaleRecorded },
    { done: alreadySelected, label: t("stepSelect"), jump: false },
  ];

  const allDone = rows.every((r) => r.done);

  // Complete: one inline row of small done chips (the header chip already says "S3 complete"). The heading stays
  // as the focus target of the status line's jump link; the same-result note folds into the row's tooltip.
  if (allDone) {
    return (
      <section aria-label={t("panelAria")} className="market-section completion-compact" title={t("sameResultNote")}>
        <h3 id={COMPLETION_HEADING_ID} tabIndex={-1} className="completion-compact-title">
          {t("panelTitle")}
        </h3>
        <ol className="completion-steps" aria-label={t("panelAria")}>
          {rows.map((r) => (
            <li key={r.label}>
              <span className="status-chip status-green">
                <span aria-hidden="true">✓</span> {r.label}
              </span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section aria-label={t("panelAria")} className="market-section">
      <h3 id={COMPLETION_HEADING_ID} tabIndex={-1} className="sizing-step-title text-[length:var(--fs-body)]">
        {t("panelTitle")}
      </h3>
      <ol className="completion-steps" aria-label={t("panelAria")}>
        {rows.map((r) => (
          <li key={r.label}>
            <span>
              <span aria-hidden="true">{r.done ? "✓" : "○"}</span> {r.label}
            </span>{" "}
            <span className={`status-chip ${r.done ? "status-green" : "status-not-started"}`}>
              {r.done ? t("doneMark") : t("pendingMark")}
            </span>
            {r.jump && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => props.onTab("scoreEval")}>
                {scoreEvalLabel}
              </button>
            )}
          </li>
        ))}
      </ol>
      {scoreConfirmed ? (
        <PrimaryAction
          label={selecting ? tc("saving") : t("selectAction")}
          disabled={!canSelect}
          disabledReason={selecting ? tc("savingPolite") : disabledReason}
          onClick={() => void select()}
        />
      ) : (
        <p className="mb-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{disabledReason}</p>
      )}
      {statusLoadFailed && (
        <button type="button" className="btn-ghost btn-sm mt-1" onClick={props.onRetryStatus}>
          {t("retryStatus")}
        </button>
      )}
      {selectError && (
        <p role="alert" className="mb-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
          {selectError}
        </p>
      )}
      <p className="mb-0 mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("sameResultNote")}</p>
    </section>
  );
}
