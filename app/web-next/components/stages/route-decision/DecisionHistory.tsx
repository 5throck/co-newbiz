"use client";

// Split from DecisionTab.tsx (400-line cap, stage-decomposition); behavior unchanged.
import { Fragment, useState } from "react";
import { buildDecisionDetail } from "../../../lib/route-decision-history-view.ts";
import { resolveLabelTokens, SUB_TRACK_KEY } from "../../../lib/label-keys.ts";
import { SectionToolbar } from "../../layout.tsx";
import { ColGroup } from "../../ui.tsx";
import { DECISION_COL_PCT } from "./constants.ts";
import type { RouteDecisionStageState } from "./useRouteDecision.ts";
import { useTranslations } from "next-intl";

type HistoryCtx = Pick<
  RouteDecisionStageState,
  | "decisions"
  | "historyYear"
  | "historyMonth"
  | "historyOpen"
  | "setHistoryOpen"
  | "setHistoryYear"
  | "setHistoryMonth"
  | "sessions"
>;

export function DecisionHistory({ ctx, opportunityId }: { ctx: HistoryCtx; opportunityId: string }) {
  const tr = useTranslations();
  const t = useTranslations("stages.s4.decisionTab");
  const tc = useTranslations("common");
  const {
    decisions,
    historyYear,
    historyMonth,
    historyOpen,
    setHistoryOpen,
    setHistoryYear,
    setHistoryMonth,
    sessions,
  } = ctx;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const years = [...new Set(decisions.map((d) => d.decided_at.slice(0, 4)))].sort().reverse();
  const months = historyYear
    ? [
        ...new Set(
          decisions.filter((d) => d.decided_at.slice(0, 4) === historyYear).map((d) => d.decided_at.slice(5, 7)),
        ),
      ].sort()
    : [];
  const filtered = decisions.filter(
    (d) =>
      (!historyYear || d.decided_at.slice(0, 4) === historyYear) &&
      (!historyMonth || d.decided_at.slice(5, 7) === historyMonth),
  );
  // 결정 이력 — 과거 기록 열람용 참고자료라 기본 접힘(2026-09-14 재설계). 오늘 결정에 필요한
  // 평가 근거와 달리, 접혀 있어도 감사성이 훼손되지 않는다.
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
          <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("noDecisionsRecordedYet")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("noDecisionsRecordedInThe")}</p>
        ) : (
          // biome-ignore lint/a11y/useSemanticElements: keyboard-scrollable table wrapper (shared .table-scroll pattern); a labelled region is the intended landmark
          <div
            className="table-scroll"
            role="region"
            aria-label={tc("dataTableHorizontalScroll")}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can scroll the overflowing table horizontally
            tabIndex={0}
          >
            <table className="data-table report-table table-fixed-pct tmin-64" aria-label={t("routeDecisionHistory")}>
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
                          <span className={`status-chip ${d.track === "brownfield" ? "status-amber" : "status-green"}`}>
                            {d.track === "brownfield" ? "Brownfield" : "Greenfield"}
                          </span>
                        </td>
                        <td className="text-[length:var(--fs-caption)]">
                          {d.sub_track ? resolveLabelTokens(SUB_TRACK_KEY[d.sub_track] ?? d.sub_track, tr) : "—"}
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
                        <td className="cell-truncate text-[length:var(--fs-caption)]" title={detail.rationale}>
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
                                <dd className="m-0" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
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
                                    {detail.totalScore !== null ? t("totalP1302", { p1: detail.totalScore }) : ""}
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
                                  <dd className="m-0" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
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
                  <span className={`status-chip ${s2.status === "done" ? "status-green" : "status-in-progress"}`}>
                    {s2.status}
                  </span>{" "}
                  {s2.decisionMode ?? "—"} · {s2.createdAt.slice(0, 10)} ·{" "}
                  <a
                    className="text-[color:var(--accent)] underline"
                    href={`/api/opportunities/${encodeURIComponent(opportunityId)}/committee-sessions/${s2.sessionId}/minutes`}
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
}
