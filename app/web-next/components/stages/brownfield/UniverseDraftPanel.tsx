"use client";

// The AI draft block of the evaluation-target-direction modal (design §7.1): the
// proposal preview (reusing the card view), the apply / close / regenerate actions and
// the failure note. Proposal-only — applying fills the editable fields, a person saves.
import { useTranslations } from "next-intl";
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";
import { UniverseDirectionView } from "./UniverseDirectionView.tsx";

export function UniverseDraftPanel({ ctx }: { ctx: BrownfieldStageState }) {
  const t = useTranslations("stages.s67.discoveryPanels");
  const tc = useTranslations("common");
  const { uniReco, uniBusy, uniRecoApplied, setUniReco, setUniRecoApplied, generateUniReco, applyUniReco } = ctx;
  const draft = uniReco?.draft ?? null;
  const regenerate = (label: string) => (
    <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>
      {uniBusy ? tc("regenerating") : label}
    </button>
  );
  return (
    <div className="sizing-grade-card mb-3">
      <h4 className="text-[length:var(--fs-caption)] mb-2">
        {t("generateDefinitionDraft")} <span className="status-chip status-amber">{t("proposalAi")}</span>
      </h4>
      <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {t("proposesADefinitionWordingDraft")} <b>{t("definition")}</b> {t("inputsOnlyTheCandidateEligibility")}
      </p>
      {uniReco === null ? (
        <button type="button" className="btn-ghost btn-sm" disabled={uniBusy} onClick={() => void generateUniReco()}>
          {uniBusy ? t("generatingDraft") : t("generateDefinitionDraft2")}
        </button>
      ) : uniReco.draft ? (
        <div>
          <p className="mb-1 text-[length:var(--fs-caption)]">
            <span className={`status-chip mr-1 ${uniRecoApplied ? "status-green" : "status-amber"}`}>
              {uniRecoApplied ? t("applied") : tc("proposal")}
            </span>
            {uniReco.source === "llm" ? "AI" : t("deterministic")}
          </p>
          <UniverseDirectionView
            direction={uniReco.draft}
            evidence={uniReco.draft.evidence}
            preview={{ counts: uniReco.counts }}
          />
          <p className="mt-2 mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {tc("proposalArtifactColon")} {uniReco.manifest.join(" · ") || t("noEvidence")}
          </p>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-ghost btn-sm" onClick={() => applyUniReco(uniReco)}>
              {uniRecoApplied ? t("applyAgain") : t("applyToTheDefinitionInput")}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setUniReco(null);
                setUniRecoApplied(false);
              }}
            >
              {tc("close")}
            </button>
            {regenerate(t("regenerateAi"))}
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]">
            {uniReco.note ?? t("aDraftCannotBeCreated")}
          </p>
          {regenerate(t("retryAi"))}
        </div>
      )}
    </div>
  );
}
