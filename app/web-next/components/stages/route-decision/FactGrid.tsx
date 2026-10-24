"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { RouteDecisionStageState } from "./useRouteDecision.ts";
import type { OpportunityRow } from "./types.ts";
import { useTranslations } from "next-intl";

export function FactGrid({ ctx, selected }: { ctx: RouteDecisionStageState; selected: OpportunityRow }) {const t = useTranslations("stages.s4.factGrid"); const tc = useTranslations("common");
  const { advisory, setTab, reco, canAct, recoLoading, generateRecommendation, recoError, confirm, applyRecommendation } = ctx;
  return (
    <>{selected && advisory !== null && (() => {
        const trackLabel = advisory.recommendedTrack === "neutral" ? t("neutralInsufficientSignal") : advisory.recommendedTrack === "greenfield" ? "Greenfield" : "Brownfield";
        const supporting = advisory.signals
          .filter((s) => s.leans === advisory.recommendedTrack)
          .sort((a, b) => b.weight - a.weight);
        const neutralCount = advisory.signals.filter((s) => s.leans === "neutral").length;
        const gfPct = Math.round((advisory.greenfieldScore / Math.max(1, advisory.greenfieldScore + advisory.brownfieldScore)) * 100);
        return (
          <div className="card" id="reco-card">
            <h2 className="flex items-center gap-2">
              {t("routeRecommendation")} <span className="status-chip status-not-started">{tc("proposal")}</span>
            </h2>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("principleBoundaryAPersonRecords")} <b>{tc("proposal")}</b>{t("andAfterApplyingToThe")}
            </p>
            <p className="text-[length:var(--fs-body)] mb-0">
              {t("recommendation")} <strong className={advisory.recommendedTrack === "greenfield" ? "text-[color:var(--green-fg)]" : advisory.recommendedTrack === "brownfield" ? "text-[color:var(--amber-fg)]" : undefined}>{trackLabel}</strong>
            </p>
            <div className="route-score-bar" role="img" aria-label={t("greenfieldP1PtBrownfieldP2", { p1: advisory.greenfieldScore, p2: advisory.brownfieldScore })}>
              <div className="route-score-bar-seg gf" style={{ width: `${gfPct}%` }} />
              <div className="route-score-bar-seg bf" style={{ width: `${100 - gfPct}%` }} />
            </div>
            <div className="route-score-legend mb-2">
              <span>Greenfield <strong className="tabular-nums">{advisory.greenfieldScore}</strong></span>
              <span>Brownfield <strong className="tabular-nums">{advisory.brownfieldScore}</strong></span>
            </div>
            {advisory.recommendedTrack !== "neutral" && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                {tc("signal")} {advisory.signals.length}{t("of")} {supporting.length}{t("itemS")} {trackLabel}, {neutralCount}{t("itemSNeutralFullEvidence")}{" "}
                <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setTab("eval")}>{t("evaluationEvidenceTab")}</button>)
              </p>
            )}
            {advisory.reReviewTriggers.length > 0 && (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg)] mb-2">{t("check")} {advisory.reReviewTriggers.join(" / ")}</p>
            )}
            {supporting.length > 0 ? (
              <ul className="sizing-note-list mb-2">
                {supporting.map((s) => <li key={s.key}>{s.label} — {s.note}</li>)}
              </ul>
            ) : (
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("theSignalsDoNotPoint")}</p>
            )}

            {/* AI 서술 초안 — 신호 요약을 문장으로 확장한 LLM 초안. 기존 reco 상태 그대로. */}
            <div className="sizing-grade-card mb-3">
              <h4 className="text-[length:var(--fs-body)] mb-2 flex items-center gap-2">
                {t("aiNarrativeDraft")}
                {reco && (
                  <span className="status-chip status-not-started">
                    {reco.source === "llm" ? t("proposalAiP1", { p1: reco.provider ? ` · ${reco.provider}` : "" }) : t("proposalDeterministicFallback")}
                  </span>
                )}
                {canAct && reco && (
                  <button type="button" className="btn-ghost btn-sm ml-auto" disabled={recoLoading} onClick={() => void generateRecommendation()}>
                    {tc("regenerate")}
                  </button>
                )}
              </h4>
              {recoError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
              {canAct && !reco && !recoLoading && !recoError && (
                <div className="flex flex-wrap items-center gap-2 mb-0">
                  <button type="button" className="btn-ghost" onClick={() => void generateRecommendation()}>
                    {t("generateAiRecommendation")}
                  </button>
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("draftsTheRecommendedTrackAnd")}</span>
                </div>
              )}
              {recoLoading && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">{t("draftingFromArtifactsAndAdviser")}</p>}
              {reco && (
                <>
                  {reco.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{reco.note}</p>}
                  {reco.recommendation.rationale_draft && (
                    <p className="text-[length:var(--fs-caption)] mb-2"><span className="font-semibold">{t("evidenceDraft")}</span> {reco.recommendation.rationale_draft}</p>
                  )}
                  {reco.recommendation.alternatives_draft && (
                    <p className="text-[length:var(--fs-caption)] mb-2"><span className="font-semibold">{t("alternativesReviewDraft")}</span> {reco.recommendation.alternatives_draft}</p>
                  )}
                  {reco.recommendation.cautions.length > 0 && (
                    <>
                      <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] font-semibold mb-1">{t("significant")}</p>
                      <ul className="sizing-note-list mb-0">
                        {reco.recommendation.cautions.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>

            {canAct && reco && (
              <div className="flex flex-wrap items-center gap-2 mb-0">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => confirm(t("applyTheRecommendationToThe"), applyRecommendation, {
                    body: t("overwritesTheEnteredTrackRoute"),
                    confirmLabel: tc("reflect"),
                  })}
                >
                  {t("applyToTheDecisionTab")}
                </button>
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("reflectionOnlyFillsInputValues")}</span>
              </div>
            )}
          </div>
        );
      })()}</>
  );
}
