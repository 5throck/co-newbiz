"use client";

// ADR-0186 D8 display contract: values that depend on the discount rate (NPV / IRR / BEP / valuation) carry a
// "provisional discount rate" label until a person has confirmed the WACC subject, WACC and hurdle IRR.
// Icon + text (never colour alone). A confirmed state renders nothing: no visual noise on the normal path.
import Link from "next/link";
import { useTranslations } from "next-intl";

export interface WaccStatusLike {
  status: "confirmed" | "provisional";
  reason?: "wacc_unconfirmed" | "wacc_subject_not_target" | null;
  missing?: readonly string[];
  warnings?: readonly string[];
  subject?: string | null;
  scope?: "project" | "target";
}

export function WaccStatusBadge({ status, projectId, className = "" }: { status?: WaccStatusLike | null; projectId?: string | null; className?: string }) {
  const t = useTranslations("components.waccStatus");
  if (!status) return null;
  const provisional = status.status === "provisional";
  const warnings = status.warnings ?? [];
  if (!provisional && warnings.length === 0) return null;
  const missing = (status.missing ?? []).map((m) => t(`missing.${m}` as never));
  const link = projectId
    ? <Link className="text-[color:var(--accent)] underline" href={`/projects/${encodeURIComponent(projectId)}/wacc`}>{t("confirmLink")}</Link>
    : null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 text-[length:var(--fs-caption)] ${className}`} data-testid="wacc-provisional" role="note">
      {provisional && <span className="status-chip status-amber" title={t("provisionalHint")}><span aria-hidden="true">◐</span> {t("provisionalLabel")}</span>}
      {provisional && status.reason === "wacc_subject_not_target" && <span className="text-[color:var(--muted-fg)]">{t("reason.wacc_subject_not_target")}</span>}
      {provisional && missing.length > 0 && <span className="text-[color:var(--muted-fg)]">{t("missingLabel")}: {missing.join(", ")}</span>}
      {warnings.map((w) => <span key={w} className="status-chip status-amber" data-testid="wacc-warning"><span aria-hidden="true">⚠</span> {t(`warning.${w}` as never)}</span>)}
      {link}
    </span>
  );
}
