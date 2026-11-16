"use client";

// Read-only rule explanations for the S6 evaluation-criteria panel (ADR-0199): how the score is computed, what the
// provisional drafts are, and why technical items usually stay "unverified". No behaviour lives here.
import { useTranslations } from "next-intl";
import { DART_REUSE_DAYS, DART_REUSE_DAYS_FILING_SEASON } from "./aiEvalRules.ts";

export function ScoreExplanation() {
  const t = useTranslations("stages.s67.aiEval.criteriaPanel");
  return (
    <section aria-label={t("scoreTitle")} className="flex flex-col gap-1">
      <h4 className="m-0 text-[length:var(--fs-body)]">{t("scoreTitle")}</h4>
      <ul className="m-0 pl-5 text-[length:var(--fs-caption)]">
        <li>{t("score.formula")}</li>
        <li>{t("score.provisional")}</li>
        <li>{t("score.grades")}</li>
        <li>{t("score.dartReuse", { days: DART_REUSE_DAYS, season: DART_REUSE_DAYS_FILING_SEASON })}</li>
        <li>{t("score.forceRefresh")}</li>
        <li>{t("score.webEvidence")}</li>
      </ul>
    </section>
  );
}

export function TechnicalRules() {
  const t = useTranslations("stages.s67.aiEval.criteriaPanel");
  return (
    <section aria-label={t("technicalRulesTitle")} className="flex flex-col gap-1">
      <h4 className="m-0 text-[length:var(--fs-body)]">{t("technicalRulesTitle")}</h4>
      <ul className="m-0 pl-5 text-[length:var(--fs-caption)]">
        <li>{t("technicalRule1")}</li>
        <li>{t("technicalRule2")}</li>
      </ul>
    </section>
  );
}
