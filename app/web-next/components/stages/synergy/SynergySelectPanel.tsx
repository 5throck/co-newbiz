"use client";

// S3 guided completion panel — design 2026-11-06-ai-review-stage-scope-fit-i18n §Fix 2,
// option A (the confirmed synergy rationale IS the strategic-fit judgement). Synergy-confirm
// never sets `selected` (ADR-0094 boundary #2); this panel is the S3 screen's own explicit
// human selection path: (1) synergy score confirmed, (2) synergy rationale recorded,
// (3) primary action "Select this opportunity" → PUT /api/opportunities/[id]
// {status:"selected"} (the route validates the transition and stamps the audit row).
// Overlap note: the decision tab's GO record (GateDecisionPanel → advanceToRouteDecision)
// reaches the SAME terminal status — two human paths, no automatic one; neither conflicts
// (the route allows re-stamping `selected`; both write the same audit action).
// After success the panel reloads the opportunity status and offers an S4 link — it never
// navigates on its own and never auto-selects.
import { useState, useEffect, useCallback } from "react";
import { api } from "../../../lib/api.ts";
import { PrimaryAction } from "../../ui.tsx";
import { useTranslations } from "next-intl";

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
  /** Called after a successful selection so the carrier screen reloads its state. */
  onSelected: () => void;
}) {
  const t = useTranslations("stages.s3.synergySelectPanel");
  const tc = useTranslations("common");
  const [status, setStatus] = useState<string | null>(null);
  const [statusLoadFailed, setStatusLoadFailed] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await api.get<{ status: string }>(`/api/opportunities/${encodeURIComponent(props.opportunityId)}`);
      setStatus(r.data.status);
      setStatusLoadFailed(false);
    } catch {
      setStatusLoadFailed(true);
    }
  }, [props.opportunityId]);

  useEffect(() => {
    setStatus(null);
    setStatusLoadFailed(false);
    setSelectError(null);
    void refreshStatus();
  }, [refreshStatus]);

  const scoreConfirmed = !!props.synState?.confirmed;
  const rationaleRecorded = !!props.synState?.synergyRationale?.trim();
  const alreadySelected = status === "selected";

  // Enabled only when (1) and (2) are done, the user can write, and the
  // opportunity sits in the "assessed" pre-decision state.
  let disabledReason: string | undefined;
  if (!scoreConfirmed) disabledReason = t("blockerConfirmScoreFirst");
  else if (!rationaleRecorded) disabledReason = t("blockerRationaleFirst");
  else if (!props.canCurate) disabledReason = t("blockerRole");
  else if (statusLoadFailed || status === null) disabledReason = t("statusLoadFailed");
  else if (status === "identified") disabledReason = t("blockerStatusAssessed");
  else if (status !== "assessed") disabledReason = t("blockerStatusNotSelectable");
  const canSelect = !disabledReason && !selecting;

  async function select() {
    if (!canSelect) return;
    setSelecting(true);
    setSelectError(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(props.opportunityId)}`, { status: "selected" });
      await refreshStatus();
      props.onSelected();
    } catch (err) {
      setSelectError(err instanceof Error ? err.message : t("selectFailed"));
    } finally {
      setSelecting(false);
    }
  }

  return (
    <section aria-label={t("panelAria")} className="market-section">
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("panelTitle")}</h3>
      <ol className="mt-1 mb-2 space-y-1 text-[length:var(--fs-body)]">
        <li>
          <span aria-hidden="true">{scoreConfirmed ? "✓" : "○"}</span> {t("stepScore")} —{" "}
          <span className={`status-chip ${scoreConfirmed ? "status-green" : "status-not-started"}`}>
            {scoreConfirmed ? t("doneMark") : t("pendingMark")}
          </span>
        </li>
        <li>
          <span aria-hidden="true">{rationaleRecorded ? "✓" : "○"}</span> {t("stepRationale")} —{" "}
          <span className={`status-chip ${rationaleRecorded ? "status-green" : "status-not-started"}`}>
            {rationaleRecorded ? t("doneMark") : t("pendingMark")}
          </span>
        </li>
      </ol>
      {alreadySelected ? (
        <p className="mb-0 text-[length:var(--fs-body)]">
          <span aria-hidden="true">✓</span> {t("selectedDone")}{" "}
          <a
            href={`/deals/${encodeURIComponent(props.opportunityId)}/s4`}
            className="text-[color:var(--accent)] underline"
          >
            {t("goToS4")}
          </a>
        </p>
      ) : (
        scoreConfirmed && (
          <PrimaryAction
            label={selecting ? tc("saving") : t("selectAction")}
            disabled={!canSelect}
            disabledReason={selecting ? tc("savingPolite") : disabledReason}
            onClick={() => void select()}
          />
        )
      )}
      {selectError && (
        <p role="alert" className="mb-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">
          {selectError}
        </p>
      )}
    </section>
  );
}
