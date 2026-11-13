"use client";

// Read-only escalation HISTORY card (design 2026-11-13-calibration-loop-
// convergence §3.2). The deterministic-scaling escalation itself was removed —
// its ×0.85 output pinned the residual gap at exactly 15% (it can never
// satisfy the <15% goal) and it erased the independent bottom-up estimate.
// What remains here is the preserved calibration_escalation record shown as
// decided — the person's decision stays visible where it was made; there is
// no apply affordance and the write path no longer exists (the table and its
// audit rows are untouched, append-only preservation). Mechanically reduced
// from the former offer/form section (design 2026-09-20-calibration-escalation,
// superseded) — the record markup is unchanged apart from the retired-policy
// chip wording.
import type { CalibrationEscalationRow } from "./types.ts";
import { useTranslations } from "next-intl";

export function EscalationSection({ escalation }: { escalation: CalibrationEscalationRow | null }) {
  const t = useTranslations("stages.s1.calibrationPanel");
  const tc = useTranslations("common");
  if (!escalation) return null;
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: label-only card (pre-existing) — adding a role would change what AT announces on the escalation card (behavior change, not this batch)
    <div className="mb-2 sizing-grade-card" aria-label={t("escalationApplicationRecord")}>
      <p className="mb-1 text-[length:var(--fs-caption)]">
        <span className="status-chip status-not-started mr-1">{t("escalationApplied")}</span>
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
