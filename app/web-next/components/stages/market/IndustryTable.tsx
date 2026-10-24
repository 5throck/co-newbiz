"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { MarketAnalysisStageState } from "./useMarketList.ts";
import { KO_DATA, isDownstreamRelation } from "../../../lib/ko-data-values.ts";
import { ColGroup } from "../../ui.tsx";
import type { FlatIndustryRow } from "./grouping.ts";

// 분석 대상 산업 목록 6열 — 산업명·분석 상태가 가장 긴 텍스트 열.
const INDUSTRY_COL_PCT = [26, 8, 10, 22, 12, 22] as const;
import type { AnalysisInfo } from "./types.ts";
import { useTranslations } from "next-intl";

export function IndustryTable({ ctx, rows }: { ctx: MarketAnalysisStageState; rows?: FlatIndustryRow[] }) {const t = useTranslations("stages.s1.industryTable"); const tc = useTranslations("common");
  const { overview, editing, selectedIndustry, setEditing, canCurate, pinBusyId, togglePin, loadDetail, savingEdit, visibleIndustries, flatRows, saveEdit, deleteIndustry, STALE_DAYS, relDate, rerunAnalysis } = ctx;
  const shown = rows ?? flatRows;
  return (
    <>{overview === null ? (
          <p>{tc("loading")}</p>
        ) : overview.industries.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("noIndustriesRegisteredStartWith")}</p>
        ) : visibleIndustries.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("noIndustriesMatchTheSearch")}</p>
        ) : shown.length === 0 ? (
          null
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table list-table market-list-table table-fixed-pct tmin-64" aria-label={t("industryListInAnalysisScope")}>
            <caption className="sr-only">{t("industryListInAnalysisScope2")}</caption>
            <ColGroup widths={INDUSTRY_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("industryName")}</th>
                <th scope="col">{t("ksicCode")}</th>
                <th scope="col">{t("linkedDrivers")}</th>
                {/* 분석 상태는 가장 긴 텍스트 열(재분석 진행률·버전 유지 문구 칩) —
                    10rem에서는 3줄로 뭉개지므로 14rem으로 늘린다(max-width는
                    market-list-table이 72rem으로 상향, 아래 styles.css 참조). */}
                <th scope="col">{tc("analysisStatus")}</th>
                <th scope="col" className="col-date">{tc("analysisDate")}</th>
                <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ ind, relation, childCount, expanded, onToggle }) => {
                const a = ind.analysis;
                const inProgress = a?.status === "in_progress";
                // 보호 모드 재분석 중엔 status가 여전히 'completed'라 inProgress로는
                // 안 잡힌다 — 재분석/수정/삭제를 막으려면 이 플래그도 함께 봐야 한다.
                const busy = inProgress || !!a?.rerun_in_progress;
                // 큐 위치 표기(UX-4) — 같은 앵커의 대기열에서 몇 번째인지 칩 본문에 노출.
                const queueLabel = (() => {
                  if (a?.status !== "pending") return t("linkagePending");
                  const sibs = (overview?.industries ?? [])
                    .map((i2) => i2.analysis)
                    .filter((x): x is AnalysisInfo => Boolean(x) && x!.status === "pending" && x!.after_analysis_id === a.after_analysis_id)
                    .sort((x, y) => x.created_at.localeCompare(y.created_at));
                  const idx = sibs.findIndex((x) => x.id === a.id);
                  return idx >= 0 ? t("linkagePendingP1", { p1: idx + 1 }) : t("linkagePending2");
                })();
                const analysisDate = a ? (a.completed_at ?? a.created_at).slice(0, 10) : null;
                const stale = a?.status === "completed" && analysisDate
                  ? (Date.now() - new Date(analysisDate).getTime()) / 86400000 > STALE_DAYS
                  : false;
                const isEditing = editing?.id === ind.id;
                return (
                  <tr key={ind.id} className={selectedIndustry === ind.id ? "row-selected" : undefined}>
                    <td className="cell-primary">
                      {isEditing ? (
                        <input
                          aria-label={t("editIndustryName")}
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          className="sizing-new-input"
                          autoFocus
                        />
                      ) : (
                        <span className="flex items-center gap-1.5" style={relation ? { paddingLeft: "2rem" } : undefined}>
                          {/* 핀(★)은 본 산업·연계 산업 모두에 렌더링한다 — 연계 산업도
                              개별 고정 대상(2026-09-14 사용자 리포트: 유압식 브레이커).
                              연계 행은 들여쓰기 + ↳ + 관계 칩으로 위계를 표현한다. */}
                          {canCurate ? (
                          <button
                            type="button"
                            disabled={pinBusyId === ind.id}
                            className={ind.pinned ? "text-[color:var(--amber-fg)]" : "text-[color:var(--muted-fg)] hover:text-[color:var(--amber-fg)]"}
                            title={ind.pinned ? t("unpinTheHomeIndustry") : t("pinAsHomeIndustryShown")}
                            aria-label={ind.pinned ? t("unpinP1", { p1: ind.name_ko }) : t("pinP1", { p1: ind.name_ko })}
                            aria-pressed={Boolean(ind.pinned)}
                            onClick={() => void togglePin(ind)}
                          >
                            {ind.pinned ? "★" : "☆"}
                          </button>
                          ) : null}
                          {relation && (
                            <>
                              <span aria-hidden="true" className="text-[color:var(--muted-fg)]">↳</span>
                              <span className={`status-chip ${isDownstreamRelation(relation) ? "status-in-progress" : "status-amber"}`}>{relation}</span>
                            </>
                          )}
                          {onToggle && (
                            <button
                              type="button"
                              className="text-[color:var(--muted-fg)] hover:text-[color:var(--fg)]"
                              title={expanded ? t("collapseLinkedIndustries") : t("expandLinkedIndustries")}
                              aria-expanded={expanded}
                              onClick={onToggle}
                            >
                              {expanded ? "▾" : "▸"}
                            </button>
                          )}
                          <button
                            type="button"
                            className={relation ? "text-left underline-offset-2 hover:underline" : "font-semibold text-left underline-offset-2 hover:underline"}
                            title={t("openAnalysisReport")}
                            onClick={() => loadDetail(ind.id)}
                          >
                            {ind.name_ko}
                          </button>
                          {childCount > 0 && (
                            <button
                              type="button"
                              className="status-chip status-not-started"
                              title={expanded ? t("collapseLinkedIndustries2") : t("expandLinkedIndustries2")}
                              onClick={onToggle ?? undefined}
                            >
                              {t("linkage")} {childCount}{tc("countUnit")}
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          aria-label={t("editKsicCode")}
                          value={editing.code}
                          onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                          placeholder={t("eG28121")}
                          className="sizing-new-input sizing-new-input-sm"
                        />
                      ) : (
                        <code className="dd-item-id">{ind.ksic_code ?? "—"}</code>
                      )}
                    </td>
                    <td className="tabular-nums">{ind.driver_count}{tc("countUnit")}</td>
                    <td>
                      {a?.status === "pending" ? (
                        <span className="status-chip status-not-started" title={t("startsAutomaticallyOnceThePrerequisite")}>{queueLabel}</span>
                      ) : inProgress ? (
                        <span className="status-chip status-amber">{tc("analyzingOpen")}{a?.current_step ?? 0}{t("n8Steps")}</span>
                      ) : a?.status === "completed" && a.rerun_in_progress ? (
                        // ADR-0131 — 재분석 진행 중에도 status는 여전히 이전(완료) 버전을 가리킨다.
                        // 새 버전은 성공해야만 "교체"되므로, 지금 화면에 보이는 건 이전 버전 그대로다.
                        <span className="status-chip status-amber" title={t("thePreviousCompletedVersionStays")}>{t("item")}{a.current_step ?? 0}{t("n8StepsPreviousV")}{a.latest_version ?? 1} {tc("keptSuffix")}</span>
                      ) : a?.status === "completed" && a.error_message ? (
                        // 보호 모드 재분석이 LLM 장애로 실패한 직후 — status/completed_at은 그대로,
                        // error_message만 이번 시도 실패 사유로 남는다(날짜·버전 변경 없음).
                        <span className="status-chip status-red" title={t("p1TheDisplayedVersionIs", { p1: a.error_message })}>{t("failedV")}{a.latest_version ?? 1} {tc("keptSuffix")}</span>
                      ) : stale ? (
                        <span className="status-chip status-amber" title={t("theAnalysisDateIsOver")}>{t("updateRecommendedV")}{a?.latest_version ?? 1})</span>
                      ) : a?.status === "completed" && a.data_quality === "all_synthesis" ? (
                        // ADR-0131 후속 — 최신 완료 버전의 모든 단계가 AI 미설정/실패로
                        // 결정론 합성값으로 채워졌다. 수치를 전혀 신뢰할 수 없으므로
                        // "분석 완료"와 시각적으로 구별되는 경고 상태로 표시한다.
                        <span className="status-chip status-red" title={t("allStepsOfThisVersion")}>{tc("analysisCompleteV")}{a.latest_version ?? 1}{t("synthesizedData")}</span>
                      ) : a?.status === "completed" && a.data_quality === "partial_synthesis" ? (
                        <span className="status-chip status-amber" title={t("someStepsOfThisVersion")}>{tc("analysisCompleteV")}{a.latest_version ?? 1}{t("partiallySynthesized")}</span>
                      ) : a?.status === "completed" ? (
                        <span className="status-chip status-green">{tc("analysisCompleteV")}{a.latest_version ?? 1})</span>
                      ) : a?.status === "failed" && a.error_message && (a.error_message.startsWith(KO_DATA.analysisErrorPrereqFailed) || a.error_message.startsWith(KO_DATA.analysisErrorRoot) || a.error_message.startsWith(KO_DATA.analysisErrorPrereqLong)) ? (
                        <span className="status-chip status-not-started" title={t("p1AfterCompletesPickAgain", { p1: a.error_message })}>{t("cancelStart")}</span>
                      ) : a?.status === "failed" ? (
                        <span className="status-chip status-red" title={a.error_message ?? t("anErrorOccurredWhileRunning")}>{t("analysisFailed")}</span>
                      ) : (
                        <span className="status-chip status-not-started">{t("analysisPending")}</span>
                      )}
                    </td>
                    <td className="col-date">
                      {a ? (
                        <span className="tabular-nums" title={analysisDate ?? ""}>{relDate(analysisDate)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="sizing-actions-cell"><span className="actions-row">
                      {isEditing ? (
                        <>
                          <button type="button" className="btn-ghost btn-sm" disabled={savingEdit || !editing.name.trim()} onClick={saveEdit}>
                            {savingEdit ? tc("saving") : tc("save")}
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
                            {tc("cancel")}
                          </button>
                        </>
                      ) : (
                        <>
                          {a && !busy && canCurate && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm sizing-rerun-btn"
                              title={stale ? t("analysisDateIsOver90") : t("asANewVersionOn")}
                              onClick={() => rerunAnalysis(a.id, ind.name_ko)}
                            >
                              {tc("reanalyze")}
                            </button>
                          )}
                          {!busy && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              title={t("editIndustryNameAndKsic")}
                              onClick={() => setEditing({ id: ind.id, name: ind.name_ko, code: ind.ksic_code ?? "" })}
                            >
                              {tc("edit")}
                            </button>
                          )}
                          {!busy && canCurate && (
                            <button
                              type="button"
                              className="btn-danger btn-sm"
                              title={t("deletesThisIndustryAndIts")}
                              onClick={() => deleteIndustry(ind)}
                            >
                              {tc("delete")}
                            </button>
                          )}
                        </>
                      )}
                    </span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}</>
  );
}
