"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { ParamTable } from "../../ui.tsx";
import { OVERRIDDEN_SUBS } from "./constants.ts";
import { DecisionHistory } from "./DecisionHistory.tsx";
import { resolveLabelTokens, SUB_TRACK_KEY, subTrackLabelKey } from "../../../lib/label-keys.ts";
import type { RouteDecisionStageState } from "./useRouteDecision.ts";
import type { OpportunityRow } from "./types.ts";
import { useTranslations } from "next-intl";

export function DecisionTab({ ctx, selected }: { ctx: RouteDecisionStageState; selected: OpportunityRow }) {
  const tr = useTranslations();
  const t = useTranslations("stages.s4.decisionTab");
  const tc = useTranslations("common");
  const {
    tab,
    decisions,
    saveDecision,
    canAct,
    track,
    setTrack,
    setIntent,
    setSubTrack,
    subTrack,
    subs,
    overrideBlocked,
    intent,
    stagingHint,
    rationale,
    setRationale,
    alternatives,
    setAlternatives,
    draftSaving,
    performSaveDraft,
    saving,
    canSubmit,
    draftSavedAt,
    totalScore,
    allScored,
    setTab,
  } = ctx;
  // D-22: when a decision is already on record, show what was recorded above the (empty) form.
  const recorded = decisions.find((d) => d.is_current === 1) ?? decisions[0] ?? null;
  return (
    <>
      {tab === "decision" && (
        <div className="card">
          <h2>
            {selected.name} {t("trackAndRouteDecision")}{" "}
            <span className={`status-chip ${decisions.length > 0 ? "status-green" : "status-amber"}`}>
              {decisions.length > 0 ? t("decisionRecorded") : t("decisionPending")}
            </span>
          </h2>
          <ParamTable
            caption={t("reviewedDealFacts")}
            labelHeader={t("fact")}
            valueAlign="start"
            rows={[
              {
                label: t("market"),
                value: `${selected.market_scope ?? "—"}${selected.market_size_krw_m ? t("sizeP1KrwMillions", { p1: selected.market_size_krw_m.toLocaleString() }) : ""}${selected.growth_rate !== null ? ` · CAGR ${(selected.growth_rate * 100).toFixed(1)}%` : ""}`,
              },
              { label: t("discoveryEvidence"), value: selected.rationale ?? "—" },
            ]}
          />

          {recorded && (
            <ParamTable
              caption={tc("recordedDecision")}
              labelHeader={tc("recordedDecision")}
              valueAlign="start"
              rows={[
                { label: t("track"), value: recorded.track === "brownfield" ? "Brownfield" : "Greenfield" },
                {
                  label: tc("route"),
                  value: recorded.sub_track
                    ? resolveLabelTokens(SUB_TRACK_KEY[recorded.sub_track] ?? recorded.sub_track, tr)
                    : "—",
                },
                { label: t("decisionEvidence"), value: recorded.rationale || "—" },
                { label: t("alternativesReviewed"), value: recorded.alternatives_considered || "—" },
                { label: t("deciderTimestamp"), value: `${recorded.decided_by} · ${recorded.decided_at.slice(0, 10)}` },
              ]}
            />
          )}
          {recorded && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("theFormBelowIsFor")}
            </p>
          )}

          <form id="route-form" onSubmit={saveDecision}>
            <fieldset disabled={!canAct} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <div className="flex flex-wrap items-end gap-4 mb-3">
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1 font-medium">
                    {t("track2")} <span className="text-[color:var(--red-fg)]">*</span>
                  </span>
                  <select
                    value={track}
                    onChange={(e) => {
                      setTrack(e.target.value as "greenfield" | "brownfield");
                      setIntent("");
                      setSubTrack("");
                    }}
                    className="sizing-new-input"
                  >
                    <option value="greenfield">{t("greenfieldEnterOnOurOwn")}</option>
                    <option value="brownfield">{t("brownfieldCombineWithAnExisting")}</option>
                  </select>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1 font-medium">
                    {tc("route")}{" "}
                    {track === "brownfield" ? (
                      <>
                        <span className="text-[color:var(--red-fg)]">*</span> (Brownfield)
                      </>
                    ) : (
                      t("optional")
                    )}
                  </span>
                  <select value={subTrack} onChange={(e) => setSubTrack(e.target.value)} className="sizing-new-input">
                    <option value="">{tc("selectEllipsis")}</option>
                    {Object.entries(subs)
                      .filter(([k]) => !overrideBlocked || !OVERRIDDEN_SUBS.includes(k))
                      .map(([k]) => (
                        <option key={k} value={k}>
                          {resolveLabelTokens(subTrackLabelKey(k), tr)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1 font-medium">
                    {t("intentStage1")} <span className="text-[color:var(--red-fg)]">*</span>
                  </span>
                  <select
                    value={intent}
                    onChange={(e) => setIntent(e.target.value as "" | "integration" | "capability_access")}
                    className="sizing-new-input"
                  >
                    <option value="">{tc("selectEllipsis")}</option>
                    <option value="integration">{t("consolidated")}</option>
                    <option value="capability_access">{tc("capabilityApproach")}</option>
                  </select>
                </label>
              </div>
              {overrideBlocked && (
                <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">
                  {t("withHighControlNeedPlus")}
                </p>
              )}
              {stagingHint && (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--accent)] mb-2">
                  {t("stagingRecommendationHighMarketUncertainty")}
                </p>
              )}
              <label className="text-[length:var(--fs-caption)] block mb-2">
                <span className="block mb-1">{t("decisionEvidenceCitesTheS1")}</span>
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  rows={3}
                  required
                  className="sizing-new-input"
                  style={{ width: "100%" }}
                  placeholder={t("eGS3FitEvaluation")}
                />
              </label>
              <label className="text-[length:var(--fs-caption)] block mb-3">
                <span className="block mb-1">{t("alternativesReviewedTracksAndRoutes")}</span>
                <textarea
                  value={alternatives}
                  onChange={(e) => setAlternatives(e.target.value)}
                  rows={2}
                  required
                  className="sizing-new-input"
                  style={{ width: "100%" }}
                  placeholder={t("tracksAndRoutesConsideredBut")}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {canAct && (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={draftSaving}
                    onClick={() => void performSaveDraft()}
                  >
                    {draftSaving ? tc("saving") : tc("save")}
                  </button>
                )}
                {canAct && (
                  <button type="submit" className="btn-ghost" disabled={saving || !canSubmit}>
                    {saving ? t("confirming") : tc("decision")}
                  </button>
                )}
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {draftSavedAt && t("draftSavedP1", { p1: draftSavedAt.slice(0, 16).replace("T", " ") })}
                  {totalScore !== null ? t("totalP130", { p1: totalScore }) : ""}
                  {t("sharedScoringForBothTracks")}
                  {canAct && !allScored && (
                    <>
                      {" · "}
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setTab("eval")}>
                        {t("completeTheFiveCriteriaIn")}
                      </button>
                    </>
                  )}
                </span>
              </div>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
                {t("saveKeepsTheDraftOn")}
              </p>
            </fieldset>
          </form>

          <DecisionHistory ctx={ctx} opportunityId={selected.id} />
        </div>
      )}
    </>
  );
}
