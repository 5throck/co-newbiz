"use client";

// Longlist table card, split from LonglistSection.tsx (the stage-decomposition
// 400-line cap): the status-filter row, the empty states and the candidate
// table, verbatim — the AiEval wiring (useAiEval, the promote note) stays in
// LonglistSection and arrives via props; behavior unchanged.
import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { ColGroup } from "../../ui.tsx";
import { STATUS_LABEL } from "./constants.ts";
import { filterTargetsByStatus, TARGET_STATUS_FILTERS, type TargetStatusFilter } from "./longlist-filter.ts";
import { RunStateChips } from "./AiEvalChips.tsx";
import { RankMarkers, RowMarkers, ScoreChips } from "./AiEvalCoverage.tsx";
import { liveFor, rowBlock } from "./aiEvalActive.ts";
import { rowQueueState } from "./aiEvalQueueState.ts";
import { RowQueueChips } from "./AiEvalQueuePanel.tsx";
import { PromoteButton, reviewItemsHref, unreviewedOf } from "./AiEvalPromote.tsx";
import { AiEvalRowButton } from "./AiEvalRowButton.tsx";
import { AiEvalVersionPanel } from "./AiEvalVersionPanel.tsx";
import { LonglistGapChip } from "./S6CriteriaPanel.tsx";
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";
import type { useAiEval } from "./useAiEval.ts";

// 후보 전체 목록 — 후보명·DART·재무기술 칩 2개·잠정 순위·상태·제외 사유·작업 7열.
// 작업 열(승격·순위 조정)은 list-table 표준에 따라 마지막 sizing-actions-cell로
// 분리되고 상태 열에는 칩만 남는다 (2026-10 행 인터랙션 리뷰 — IndustryTable 참조 구현).
// 2026-11-16: 상태 열을 9→12%로 넓혀 "심사 중" 같은 짧은 라벨이 두 줄로 깨지지 않게 하고, 점수 열(커버리지 문구)을 늘렸다.
const LONG_LIST_COL_PCT = [12, 12, 18, 8, 15, 35] as const;

interface LonglistTableProps {
  selected: NonNullable<BrownfieldStageState["selected"]>;
  targets: BrownfieldStageState["targets"];
  displayedTargets: BrownfieldStageState["displayedTargets"];
  shortlistOrder: BrownfieldStageState["shortlistOrder"];
  evalRank: BrownfieldStageState["evalRank"];
  ai: ReturnType<typeof useAiEval>;
  canAct: BrownfieldStageState["canAct"];
  busy: BrownfieldStageState["busy"];
  /** LonglistSection's promote (ADR-0200 §5.2) — it owns the unreviewed-verdict note above this card. */
  promote: (targetId: string) => Promise<void>;
  rerank: BrownfieldStageState["rerank"];
}

export function LonglistTable({
  selected,
  targets,
  displayedTargets,
  shortlistOrder,
  evalRank,
  ai,
  canAct,
  busy,
  promote,
  rerank,
}: LonglistTableProps) {
  const tr = useTranslations();
  const t = useTranslations("stages.s67.longlistSection");
  const tc = useTranslations("common");
  const ta = useTranslations("stages.s67.aiEval");
  // 품평회 2026-10-22 잔여 #1 — 상태 필터 + 초기화. 빈 상태 문구가 "상태 필터를
  // 다른 값으로 바꾸라"고 안내하는 동안 그 필터 자체가 없어 막다른 글이었다.
  const [statusFilter, setStatusFilter] = useState<TargetStatusFilter>("all");
  // 품평회 2026-10-22 잔여 #2 — 제외 사유 전문 펼침 상태(행 1개만 펼친다).
  const [expandedReasonId, setExpandedReasonId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const activeRunIds = ai.activeRuns.flatMap((v) => (v.run ? [v.run.id] : []));
  const visibleTargets = filterTargetsByStatus(displayedTargets, statusFilter);
  const statusLabels = STATUS_LABEL(tr);
  return (
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
          <table
            className="data-table list-table table-fixed-pct tmin-32 longlist-table"
            aria-label={t("fullCandidateList2")}
          >
            <caption className="sr-only">{t("fullCandidateListCandidatesEvaluation")}</caption>
            <ColGroup widths={LONG_LIST_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("candidate")}</th>
                <th scope="col">{t("dartCorpCode")}</th>
                <th scope="col" title={t("financialAndTechnologyEvaluationWeighted")}>
                  {t("financialAndTechnologyEvaluation")}
                </th>
                <th scope="col" className="col-num" title={t("theFinancialAndTechnologyEvaluation")}>
                  {t("provisionalRanking")}
                </th>
                <th scope="col">{tc("status")}</th>
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
                      <td className="cell-primary">
                        <a
                          href={`/brownfield/targets/${encodeURIComponent(tgt.id)}`}
                          className="font-semibold text-[color:var(--fg)] underline-offset-2 hover:underline"
                          title={t("goesToTheCandidateDetail")}
                        >
                          {tgt.company_name}
                        </a>
                        {/* 제외 사유는 좁은 폭(≈730px)에서 가로 스크롤이 생기지 않도록 별도 컬럼 대신
                      후보명 아래 줄에 둔다(발굴 근거 universe_note는 계속 표시하지 않는다). */}
                        {tgt.exclusion_reason && (
                          <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            <span className="sr-only">{t("exclusionReason")}: </span>
                            <button
                              type="button"
                              className="cell-reason-toggle"
                              aria-expanded={expandedReasonId === tgt.id}
                              onClick={() => setExpandedReasonId(expandedReasonId === tgt.id ? null : tgt.id)}
                            >
                              {tgt.exclusion_reason}
                            </button>
                          </div>
                        )}
                        {/* design 2026-11-21-s67-completion-visibility Fix ①-b — the row that does not
                            count toward coverage is marked here (chip → detail edit form cure path). */}
                        {(tgt.gaps?.length ?? 0) > 0 && (
                          <LonglistGapChip targetId={tgt.id} companyName={tgt.company_name} gaps={tgt.gaps ?? []} />
                        )}
                      </td>
                      <td>
                        <code className="dd-item-id">{tgt.dart_corp_code ?? "—"}</code>
                      </td>
                      <td>
                        <ScoreChips summary={es} />
                        <RowMarkers summary={es} draft={tgt.eval_draft} />
                        <RunStateChips
                          draft={tgt.eval_draft}
                          dartCorpCode={tgt.dart_corp_code}
                          activeRunIds={activeRunIds}
                          live={liveFor(ai.activeRuns, ai.view, tgt.id)}
                        />
                        <RowQueueChips
                          state={rowQueueState(liveFor(ai.activeRuns, ai.view, tgt.id))}
                          companyName={tgt.company_name}
                          busy={ai.busy}
                          onCancelQueued={canAct ? (runId, itemId) => void ai.cancelItem(runId, itemId) : null}
                        />
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
                        {tgt.status !== "excluded" && <RankMarkers summary={es} />}
                      </td>
                      <td>
                        <span
                          className={`status-chip longlist-status-chip ${tgt.status === "shortlisted" ? "status-green" : tgt.status === "excluded" ? "status-red" : "status-not-started"}`}
                        >
                          {tgt.status === "shortlisted" ? t("statusShortlistedShort") : STATUS_LABEL(tr)[tgt.status]}
                          {tgt.status === "shortlisted" && tgt.rank ? ` #${tgt.rank}` : ""}
                        </span>
                      </td>
                      <td className="sizing-actions-cell">
                        <span className="actions-row">
                          {/* One line, fixed order: AI 평가 · 확정 · 버전 비교 */}
                          <span className="ai-row-actions">
                            {canAct && (
                              <AiEvalRowButton
                                companyName={tgt.company_name}
                                targetId={tgt.id}
                                excluded={tgt.status === "excluded"}
                                hasDart={!!tgt.dart_corp_code}
                                block={rowBlock(ai.activeRuns, tgt.id)}
                                busy={ai.busy}
                                onStart={ai.start}
                              />
                            )}
                            {/* 항목 검토: the candidate detail evaluation tab (per-item human review); replaces the
                                removed confirm button. Secondary emphasis while unreviewed verdicts exist. */}
                            <a
                              className={`btn-ghost btn-sm${(es?.unreviewed_total ?? 0) > 0 ? " font-semibold" : ""}`}
                              href={reviewItemsHref(tgt.id)}
                              aria-label={ta("reviewItemsLabel", { company: tgt.company_name })}
                              title={ta("reviewItemsHint")}
                            >
                              {ta("reviewItems")}
                            </a>
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              aria-expanded={compareId === tgt.id}
                              aria-controls={`ai-versions-${tgt.id}`}
                              aria-label={ta("compareToggle", { company: tgt.company_name })}
                              title={ta("compareToggle", { company: tgt.company_name })}
                              onClick={() => setCompareId(compareId === tgt.id ? null : tgt.id)}
                            >
                              <span aria-hidden="true">{compareId === tgt.id ? "▾" : "▸"} </span>
                              {ta("compare")}
                            </button>
                          </span>
                          {canAct && canPromote && (
                            <PromoteButton
                              companyName={tgt.company_name}
                              targetId={tgt.id}
                              unreviewed={unreviewedOf(es)}
                              gaps={tgt.gaps ?? []}
                              busy={busy}
                              onPromote={() => void promote(tgt.id)}
                            />
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
                    {compareId === tgt.id && selected && (
                      <tr>
                        <td colSpan={6} id={`ai-versions-${tgt.id}`}>
                          <AiEvalVersionPanel oppId={selected.opportunity.id} targetId={tgt.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
