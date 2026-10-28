"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { MarketAnalysisStageState } from "./useMarketList.ts";
import { useTranslations } from "next-intl";

export function LinkCandidatesModal({ ctx }: { ctx: MarketAnalysisStageState }) {const t = useTranslations("stages.s1.linkCandidatesModal"); const tc = useTranslations("common");
  const { linkModal, setLinkModal, toggleCandidate, rerunProxyAnalysis, runWithSelections, canCurate } = ctx;
  return (
    <>{linkModal.open && (
        <div className="modal-backdrop" onClick={() => { if (!linkModal.running) setLinkModal((prev) => ({ ...prev, open: false })); }}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("selectLinkedIndustriesValueChain")}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className=" mb-1">
              {linkModal.rerunAnalysisId ? t("selectLinkedIndustriesValueChain2") : t("linkedIndustryPreviewValueChain")} — <span className="font-semibold">{linkModal.primaryName}</span>
            </h2>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {linkModal.rerunAnalysisId
                ? t("candidatesRelatedToTheIndustry")
                : t("theFirstAnalysisRunsFor", { p1: linkModal.primaryName })}
            </p>
            {linkModal.loading ? (
              <p className="text-[length:var(--fs-body)]" role="status">{t("derivingLinkedIndustryCandidatesTakes")}</p>
            ) : linkModal.candidates.length === 0 && linkModal.substitutes.length === 0 ? (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("failedToDeriveRelatedIndustry")}
              </p>
            ) : (
              <>
                <ul className="sizing-note-list mb-2" aria-label={t("relatedIndustryCandidates")}>
                  {linkModal.candidates.map((c) => (
                    <li key={c.name_ko}>
                      <label className={`flex items-start gap-2 text-[length:var(--fs-caption)] ${linkModal.rerunAnalysisId && !c.locked ? "cursor-pointer" : ""}`}>
                        {linkModal.rerunAnalysisId ? (
                          <input
                            type="checkbox"
                            checked={linkModal.selected.has(c.name_ko)}
                            disabled={c.locked}
                            onChange={() => toggleCandidate(c.name_ko, c.locked)}
                            className="mt-1"
                          />
                        ) : (
                          <span className="mt-1 inline-block w-3.5" aria-hidden="true" />
                        )}
                        <span>
                          <span className="font-semibold">{c.relation}</span> · {c.name_ko}{" "}
                          <span className={`status-chip ${c.industry_id ? "status-green" : "status-amber"}`}>
                            {c.industry_id ? t("analyzable") : t("unregistered")}
                          </span>
                          {c.locked && <span className="control-chip status-green" title={t("alreadyRegisteredLinkedIndustryReflected")}>{t("registeredPinned")}</span>}
                          {c.source === "proxy" && <span className="status-chip status-not-started" title={t("aiRecommendationHypothesisNotYet")}>{t("proposal")}</span>}
                          {c.source === "link" && <span className="status-chip status-green">{t("linkageEvidence")}</span>}
                          {c.source === "analysis" && <span className="status-chip status-not-started">{t("pastAnalysis")}</span>}
                          {c.note && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{c.note}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {linkModal.substitutes.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[length:var(--fs-caption)] font-semibold">{t("substituteThreatsReviewNeededLinkage")}</p>
                    <ul className="sizing-note-list" aria-label={t("substituteThreatCandidates")}>
                      {linkModal.substitutes.map((sub) => (
                        <li key={sub.name_ko} className="text-[length:var(--fs-caption)]">
                          {sub.name_ko}
                          {sub.note && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{sub.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {linkModal.rerunAnalysisId && (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                    {t("alreadyRegisteredDemandIndustriesAre")}
                    {linkModal.selected.size >= 5 && t("upTo5ItemsCan")}
                  </p>
                )}
                {canCurate && (
                  <button type="button" className="btn-ghost btn-sm" disabled={linkModal.loading || linkModal.running} onClick={() => void rerunProxyAnalysis()}>
                    {t("candidates")}
                  </button>
                )}
              </>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" className="btn-ghost" disabled={linkModal.running} onClick={() => setLinkModal((prev) => ({ ...prev, open: false }))}>
                {tc("cancel")}
              </button>
              {canCurate && (
              <button type="button" className="btn-primary" disabled={linkModal.running} onClick={() => void runWithSelections()}>
                {linkModal.running
                  ? tc("analysisStarting")
                  : linkModal.rerunAnalysisId
                    ? linkModal.selected.size > 0 ? t("startP1LinkedIndustriesStart", { p1: linkModal.selected.size }) : t("start")
                    : t("analyzeThisIndustryOnly")}
              </button>
              )}
            </div>
          </div>
        </div>
      )}</>
  );
}
