"use client";

// Escalation section of the calibration panel (design 2026-09-18-s1-growth-gap-
// calibration): the applied-escalation record, or — when the gap gate fires and
// no escalation is on record — the deterministic-scaling offer and its evidence
// form. Mechanically extracted from CalibrationPanel.tsx (addendum 2026-11-12b)
// to keep both files under the 400-line decomposition cap; markup and locale
// keys unchanged. Decision authority stays with the person (boundary #2).
import type { CalibrationEscalationRow } from "./types.ts";
import { useTranslations } from "next-intl";

export function EscalationSection({
  escalation,
  offer,
  externalCagrPct,
  canCurate,
  busy,
  showForm,
  rationale,
  onRationale,
  onShowForm,
  onCancel,
  onApply,
}: {
  escalation: CalibrationEscalationRow | null;
  offer: boolean;
  externalCagrPct: number | string;
  canCurate: boolean;
  busy: boolean;
  showForm: boolean;
  rationale: string;
  onRationale: (value: string) => void;
  onShowForm: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const t = useTranslations("stages.s1.calibrationPanel");
  const tc = useTranslations("common");
  if (escalation) {
    return (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: label-only card (pre-existing) — adding a role would change what AT announces on the escalation card (behavior change, not this batch)
      <div className="mb-2 sizing-grade-card" aria-label={t("escalationApplicationRecord")}>
        <p className="mb-1 text-[length:var(--fs-caption)]">
          <span className="status-chip status-green mr-1">{t("escalationApplied")}</span>
          <strong>{t("deterministicScaling")}</strong> {t("ourCagr")} {escalation.base_our_cagr_pct.toFixed(1)}% →{" "}
          <strong>{escalation.scaled_cagr_pct.toFixed(1)}%</strong>
          {t("externalReference2")} {escalation.external_cagr_pct.toFixed(1)}
          {t("n085RemainingGap")} {escalation.residual_gap_pct}%)
        </p>
        <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {tc("evidenceColon")} {escalation.rationale} — {escalation.decided_by} · {escalation.created_at.slice(0, 10)}
        </p>
      </div>
    );
  }
  if (!offer) return null;
  return (
    <div className="mb-2">
      {!showForm ? (
        <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          {t("whenTheConvergenceLineIs")} <strong>{t("deterministicScaling2")}</strong>
          {t("canBeClosedAdoptingThe")}{" "}
          {canCurate && (
            <button type="button" className="btn-ghost btn-sm" onClick={onShowForm}>
              {t("applyEscalation")}
            </button>
          )}
        </p>
      ) : (
        <div className="sizing-new-form mb-0">
          <p className="text-[length:var(--fs-caption)] mb-1">
            {t("deterministicScalingAppliedExternalReference")} {externalCagrPct}
            {t("n085AdjustedCagrRecord")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={rationale}
              onChange={(e) => onRationale(e.target.value)}
              className="sizing-new-input"
              style={{ width: "100%" }}
              placeholder={t("eGNoConvergenceFor")}
              aria-label={t("escalationEvidence")}
            />
            <button type="button" className="btn-ghost btn-sm" disabled={busy || !rationale.trim()} onClick={onApply}>
              {tc("apply")}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
