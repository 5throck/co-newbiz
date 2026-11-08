"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { Fragment, useState } from "react";
import { buildDecisionDetail } from "../../../lib/route-decision-history-view.ts";
import { SectionToolbar } from "../../layout.tsx";
import { ColGroup, ParamTable } from "../../ui.tsx";
import { DECISION_COL_PCT, OVERRIDDEN_SUBS } from "./constants.ts";
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
    historyYear,
    historyMonth,
    historyOpen,
    setHistoryOpen,
    setHistoryYear,
    setHistoryMonth,
    sessions,
  } = ctx;
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

          {/* ── 결정 이력 — 과거 기록 열람용 참고자료라 기본 접힘(2026-09-14
              재설계). 오늘 결정에 필요한 평가 근거와 달리, 접혀 있어도
              감사성이 훼손되지 않는다. ── */}
          {(() => {
            const years = [...new Set(decisions.map((d) => d.decided_at.slice(0, 4)))].sort().reverse();
            const months = historyYear
              ? [
                  ...new Set(
                    decisions
                      .filter((d) => d.decided_at.slice(0, 4) === historyYear)
                      .map((d) => d.decided_at.slice(5, 7)),
                  ),
                ].sort()
              : [];
            const filtered = decisions.filter(
              (d) =>
                (!historyYear || d.decided_at.slice(0, 4) === historyYear) &&
                (!historyMonth || d.decided_at.slice(5, 7) === historyMonth),
            );
            return (
              <details
                className="sizing-grade-card mt-3"
                open={historyOpen}
                onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
              >
                <summary className="cursor-pointer text-[length:var(--fs-body)] font-semibold">
                  {tc("decisionHistoryOpen")}
                  {decisions.length}
                  {t("itemSView")}
                </summary>
                <div className="mt-2">
                  {decisions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <label className="text-[length:var(--fs-caption)]">
                        <span className="sr-only">{t("year")}</span>
                        <select
                          value={historyYear}
                          onChange={(e) => {
                            setHistoryYear(e.target.value);
                            setHistoryMonth("");
                          }}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="">{t("allYears")}</option>
                          {years.map((y) => (
                            <option key={y} value={y}>
                              {y}
                              {tc("year")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[length:var(--fs-caption)]">
                        <span className="sr-only">{tc("month")}</span>
                        <select
                          value={historyMonth}
                          onChange={(e) => setHistoryMonth(e.target.value)}
                          disabled={!historyYear}
                          className="sizing-new-input sizing-new-input-sm"
                        >
                          <option value="">{t("allMonths")}</option>
                          {months.map((m) => (
                            <option key={m} value={m}>
                              {Number(m)}
                              {tc("month")}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  {decisions.length === 0 ? (
                    <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
                      {t("noDecisionsRecordedYet")}
                    </p>
                  ) : filtered.length === 0 ? (
                    <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">
                      {t("noDecisionsRecordedInThe")}
                    </p>
                  ) : (
                    // biome-ignore lint/a11y/useSemanticElements: keyboard-scrollable table wrapper (shared .table-scroll pattern); a labelled region is the intended landmark
                    <div
                      className="table-scroll"
                      role="region"
                      aria-label={tc("dataTableHorizontalScroll")}
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can scroll the overflowing table horizontally
                      tabIndex={0}
                    >
                      <table
                        className="data-table report-table table-fixed-pct tmin-64"
                        aria-label={t("routeDecisionHistory")}
                      >
                        <caption className="sr-only">{t("routeDecisionHistory2")}</caption>
                        <ColGroup widths={DECISION_COL_PCT} />
                        <thead>
                          <tr>
                            <th scope="col">{t("track3")}</th>
                            <th scope="col">{tc("route")}</th>
                            <th scope="col">{t("intent")}</th>
                            <th scope="col">{t("scoring")}</th>
                            <th scope="col">{tc("evidence")}</th>
                            <th scope="col">{t("alternatives")}</th>
                            <th scope="col">{t("deciderTimestamp2")}</th>
                            <th scope="col">{t("details")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((d) => {
                            const open = expandedId === d.id;
                            const detail = buildDecisionDetail(d);
                            const panelId = `decision-detail-${d.id}`;
                            return (
                              <Fragment key={d.id}>
                                <tr>
                                  <td>
                                    <span
                                      className={`status-chip ${d.track === "brownfield" ? "status-amber" : "status-green"}`}
                                    >
                                      {d.track === "brownfield" ? "Brownfield" : "Greenfield"}
                                    </span>
                                  </td>
                                  <td className="text-[length:var(--fs-caption)]">
                                    {d.sub_track
                                      ? resolveLabelTokens(SUB_TRACK_KEY[d.sub_track] ?? d.sub_track, tr)
                                      : "—"}
                                  </td>
                                  <td className="text-[length:var(--fs-caption)]">
                                    {d.intent
                                      ? d.intent === "integration"
                                        ? t("consolidated2")
                                        : tc("capabilityApproach")
                                      : "—"}
                                  </td>
                                  <td className="text-[length:var(--fs-caption)]">
                                    {d.total_score !== null ? (
                                      <span
                                        title={(d.scores ?? [])
                                          .map((s) => `${s.criterion}: ${s.score} — ${s.evidence_note}`)
                                          .join("\n")}
                                      >
                                        <strong className="tabular-nums">{d.total_score}</strong>/3.0
                                      </span>
                                    ) : (
                                      "—"
                                    )}
                                    {d.staging_recommended && (
                                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--accent)]">
                                        {t("recommendation")}
                                      </span>
                                    )}
                                  </td>
                                  <td
                                    className="cell-truncate text-[length:var(--fs-caption)]"
                                    title={detail.rationale}
                                  >
                                    {d.rationale}
                                  </td>
                                  <td
                                    className={`cell-truncate text-[length:var(--fs-caption)] ${detail.alternativesRecorded ? "" : "text-[color:var(--muted-fg)]"}`}
                                    title={detail.alternativesRecorded ? detail.alternatives : undefined}
                                  >
                                    {detail.alternatives}
                                  </td>
                                  <td className="text-[length:var(--fs-caption)] tabular-nums">
                                    {d.decided_by} · {d.decided_at.slice(0, 10)}
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="btn-ghost btn-sm"
                                      aria-expanded={open}
                                      aria-controls={panelId}
                                      onClick={() => setExpandedId(open ? null : d.id)}
                                    >
                                      {open ? tc("collapse") : t("more")}
                                    </button>
                                  </td>
                                </tr>
                                {open && (
                                  <tr>
                                    <td colSpan={8} id={panelId}>
                                      <dl className="text-[length:var(--fs-caption)] space-y-2 m-0">
                                        <div>
                                          <dt className="font-semibold">{t("evidenceFullText")}</dt>
                                          <dd
                                            className="m-0"
                                            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                                          >
                                            {detail.rationale}
                                          </dd>
                                        </div>
                                        <div>
                                          <dt className="font-semibold">{t("alternativesReviewedFullText")}</dt>
                                          <dd
                                            className={`m-0 ${detail.alternativesRecorded ? "" : "text-[color:var(--muted-fg)]"}`}
                                            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                                          >
                                            {detail.alternatives}
                                          </dd>
                                        </div>
                                        {detail.scores.length > 0 && (
                                          <div>
                                            <dt className="font-semibold">
                                              {t("scoringEvidence")}
                                              {detail.totalScore !== null
                                                ? t("totalP1302", { p1: detail.totalScore })
                                                : ""}
                                            </dt>
                                            <dd className="m-0">
                                              <ul className="m-0 pl-4 list-disc">
                                                {detail.scores.map((s) => (
                                                  <li
                                                    key={s.criterion}
                                                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                                                  >
                                                    <span className="font-medium">{s.criterion}</span> ·{" "}
                                                    <span className="tabular-nums">{s.score}</span> — {s.evidenceNote}
                                                  </li>
                                                ))}
                                              </ul>
                                            </dd>
                                          </div>
                                        )}
                                        {detail.staging && (
                                          <div>
                                            <dt className="font-semibold">{t("stagingRecommendation")}</dt>
                                            <dd
                                              className="m-0"
                                              style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                                            >
                                              {detail.staging}
                                            </dd>
                                          </div>
                                        )}
                                        <div>
                                          <dt className="font-semibold">{t("deciderTimestamp3")}</dt>
                                          <dd className="m-0 tabular-nums">
                                            {detail.decidedBy} · {detail.decidedAtFull}
                                          </dd>
                                        </div>
                                      </dl>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {sessions.length > 0 && (
                    <>
                      <SectionToolbar title={t("committeeDeliberationHistory")} />
                      <ul className="text-[length:var(--fs-body)] space-y-1">
                        {sessions.map((s2) => (
                          <li key={s2.sessionId}>
                            <span
                              className={`status-chip ${s2.status === "done" ? "status-green" : "status-in-progress"}`}
                            >
                              {s2.status}
                            </span>{" "}
                            {s2.decisionMode ?? "—"} · {s2.createdAt.slice(0, 10)} ·{" "}
                            <a
                              className="text-[color:var(--accent)] underline"
                              href={`/api/opportunities/${encodeURIComponent(selected.id)}/committee-sessions/${s2.sessionId}/minutes`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t("meetingMinutes")}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </details>
            );
          })()}
        </div>
      )}
    </>
  );
}
