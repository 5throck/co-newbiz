"use client";

// Split from components/stages/BrownfieldStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import {
  normalizeVerdict,
  precheckRecommendation,
  KNOCKOUT_IDS,
  SCREENING_VERDICT_KEYS,
  SCREENING_VERDICT_KO,
} from "../../../lib/brownfield-precheck.ts";
import { CommitteePanel } from "../../CommitteePanel.tsx";
import { GateDecisionPanel } from "../../GateDecisionPanel.tsx";
import { PromotionPanel } from "../../PromotionPanel.tsx";
import { ColGroup } from "../../ui.tsx";
import { SECTION_IDS, shortlistColPct } from "./constants.ts";
import { buildEvalBriefMd } from "./evalBrief.ts";
import { DealShapePanel } from "../DealShapePanel.tsx";
import type { BrownfieldStageState } from "./useBrownfieldTargets.ts";
import { useTranslations } from "next-intl";

export function ShortlistSection({
  ctx,
  dealShapePanel = false,
}: {
  ctx: BrownfieldStageState;
  dealShapePanel?: boolean;
}) {
  const tr = useTranslations();
  const t = useTranslations("stages.s67.shortlistSection");
  const tc = useTranslations("common");
  const {
    selected,
    precheckOpen,
    setPrecheckOpen,
    recoBusy,
    recoProgress,
    precheckDraft,
    precheckDraftNote,
    canAct,
    setPrecheckDraft,
    precheckBusy,
    shortlistedTargets,
    precheckIncomplete,
    checklistItems,
    part1Count,
    part2Count,
    savePrecheck,
    runCommitteePrecheck,
  } = ctx;
  return (
    <>
      {selected && (
        <div
          id={SECTION_IDS.shortlist}
          className="mt-3 flex flex-col gap-3 items-stretch"
          style={{ scrollMarginTop: "1rem" }}
        >
          {/* ── 사전 검토 — 대상 사전 검토 체크리스트 9개 항목 전 항목. 최종 후보 목록에
              오른 후보를 대상으로 "문제 없는지" 최종 점검하는 체크리스트다
              (사용자 결정, 2026-09-16). 판정 기록도 이 섹션에서 인라인으로 한다 —
              상세 화면·후보 전체 목록의 사전 검토 표면은 제거(사용자 결정, 2026-09-16).
              공식 판정이 아니며 승격/추진을 막지 않는다. 위원회가 이 판정을 근거로
              최종 후보 목록을 최종 검토해 사람에게 게이트 결정을 제안한다. ── */}
          {shortlistedTargets.length > 0 && (
            <section aria-label={t("andCommitteeRecommendation")} className="market-section">
              <SectionToolbar
                title={t("andCommitteeRecommendationTargetChecklist")}
                summary={
                  <span className="note">
                    {t("finalShortlistCheckNotAn")}
                    <span className={`status-chip ml-2 ${precheckIncomplete === 0 ? "status-green" : "status-amber"}`}>
                      {precheckIncomplete === 0
                        ? t("reviewComplete")
                        : t("incompleteP1P2", { p1: precheckIncomplete, p2: shortlistedTargets.length })}
                    </span>
                  </span>
                }
              />
              {/* 통합 플로우(사용자 결정, 2026-09-16): 아래 "위원회 추천 검토 · 소집"
                  버튼 하나가 (1) 후보별로 기확보 정보(전자공시 재무 정보·AI 프로파일·
                  공시 — 재검색 안 함)를 활용하고 부족한 정보만 검색해 판정 제안을
                  만들고 (2) 그 제안을 심의 근거로 위원회를 소집한다. 사람은 표에서
                  제안을 검토·수정한 뒤 저장으로 확정하고, 게이트 결정(사람)으로
                  이어진다. */}
              {(() => {
                // 접힘 기본값: 사용자 선택 > (미완료 → 펼침 / 완료 → 접음)
                const precheckOpenEffective = precheckOpen ?? precheckIncomplete > 0;
                return (
                  <details
                    open={precheckOpenEffective}
                    onToggle={(e) => setPrecheckOpen((e.currentTarget as HTMLDetailsElement).open)}
                  >
                    <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      {t("openCloseJudgementTableCandidate")} {shortlistedTargets.length}
                      {t("itemSTargetChecklist")} {checklistItems.length}
                      {tc("items")}
                    </summary>
                    {recoBusy && (
                      <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg)] mb-2" role="status">
                        {t("generatingEvidenceCollectionAndJudgement")} {recoProgress ?? t("preparing")}{" "}
                        {t("whenDoneTheUnjudgedCells")}
                      </p>
                    )}
                    <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      {t("thisTableIsThe")} <b>{t("committeeRecommendationReviewAndConvene")}</b>{" "}
                      {t("buttonPressingItFillsThe")} <b>{t("saveJudgement")}</b>
                      {t("toConfirm")}
                    </p>
                    {/* 전치 테이블 — 평가 항목(9개 항목)이 컬럼 헤더, 후보가 행(사용자
                  제안, 2026-09-16). 후보 간 비교와 위원회 검토에 맞는 형태다.
                  셀은 판정 select 하나로 압축하고, 근거(제안 사유·출처·기확보
                  구분)는 툴팁과 표식으로 보여준다. */}
                    {/* biome-ignore lint/a11y/useSemanticElements: design-system scroll region (WCAG 2.1.1) — a focusable labelled region so keyboard users can scroll a wide table */}
                    <div
                      className="table-scroll"
                      role="region"
                      aria-label={tc("dataTableHorizontalScroll")}
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: design-system scroll region (WCAG 2.1.1)
                      tabIndex={0}
                    >
                      <table
                        className="data-table table-fixed-pct tmin-80"
                        aria-label={t("andCommitteeRecommendation2")}
                      >
                        <caption className="sr-only">{t("shortlistCandidateTargetChecklistItem")}</caption>
                        <ColGroup widths={shortlistColPct(checklistItems.length)} />
                        <thead>
                          <tr>
                            <th rowSpan={2} scope="col">
                              {t("candidate")}
                            </th>
                            <th colSpan={part1Count} scope="colgroup" className="text-center">
                              {t("part1RequiredItemsAny")}
                            </th>
                            <th colSpan={part2Count} scope="colgroup" className="text-center">
                              {t("part2RecommendedEvaluation")}
                            </th>
                            <th rowSpan={2} scope="col">
                              {tc("confirmed")}
                            </th>
                          </tr>
                          <tr>
                            {checklistItems.map((it) => (
                              <th
                                key={it.id}
                                scope="col"
                                title={t("p1P2", { p1: it.text, p2: it.mandatory ? tc("requiredSuffix") : "" })}
                              >
                                <code className="dd-item-id mr-1">{it.id}</code>
                                {it.text.split(" — ")[0]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {shortlistedTargets.map((tgt) => {
                            const states = tgt.screening_json
                              ? (JSON.parse(tgt.screening_json) as Record<string, string>)
                              : {};
                            const concern = ["t-01", "t-02"].some(
                              (id) => normalizeVerdict(states[id]) === "unfulfilled",
                            );
                            const sm = tgt.screening_summary;
                            const total = sm?.total ?? checklistItems.length;
                            const draft = precheckDraft[tgt.id] ?? {};
                            const dirtyCount = Object.keys(draft).length;
                            // 추천안 — 확정 판정 + 미확정 제안을 합쳐 결정론 규칙으로 도출
                            // (Part 1 knock-out 기준). 위원회 제안이며 확정은 사람이 저장으로 한다.
                            const mergedVerdicts: Record<string, string> = { ...states };
                            for (const [itemId, d] of Object.entries(draft)) {
                              if (d.verdict) mergedVerdicts[itemId] = d.verdict;
                            }
                            const reco = precheckRecommendation(mergedVerdicts);
                            const hasReco = [...KNOCKOUT_IDS].some(
                              (id) => mergedVerdicts[id] && mergedVerdicts[id] !== "pending",
                            );
                            // 진행 칩은 확정+미확정 제안을 합쳐 센다 — 제안으로 채워져도
                            // 0/9로 보이는 문제를 막는다(사용자 리포트, 2026-09-16).
                            const mergedAssessed = checklistItems.filter((it) => {
                              const nv = normalizeVerdict(mergedVerdicts[it.id]);
                              return nv !== "pending";
                            }).length;
                            const mergedClass = sm?.anyKnockOutFail
                              ? "status-red"
                              : mergedAssessed === 0
                                ? "status-not-started"
                                : mergedAssessed < total || (sm?.mandatoryOpen.length ?? 0) > 0
                                  ? "status-amber"
                                  : "status-green";
                            const note = precheckDraftNote[tgt.id];
                            return (
                              <tr key={tgt.id}>
                                <td className="cell-primary">
                                  <div className="flex flex-col gap-1">
                                    <strong className="text-[length:var(--fs-body)]">
                                      {tgt.company_name}
                                      {tgt.rank ? ` · rank ${tgt.rank}` : ""}
                                    </strong>
                                    <span className="flex flex-wrap items-center gap-1">
                                      {concern && (
                                        <span className="status-chip status-red" title={t("item1Or2Unmet")}>
                                          {t("acquisitionFeasibilityConcern")}
                                        </span>
                                      )}
                                      {hasReco && (
                                        <span
                                          className={`status-chip ${reco.cls}`}
                                          title={t("committeeRecommendationAgainstPart1", {
                                            p1: dirtyCount > 0 ? t("includesUnconfirmedProposals") : "",
                                          })}
                                        >
                                          {t("recommendation")} {reco.label}
                                        </span>
                                      )}
                                      <span
                                        className={`status-chip ${mergedClass}`}
                                        title={t("nineItemJudgementP1P2P3P4P5", {
                                          p1: mergedAssessed,
                                          p2: total,
                                          p3:
                                            dirtyCount > 0
                                              ? t("p1UnconfirmedProposalSIncluded", { p1: dirtyCount })
                                              : "",
                                          p4: sm?.mandatoryOpen.length
                                            ? t("unjudgedRequiredP1", { p1: sm.mandatoryOpen.join(", ") })
                                            : "",
                                          p5: sm?.anyKnockOutFail ? t("hasUnmetRequiredItems") : "",
                                        })}
                                      >
                                        {tc("judgement")} {mergedAssessed}/{total}
                                      </span>
                                    </span>
                                  </div>
                                </td>
                                {checklistItems.map((it) => {
                                  const v = draft[it.id]?.verdict ?? states[it.id] ?? "pending";
                                  const meta = draft[it.id];
                                  // 근거(제안 사유·출처)는 셀 안 링크 대신 툴팁으로 — 링크가
                                  // 셀 아래 줄을 만들어 행 높이가 어긋나는 문제를 막는다
                                  // (사용자 UI 리포트, 2026-09-16). 전체 근거는 후보 상세
                                  // '사전 검토 근거' 탭에서 본다.
                                  const tip = [
                                    it.text,
                                    meta?.rationale ? t("proposalReasonP1", { p1: meta.rationale }) : null,
                                    meta?.source_url ? t("sourceP1", { p1: meta.source_url }) : null,
                                  ]
                                    .filter(Boolean)
                                    .join("\n");
                                  return (
                                    <td key={it.id}>
                                      <select
                                        aria-label={t("p1P2Judgement", { p1: tgt.company_name, p2: it.id })}
                                        className="sizing-new-input sizing-new-input-sm w-full"
                                        style={{ minWidth: "5.5rem" }}
                                        title={tip}
                                        disabled={!canAct}
                                        value={v}
                                        onChange={(e) =>
                                          setPrecheckDraft((prev) => ({
                                            ...prev,
                                            [tgt.id]: { ...(prev[tgt.id] ?? {}), [it.id]: { verdict: e.target.value } },
                                          }))
                                        }
                                      >
                                        <option value="pending">{tc("unjudged")}</option>
                                        {SCREENING_VERDICT_KEYS.map((sv) => (
                                          <option key={sv} value={sv}>
                                            {SCREENING_VERDICT_KO[sv]}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                  );
                                })}
                                <td>
                                  <div className="flex flex-col items-start gap-1">
                                    {canAct && (
                                      <button
                                        type="button"
                                        className="btn-ghost btn-sm"
                                        disabled={precheckBusy === tgt.id || recoBusy}
                                        aria-disabled={dirtyCount === 0 || undefined}
                                        title={
                                          dirtyCount === 0
                                            ? t("noChangedJudgementsChangeA")
                                            : t("savesTheJudgementsPickedOn")
                                        }
                                        onClick={() => {
                                          if (dirtyCount === 0) return;
                                          savePrecheck(tgt.id);
                                        }}
                                      >
                                        {t("saveJudgement2")}
                                        {dirtyCount > 0 ? t("p1ItemS", { p1: dirtyCount }) : ""}
                                      </button>
                                    )}
                                    {canAct && dirtyCount === 0 && (
                                      // disabled 대신 aria-disabled — 버튼이 포커스 가능하게
                                      // 남아 무엇이 빠졌는지 설명에 키보드로 도달할 수 있다.
                                      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                        {t("noChangedJudgements")}
                                      </span>
                                    )}
                                    {note && (
                                      <span
                                        className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] max-w-[10rem] truncate"
                                        title={note}
                                      >
                                        {note}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* 위원회 심의 — "위원회 추천 검토 · 소집" 버튼 하나로 (1) 위 표의
                  판정 제안 생성(기확보 정보 활용 + 부족한 정보만 검색)과 (2) 그
                  제안을 근거로 한 위원회 소집이 함께 실행된다(ADR-0097 · 사용자
                  결정 2026-09-16 — 제안 생성과 소집의 역할 중복을 해소). 소집된
                  위원회의 심의 결과는 제안일 뿐이며, 확정은 사람이 한다.
                  재무·기술 평가(랭킹용)와 역할은 분리된다. */}
                    <div className="flex flex-wrap items-center gap-2 mt-2 mb-0">
                      {precheckIncomplete === 0 ? (
                        <span className="status-chip status-green">{t("complete")}</span>
                      ) : (
                        <span className="status-chip status-amber" title={t("someCandidatesHaveMissingJudgements")}>
                          {t("incomplete")} {precheckIncomplete}/{shortlistedTargets.length}
                        </span>
                      )}
                      <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                        {t("buttonFillsTheUnjudgedCells")}
                      </span>
                    </div>
                  </details>
                );
              })()}
              <CommitteePanel
                opportunityId={selected.opportunity.id}
                committeeKey="target-longlist-shortlist-committee"
                committeeLabel={t("s6S7ShortlistFinalReview")}
                gates={["target_screening"]}
                briefMd={buildEvalBriefMd(selected.targets, selected.checklist, precheckDraft, tr)}
                beforeConvene={runCommitteePrecheck}
                conveneLabel={t("runCommitteeRecommendationReview")}
                headerPrimary
              />
            </section>
          )}
          {dealShapePanel && <DealShapePanel opportunityId={selected.opportunity.id} canAct={canAct} />}
          {/* flow.spec target_screening killCriteria: knock-out 통과 후보가 0건이다. 2026-10-20 decider:
              the old proxy ("evaluation complete = every item judged") fired the kill language whenever
              later-seeded criteria stayed pending — evaluation completeness is informational, not a kill. */}
          <GateDecisionPanel
            opportunityId={selected.opportunity.id}
            gates={["target_screening"]}
            killHint={
              selected.targets.length > 0 && !selected.targets.some((t) => t.status !== "excluded")
                ? t("zeroCandidatesPassedTheScreening")
                : null
            }
          />
          {(() => {
            const incomplete = selected.targets.filter(
              (t) => t.status !== "excluded" && t.eval_summary && !t.eval_summary.complete,
            );
            if (incomplete.length === 0) return null;
            return (
              <p
                role="note"
                className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2"
                data-testid="eval-incomplete-note"
              >
                {t("shortlistCandidatesWithEvaluationIncomplete")} {incomplete.length}
                {t("itemS")}
                {incomplete.map((cand) => cand.company_name).join(", ")}
                {t("theScoreIsConfirmedBy")}
              </p>
            );
          })()}
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            {t("theTargetSelectionGateAbove")} <b>{tc("inProgress")}</b>
            {t("mustBeRecordedBeforeThe")}
          </p>
          {/* ADR-0095 — S7→S8 승격 표면: 완료 요건 충족 시 사람이 승격을 기록한다 */}
          <PromotionPanel
            opportunityId={selected.opportunity.id}
            heading={t("p1ProceedAsAProject", { p1: selected.opportunity.name })}
          />
        </div>
      )}
    </>
  );
}
