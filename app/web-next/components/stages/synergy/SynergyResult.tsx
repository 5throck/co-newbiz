"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useEffect, useState } from "react";
import { SectionToolbar } from "../../layout.tsx";
import { ListBackButton } from "../../ListBackButton.tsx";
import { PrimaryAction } from "../../ui.tsx";
import { GateDecisionPanel } from "../../GateDecisionPanel.tsx";
import { useSynergyResult } from "./useSynergyResult.ts";
import { COMPLETION_HEADING_ID, SynergySelectPanel } from "./SynergySelectPanel.tsx";
import { SynergyCompletionStatusLine } from "./SynergyCompletionStatusLine.tsx";
import { useOpportunityStatus } from "./useOpportunityStatus.ts";
import { SynergyScoreEvaluationTab, SynergyShortlistTab, SynergyProfileContext } from "./SynergyTabs.tsx";
import { SynergyCapabilityTab } from "./SynergyCapabilityTab.tsx";
import { SynergyFlowDiagram } from "./SynergyFlowDiagram.tsx";
import { SynergyLinkageTab } from "./SynergyLinkageTab.tsx";
import { targetLabel, STEP_TITLES_KEYS, TABS } from "./synergyFormat.ts";
import type { SynergyAnalysis } from "./types.ts";
import type { TabKey } from "./synergyFormat.ts";
import { useTranslations } from "next-intl";

export function SynergyResult(props0: {
  analysis: SynergyAnalysis;
  tab: TabKey;
  onTab: (k: TabKey) => void;
  onBack: () => void;
  onRerun: () => void;
  onRefresh: () => void;
}) {
  const tr = useTranslations();
  const t = useTranslations("stages.s3.synergyResult");
  const tc = useTranslations("common");
  const tsp = useTranslations("stages.s3.synergySelectPanel");
  const h0 = useSynergyResult(props0);
  const ctx = { ...h0 };
  // current_step is 1-based (pipeline advance(1..5) marks the step being run) while the title
  // list is 0-based; step 0/5+ has no title. Never hand an empty/unknown key to the translator
  // (MISSING_MESSAGE: Could not resolve `` in messages).
  const stepKey = STEP_TITLES_KEYS[props0.analysis.current_step - 1];
  const stepTitle = stepKey && tr.has(stepKey) ? tr(stepKey) : "";
  const {
    analysis,
    analysisDate,
    latest,
    synState,
    onBack,
    canCurate,
    inProgress,
    onRefresh,
    p,
    tab,
    onTab,
    opportunityId,
    advanceToRouteDecision,
    advanceError,
    confirmForm,
    confirmSaving,
    confirmSynergyScore,
  } = ctx;
  // The `selected` status is read once here (single GET) and shared by the status line above the
  // tabs and the decision-tab checklist (design 2026-11-07-s3-completion-into-decision-tab §8).
  const oppStatus = useOpportunityStatus(opportunityId);
  const completed = oppStatus.status === "selected";
  // Jump link: switch to the decision tab, then move focus to its checklist heading once rendered.
  const [focusDecision, setFocusDecision] = useState(false);
  useEffect(() => {
    if (!focusDecision || tab !== "decision") return;
    document.getElementById(COMPLETION_HEADING_ID)?.focus();
    setFocusDecision(false);
  }, [focusDecision, tab]);
  return (
    <section aria-label={t("synergyConsistencyReport")} className="market-section sizing-step">
      {!synState?.confirmed && (
        <PrimaryAction
          label={confirmSaving ? tc("saving") : t("saveFitEvaluation")}
          onClick={confirmSynergyScore}
          disabled={!canCurate || !opportunityId || confirmSaving || confirmForm.score === ""}
          disabledReason={
            !canCurate
              ? t("savingTheFitEvaluationRequires")
              : !opportunityId
                ? t("canBeSavedOnlyIn")
                : confirmSaving
                  ? tc("savingPolite")
                  : t("enterTheScoreInThe")
          }
        />
      )}
      <SectionToolbar
        title={t("p1SynergyConsistencyAnalysis", { p1: targetLabel(analysis, tr) })}
        icon=""
        summary={
          <span className="flex items-center gap-1">
            <span className="section-meta">
              {t("s3SynergyAreaSelectionAnd")} {analysisDate} · v{latest?.version_no ?? analysis.latest_version ?? 1}
            </span>
            {analysis.opportunity_name && (
              <span
                className="status-chip status-in-progress"
                title={t("linkedOpportunityP1", { p1: analysis.opportunity_name })}
              >
                {t("opportunity")} {analysis.opportunity_name}
              </span>
            )}
            {(() => {
              const score =
                synState?.synergyScore ??
                (typeof latest?.payload?.synergyScore === "number" ? latest.payload.synergyScore : null);
              if (typeof score !== "number") return null;
              // 경계 #2 — 권고(미확정)와 사람 확정을 같은 스타일로 보이지 않는다.
              return synState?.confirmed ? (
                <span
                  className="status-chip status-green"
                  title={t("humanConfirmedP1", {
                    p1: synState.confirmedAt ? ` — ${synState.confirmedAt.slice(0, 10)}` : "",
                  })}
                >
                  {t("synergyConfirmed")} {score}
                </span>
              ) : (
                <span className="status-chip status-amber" title={t("recommendationValueBeforeHumanConfirmation")}>
                  {t("synergyRecommendationUnconfirmed")} {score}
                </span>
              );
            })()}
            {completed && <span className="status-chip status-green">{tsp("statusLineDone")}</span>}
          </span>
        }
        actions={<ListBackButton onClick={onBack} />}
      />

      {opportunityId && p && !completed && !oppStatus.loading && (
        <SynergyCompletionStatusLine
          onJumpToDecision={() => {
            setFocusDecision(true);
            onTab("decision");
          }}
        />
      )}

      {inProgress && (
        <p className="text-[length:var(--fs-body)]" role="status">
          {tc("analyzingOpen")}
          {analysis.current_step}
          {t("n5Steps")} {stepTitle ? `${stepTitle} ` : ""}
          {t("inProgressItRefreshesAutomatically")}
        </p>
      )}
      {!p && !inProgress && <p className="text-[color:var(--muted-fg)] italic">{t("noAnalysisResults")}</p>}

      {p && (
        <>
          <div className="library-tabs" role="tablist" aria-label={t("reportSection")}>
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`library-tab ${tab === key ? "library-tab-active" : ""}`}
                onClick={() => onTab(key)}
              >
                {tr(label)}
              </button>
            ))}
          </div>

          {/* ADR-0182 Phase 1 — 4요소 관계도: 연계(후보) → 우선(선별) → 필요 역량(레지스터) → 시너지 점수.
              노트 클릭 시 해당 탭으로 이동. 프로파일 요약(구 개요 탭)은 탭이 아니라
              이 관계도 아래 상시 컨텍스트로 표시 — 상세는 /our-company(ADR-0094). */}
          <SynergyFlowDiagram
            data={{
              linkageCount: ctx.p?.marketLinkage.synergyAreas.length ?? 0,
              shortlistCount: (ctx.p?.shortList ?? []).filter((s) => s.verdict === "Short List").length,
              capabilityRows: ctx.gapRows.length,
              capabilityJudged: ctx.gapSummary.evaluated,
              capabilityCoveragePct: ctx.gapSummary.coveragePct,
              synergyScore: ctx.currentScore,
              scoreConfirmed: ctx.synState?.confirmed ?? false,
            }}
            activeTab={tab}
            onJump={onTab}
          />
          <SynergyProfileContext p={p} />

          {tab === "linkage" && <SynergyLinkageTab ctx={ctx} p={p} />}

          {tab === "shortlist" && <SynergyShortlistTab ctx={ctx} p={p} />}

          {tab === "capability" && <SynergyCapabilityTab ctx={ctx} p={p} />}

          {tab === "scoreEval" && <SynergyScoreEvaluationTab ctx={ctx} p={p} />}

          {tab === "refs" && (
            <div className="text-[length:var(--fs-body)]">
              {/* ADR-0181 (2026-10-18, decider feedback): the refs tab used to
                  render nothing relevant when web research was unconfigured.
                  Now: step notes render OPEN, an empty source list says so
                  explicitly, and the pipeline provenance (profile reuse,
                  credit text) shows as a note. */}
              <details className="market-section" open={p.researchSources.length > 0}>
                <summary className="cursor-pointer text-[length:var(--fs-body)]">
                  {t("acquisitionSource")}
                  {p.researchSources.length}
                  {t("itemSSourcesNamedAnd")}
                </summary>
                {p.researchSources.length > 0 ? (
                  <ul className="sizing-note-list mt-2">
                    {p.researchSources.map((s) => (
                      <li key={`${s.url}|${s.title}`}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[color:var(--accent)] underline"
                        >
                          {s.title}
                        </a>
                        <span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0">
                    {t("webResearchNotConfiguredOr")}
                  </p>
                )}
              </details>
              <div className="market-section">
                <h3 className="sizing-step-title text-[length:var(--fs-body)]">
                  {t("pipelineStepNotes")}
                  {p.stepSummaries.length}
                  {t("step")}
                </h3>
                <ol className="mt-2 space-y-2 text-[length:var(--fs-body)]">
                  {p.stepSummaries.map((s) => (
                    // step 번호는 한 단계에 여러 노트가 있을 수 있어 단독 키가 아니다
                    // (step 3 요약이 최대 3건 — 표시 전용 복합키, 파이프라인 재번호 없음)
                    <li key={`${s.step}-${s.title}`}>
                      <strong>
                        {s.step}. {s.title}
                      </strong>{" "}
                      <span
                        className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}
                      >
                        {s.source === "llm" ? "AI" : t("system")}
                      </span>
                      <br />
                      {s.summary}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {/* ADR-0181 (2026-10-18, decider feedback): the screening gate panel
              ("의사결정 — 승인 기록") moved OUT of the under-tab fixed area
              INTO its own 의사결정 tab (after 우선 시너지 영역) — it used to
              render under EVERY tab, which read as duplication. GO 기록이 곧
              S4 진행 결정이므로 GO 기록 시 바로 opportunity를 selected로
              표시하고 /route-decision으로 이동한다 (ADR-0094 경계 #2). */}
          {tab === "decision" && (
            <>
              {opportunityId && (
                <SynergySelectPanel
                  opportunityId={opportunityId}
                  synState={synState}
                  canCurate={canCurate}
                  status={oppStatus.status}
                  statusLoadFailed={oppStatus.loadFailed}
                  onRetryStatus={() => void oppStatus.refresh()}
                  onSelected={async () => {
                    await oppStatus.refresh();
                    onRefresh();
                  }}
                  onTab={onTab}
                />
              )}
              {opportunityId && (
                <div className="mt-2">
                  <GateDecisionPanel
                    opportunityId={opportunityId}
                    gates={["screening"]}
                    carrierStage="S3"
                    onRecorded={(decision, gate) => {
                      if (decision === "go" && gate === "screening") void advanceToRouteDecision();
                    }}
                  />
                  <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    {t("recordingAGoMarksThis")}
                  </p>
                </div>
              )}
              {advanceError && (
                <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1">
                  {advanceError}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
