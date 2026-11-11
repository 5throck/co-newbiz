"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { Fragment, useState } from "react";
import { SECTION_IDS, STATUS_LABEL } from "./constants.ts";
import { filterTargetsByStatus, TARGET_STATUS_FILTERS, type TargetStatusFilter } from "./longlist-filter.ts";
import { ColGroup } from "../../ui.tsx";

// 후보 전체 목록 — 후보명·DART·재무기술 칩 2개·잠정 순위·상태·제외 사유·작업 7열.
// 작업 열(승격·순위 조정)은 list-table 표준에 따라 마지막 sizing-actions-cell로
// 분리되고 상태 열에는 칩만 남는다 (2026-10 행 인터랙션 리뷰 — IndustryTable 참조 구현).
const LONG_LIST_COL_PCT = [21, 10, 17, 13, 13, 16, 10] as const;
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";
import { useTranslations } from "next-intl";

export function LonglistSection({ ctx }: { ctx: BrownfieldStageState }) {
  const tr = useTranslations();
  const t = useTranslations("stages.s67.longlistSection");
  const tc = useTranslations("common");
  const {
    selected,
    canAct,
    busy,
    targets,
    shortlistedTargets,
    displayedTargets,
    shortlistOrder,
    evalRank,
    shortlist,
    rerank,
  } = ctx;
  // 품평회 2026-10-22 잔여 #1 — 상태 필터 + 초기화. 빈 상태 문구가 "상태 필터를
  // 다른 값으로 바꾸라"고 안내하는 동안 그 필터 자체가 없어 막다른 글이었다.
  const [statusFilter, setStatusFilter] = useState<TargetStatusFilter>("all");
  // 품평회 2026-10-22 잔여 #2 — 제외 사유 전문 펼침 상태(행 1개만 펼친다).
  const [expandedReasonId, setExpandedReasonId] = useState<string | null>(null);
  const visibleTargets = filterTargetsByStatus(displayedTargets, statusFilter);
  const statusLabels = STATUS_LABEL(tr);
  return (
    <>
      {selected && (
        <div id={SECTION_IDS.longlist} style={{ scrollMarginTop: "1rem" }}>
          {/* ── S6/S7: 후보 등록 + 후보 전체 목록 + 스크리닝 ── */}
          <section aria-label={t("targetCandidateScreening")} className="market-section">
            {/* 후보 등록 폼은 위 "후보 발굴" 카드에 항상 표시된다(사용자 요청,
              2026-09-15) — 시장·기업 마스터/웹 검색·LLM 제안과 나란히 묶인다. */}

            {/* S7 선정 퍼널·게이트·위원회·승격은 아래 이어지는 섹션에서 계속된다
              (mockup처럼 탭 없이 한 화면 — 사용자 요청, 2026-09-15). */}

            {/* 후보 전체 목록 테이블 — 목표 시장 정의·후보 발굴 카드와 같은 카드 표면으로
              감싸 화면 위계를 맞춘다(UX 정리, 2026-09-15). */}
            <SectionToolbar
              title={t("fullCandidateListJudgementAnd")}
              summary={
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {t("fullCandidateList")} {targets.length} {t("shortlist")} {shortlistedTargets.length}
                </span>
              }
            />
            <div className="sizing-grade-card">
              {targets.length > 0 && (
                // 품평회 2026-10-22 잔여 #1 — 상태 필터 행. 초기화 버튼은 필터가 걸려
                // 있을 때만 렌더한다(눌러도 변화가 없는 죽은 콘트롤을 두지 않는다).
                <div className="longlist-filter-row">
                  <label
                    htmlFor="longlist-status-filter"
                    className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"
                  >
                    {tc("status")}
                  </label>
                  <select
                    id="longlist-status-filter"
                    className="longlist-status-filter"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as TargetStatusFilter)}
                  >
                    {TARGET_STATUS_FILTERS.map((f) => (
                      <option key={f} value={f}>
                        {f === "all" ? tc("all") : statusLabels[f]}
                      </option>
                    ))}
                  </select>
                  {statusFilter !== "all" && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setStatusFilter("all")}>
                      {t("resetFilter")}
                    </button>
                  )}
                </div>
              )}
              {targets.length === 0 ? (
                <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-0">
                  {t("noCandidatesRegisterCandidatesAbove")}
                </p>
              ) : visibleTargets.length === 0 ? (
                // 품평회 2026-10-22 (ux-researcher): 막다른 글 대신 원인과 다음 행동을 안내한다 —
                // 상태 필터 조절(위 필터 행의 초기화) 또는 후보 등록.
                <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-0">
                  {t("noCandidatesWithThisStatus")}
                </p>
              ) : (
                <section
                  className="table-scroll"
                  aria-label={tc("dataTableHorizontalScroll")}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-scrollable table region (WCAG 2.1.1) — dropping tabIndex would strand keyboard users inside the scroll
                  tabIndex={0}
                >
                  <table className="data-table list-table table-fixed-pct tmin-56" aria-label={t("fullCandidateList2")}>
                    <caption className="sr-only">{t("fullCandidateListCandidatesEvaluation")}</caption>
                    <ColGroup widths={LONG_LIST_COL_PCT} />
                    <thead>
                      <tr>
                        <th scope="col">{t("candidate")}</th>
                        <th scope="col">DART</th>
                        <th scope="col" title={t("financialAndTechnologyEvaluationWeighted")}>
                          {t("financialAndTechnologyEvaluation")}
                        </th>
                        <th scope="col" className="col-num" title={t("theFinancialAndTechnologyEvaluation")}>
                          {t("provisionalRanking")}
                        </th>
                        <th scope="col">{tc("status")}</th>
                        <th scope="col">{t("exclusionReason")}</th>
                        <th scope="col">
                          <span className="sr-only">{tc("actions")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTargets.map((tgt) => {
                        const es = tgt.eval_summary;
                        const orderIdx = shortlistOrder.indexOf(tgt.id);
                        const canPromote = tgt.status === "pending" && tgt.eval_summary?.complete === true;
                        return (
                          <Fragment key={tgt.id}>
                            <tr>
                              <td className="cell-primary cell-truncate">
                                <a
                                  href={`/brownfield/targets/${encodeURIComponent(tgt.id)}`}
                                  className="font-semibold text-[color:var(--fg)] underline-offset-2 hover:underline"
                                  title={t("goesToTheCandidateDetail")}
                                >
                                  {tgt.company_name}
                                </a>
                                {/* 발굴 근거(universe_note — 웹검색 제안 문구 등)는 테이블
                              가독성을 해치므로 표시하지 않는다(사용자 요청, 2026-09-15).
                              제외 사유만 별도 컬럼으로 남는다. */}
                              </td>
                              <td>
                                <code className="dd-item-id">{tgt.dart_corp_code ?? "—"}</code>
                              </td>
                              <td>
                                <span className="flex items-center gap-1">
                                  <span
                                    className={`status-chip ${es?.financial.score == null ? "status-not-started" : es.financial.score >= 70 ? "status-green" : es.financial.score >= 40 ? "status-amber" : "status-red"}`}
                                    title={t("financialEvaluationWeightedScoreOut")}
                                  >
                                    {tc("finance")} {es?.financial.score ?? "—"}
                                  </span>
                                  <span
                                    className={`status-chip ${es?.technical.score == null ? "status-not-started" : es.technical.score >= 70 ? "status-green" : es.technical.score >= 40 ? "status-amber" : "status-red"}`}
                                    title={t("technologyEvaluationWeightedScoreOut")}
                                  >
                                    {t("technology")} {es?.technical.score ?? "—"}
                                  </span>
                                </span>
                              </td>
                              <td className="col-num tabular-nums" title={t("provisionalRankingByTheFinancial")}>
                                {tgt.status === "excluded" ? (
                                  <span className="text-[color:var(--muted-fg)]">—</span>
                                ) : es?.combined != null ? (
                                  tgt.status === "shortlisted" ? (
                                    <span
                                      className="text-[color:var(--muted-fg)]"
                                      title={t("provisionalRankingByEvaluationCriteria")}
                                    >
                                      #{evalRank.get(tgt.id)} ({es.combined}
                                      {t("pt")}
                                    </span>
                                  ) : (
                                    <>
                                      #{evalRank.get(tgt.id)}{" "}
                                      <span className="text-[color:var(--muted-fg)]">
                                        ({es.combined}
                                        {t("pt2")}
                                      </span>
                                    </>
                                  )
                                ) : (
                                  <span className="text-[color:var(--muted-fg)]">{t("evaluationNeeded")}</span>
                                )}
                              </td>
                              <td>
                                <span
                                  className={`status-chip ${tgt.status === "shortlisted" ? "status-green" : tgt.status === "excluded" ? "status-red" : "status-not-started"}`}
                                >
                                  {STATUS_LABEL(tr)[tgt.status]}
                                  {tgt.status === "shortlisted" && tgt.rank ? ` #${tgt.rank}` : ""}
                                </span>
                              </td>
                              <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                {tgt.exclusion_reason ? (
                                  /* 품평회 2026-10-22 잔여 #2 — 잘린 제외 사유 전문을 title(hover)
                                한정이 아니라 포커스·클릭으로 펼쳐 본다(키보드·터치 접근성).
                                버튼이므로 탭으로 도달 가능하고 aria-expanded가 상태를 알린다. */
                                  <button
                                    type="button"
                                    className="cell-reason-toggle"
                                    aria-expanded={expandedReasonId === tgt.id}
                                    onClick={() => setExpandedReasonId(expandedReasonId === tgt.id ? null : tgt.id)}
                                  >
                                    {tgt.exclusion_reason}
                                  </button>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="sizing-actions-cell">
                                <span className="actions-row">
                                  {canAct && canPromote && (
                                    <button
                                      type="button"
                                      className="btn-ghost btn-sm"
                                      disabled={busy}
                                      title={t("financialAndTechnologyEvaluationComplete")}
                                      aria-label={t("promoteP1ToTheShortlist", { p1: tgt.company_name })}
                                      onClick={() => shortlist(tgt.id)}
                                    >
                                      {t("promote")}
                                    </button>
                                  )}
                                  {canAct && tgt.status === "shortlisted" && (
                                    // biome-ignore lint/a11y/useSemanticElements: an inline <span> strip; <fieldset> would change layout/styling (fieldset has block box and default border/padding)
                                    <span
                                      role="group"
                                      aria-label={t("adjustShortlistRanking")}
                                      className="flex items-center gap-0.5"
                                    >
                                      <button
                                        type="button"
                                        className="btn-ghost btn-sm"
                                        disabled={busy || orderIdx <= 0}
                                        aria-label={t("moveP1Up", { p1: tgt.company_name })}
                                        onClick={() => rerank(tgt.id, "up")}
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-ghost btn-sm"
                                        disabled={busy || orderIdx < 0 || orderIdx >= shortlistOrder.length - 1}
                                        aria-label={t("moveP1Down", { p1: tgt.company_name })}
                                        onClick={() => rerank(tgt.id, "down")}
                                      >
                                        ↓
                                      </button>
                                    </span>
                                  )}
                                </span>
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
