"use client";

// S12 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/portfolio 페이지와
// /deals/[id]/s12 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.

import { TranslatorFn } from "../../i18n/config.ts";
import { useCallback, useEffect, useState } from "react";
import { StageTabs } from "../StageTabs.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { ColGroup, PrimaryAction } from "../ui.tsx";

// 벤처 클래스 롤업 6열 — 클래스명 + 수치 5열.
const CLASS_ROLLUP_COL_PCT = [25, 15, 15, 15, 15, 15] as const;
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { useConfirm } from "../crud.tsx";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { RECORD_KEY, TRANSITION_DECISION_KEY, VENTURE_CLASS_KEY } from "../../lib/label-keys.ts";
import { RawKey } from "../RawKey.tsx";
import { ClosureModal } from "../ClosureModal.tsx";
import { useRouter } from "next/navigation";
import { PostManagementPanel } from "./PostManagementPanel.tsx";
import { PolicyMigrationPanel } from "./PolicyMigrationPanel.tsx";
import { useTranslations } from "next-intl";

// S12 사후 관리 — 포트폴리오 스코어카드 열람 + 포트폴리오 전환 결정 기록 화면
// (ADR-0101 §3). 이 화면은 venture-portfolio-IC의 '인적 결정'을 기록하는
// 표면이다 (경계 #2 — 트랜치 집행과 kill/divest는 투자결정이므로 사람의
// 행위다): 스코어카드는 데이터만 보여주며 kill/fund 권고를 하지 않고, 결정
// 기록은 명시적 P4 확인(useConfirm)을 거친 analyst+ 행위다. 기록자(recorder)는
// 세션 사용자, 결정자는 사람 역할 키로 화면에 분리 표기한다(레코드 키는 개발자
// 상세 공개에만 노출 — design 2026-10-11-ui-label-and-mobile-table-sweep).

interface RollupRow {
  id: string;
  project_no: string; venture_class: string; section: string; measure_key: string;
  target_value: string | null; actual_value: string | null; status: string;
  evidence_ref: string; observed_at: string;
}
interface ClassRollupEntry { venture_class: string; ventures: number; measures: number; on_target: number; deviation: number; insufficient_evidence: number }
interface TrendEntry { review_cycle: string; measures: number; on_target: number; deviation: number; insufficient_evidence: number }
interface DecisionRow {
  id: string; review_cycle: string; decision: string; decided_by: string;
  decided_at: string; rationale: string; learning_capture: string | null;
  created_at: string; recorded_by: string;
}
interface ScorecardView {
  project: { id: string; project_no: string };
  rollup: {
    review_cycle: string | null; resolved_from: "explicit" | "latest";
    financial: RollupRow[]; strategic: RollupRow[];
    class_rollup: ClassRollupEntry[];
    insufficient_evidence: Array<{ project_id: string; section: string; measure_key: string }>;
    provenance: { runs: string[]; review_cycles_available: string[] };
  };
  trend: TrendEntry[];
  decisions: { latest: DecisionRow | null; history: DecisionRow[] };
}

// flow.spec v2.0.0 S12 어휘 5종 — 라벨은 lib/label-keys.ts TRANSITION_DECISION_KEY(common.transitionDecision.*)로
// 통합 (design 2026-10-11-ui-label-and-mobile-table-sweep §1.2). 서버가 재검증한다.

// P5: 상태는 색+아이콘+텍스트의 조합 — 색 단독으로 상태를 전달하지 않는다.
const STATUS_META = (tr: TranslatorFn): Record<string, { icon: string; label: string; cls: string }> => ({
  on_target: { icon: "●", label: "common.goalAttainment", cls: "status-green" },
  deviation: { icon: "◐", label: "common.churn", cls: "status-amber" },
  insufficient_evidence: { icon: "○", label: "common.insufficientEvidence", cls: "status-not-started" },
});

function statusMeta(status: string | undefined, tr: TranslatorFn) {
  const m = STATUS_META(tr)[status ?? ""];
  return m ? { ...m, label: tr(m.label) } : { icon: "?", label: status ?? "unknown", cls: "status-not-started" };
}

const EMPTY_FORM = { decision: "next_tranche_released", rationale: "", learning_capture: "", review_cycle: "", record: "" };

// ADR-0151: each non-kill transition carries its own dedicated record column;
// the route answers 400 without it, so the form must collect it.
const RECORD_FIELD = (tr: TranslatorFn): Record<string, { key: "tranche_condition" | "core_handoff" | "divest_plan"; label: string }> => ({
  next_tranche_released: { key: "tranche_condition", label: "stages.s12.stage.nextExecutionStageConditionRequired" },
  held_evidence_incomplete: { key: "tranche_condition", label: "stages.s12.stage.nextExecutionStageConditionRequired2" },
  graduate_to_core: { key: "core_handoff", label: "stages.s12.stage.coreBusinessHandoverRecordRequired" },
  reduce_or_divest: { key: "divest_plan", label: "stages.s12.stage.divestmentLiquidationPlanRequired" },
});

export function PortfolioStage({ projectId }: { projectId: string }) {const tr = useTranslations(); const t = useTranslations("stages.s12.stage"); const tc = useTranslations("common");
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [view, setView] = useState<ScorecardView | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ADR-0118 — S12 모니터링 브리프(초안). 전환 결정은 사람(venture-portfolio-IC)이 기록한다.
  interface MonitoringBrief {
    source: "llm" | "synthesis";
    provider: string | null;
    note: string | null;
    manifest: string[];
    brief: {
      assessment_draft: string;
      risk_flags: string[];
      transition_suggestion: string | null;
      rationale_draft: string;
      learning_capture_draft: string;
      key_evidence: string[];
      cautions: string[];
    };
  }
  const [reco, setReco] = useState<MonitoringBrief | null>(null);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

  async function generateBrief() {
    if (recoLoading) return;
    setRecoLoading(true); setRecoError(null);
    try {
      const r = await api.post<MonitoringBrief>(`/api/projects/${encodeURIComponent(projectId)}/monitoring-brief`, {});
      setReco(r.data);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : t("failedToGenerateBrief"));
    } finally {
      setRecoLoading(false);
    }
  }

  const load = useCallback(() => {
    api.get<ScorecardView>(`/api/projects/${encodeURIComponent(projectId)}/scorecard`)
      .then((r) => setView(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheScorecard")));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function recordDecision() {
    confirm(t("recordPortfolioTransitionDecision"), () => {
      void (async () => {
        setBusy(true); setError(null);
        try {
          await api.post(`/api/projects/${encodeURIComponent(projectId)}/transition-decision`, {
            decision: form.decision,
            rationale: form.rationale,
            learning_capture: form.learning_capture || undefined,
            review_cycle: form.review_cycle || undefined,
            ...(recordField && form.record.trim() ? { [recordField.key]: form.record.trim() } : {}),
          });
          setNotice(t("transitionDecisionRecordedTheDecider"));
          setForm({ ...EMPTY_FORM });
          load();
        } catch (e) {
          setError(e instanceof Error ? e.message : t("failedToRecordTheTransition"));
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: t("recordsTheDecisionInThe"),
      confirmLabel: tc("record"),
    });
  }

  const isKill = form.decision === "kill_with_learning_captured";
  const recordField = RECORD_FIELD(tr)[form.decision];
  const rollup = view?.rollup;

  return (
<>
      {/* 리뷰 2026-10-22 (사용자 리포트): StageTabs는 레일 슬롯으로 — 머리 위치 일관성. */}
      <StageFrame
        stageId="S12"
        heading={t("s12ManagementPortfolioScorecardAnd")}
        railSlot={<StageTabs projectId={projectId} />}
      >
        {/* Wave U-1 (design §3.5): home of the closure flow — preconditions are
            shown inside ClosureModal; the decision itself stays human-only. */}
        <PrimaryAction
          label={t("closingThe")}
          onClick={() => setClosing(true)}
          disabled={!canWriteProject(me?.role)}
          disabledReason={t("closingTheProjectRequiresThe")}
        />
        {canWriteProject(me?.role) && (
          <p className="mb-3 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("closurePreconditionsAreCheckedIn")}</p>
        )}
        {closing && (
          <ClosureModal
            entity="project"
            entityId={projectId}
            entityName={projectId}
            onClose={() => setClosing(false)}
            onDone={() => { setClosing(false); router.push("/projects/archives"); }}
          />
        )}
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          {t("theS12CompletionCriteriaAre")}
          {view && rollup?.review_cycle && (
            <span className={`status-chip ${rollup.financial.length + rollup.strategic.length > 0 ? "status-green" : "status-amber"} ml-2`}>
              {rollup.financial.length + rollup.strategic.length > 0
                ? t("latestCycleP1P2", { p1: rollup.review_cycle, p2: rollup.resolved_from === "latest" ? t("automaticInterpretationOfTheLatest") : t("explicitlySpecified") })
                : t("noScorecardRecordedP1", { p1: rollup.review_cycle })}
            </span>
          )}
        </p>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}

        {/* ── 주기별 트렌드 ──────────────────────────────────────────── */}
        <section className="market-section sizing-step" aria-label={t("scorecardTrend")}>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge" aria-hidden="true">📈</span> {t("scorecardTrendQuarterlySummary")}
          </h3>
          {(view?.trend.length ?? 0) > 0 ? (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table" aria-label={t("quarterlyScorecardSummary")}>
              <caption className="sr-only">{t("measurementSummaryByReviewCycle")}</caption>
              <thead>
                <tr><th scope="col">{tc("reviewCycle")}</th><th scope="col">{t("measurementCount")}</th><th scope="col">{tc("goalAttainment")}</th><th scope="col">{tc("churn")}</th><th scope="col">{tc("insufficientEvidence")}</th></tr>
              </thead>
              <tbody>
                {view!.trend.map((t) => (
                  <tr key={t.review_cycle}>
                    <td className="tabular-nums">{t.review_cycle}</td>
                    <td className="tabular-nums">{t.measures}</td>
                    <td className="tabular-nums"><span className="status-chip status-green">● {t.on_target}</span></td>
                    <td className="tabular-nums"><span className="status-chip status-amber">◐ {t.deviation}</span></td>
                    <td className="tabular-nums"><span className="status-chip status-not-started">○ {t.insufficient_evidence}</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("noScorecardCyclesRecordedYet")}
            </p>
          )}
        </section>

        {/* ── 최신 주기 롤업 ─────────────────────────────────────────── */}
        <section className="market-section sizing-step mt-3" aria-label={t("latestCycleScorecard")}>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge" aria-hidden="true">🗂</span> {t("latestCycle")}
            {rollup?.review_cycle && <span className="status-chip status-not-started ml-2">{rollup.review_cycle}</span>}
          </h3>
          {(rollup?.class_rollup.length ?? 0) > 0 && (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table table-fixed-pct tmin-40" aria-label={t("ventureClass")}>
              <caption className="sr-only">{t("summaryByClass")}</caption>
              <ColGroup widths={CLASS_ROLLUP_COL_PCT} />
              <thead>
                <tr><th scope="col">{t("class")}</th><th scope="col">{t("ventureCount")}</th><th scope="col">{tc("measurement")}</th><th scope="col">{t("attained")}</th><th scope="col">{tc("churn")}</th><th scope="col">{tc("insufficientEvidence")}</th></tr>
              </thead>
              <tbody>
                {rollup!.class_rollup.map((c) => (
                  <tr key={c.venture_class}>
                    <td>{tr(VENTURE_CLASS_KEY[c.venture_class] ?? c.venture_class)}</td>
                    <td className="tabular-nums">{c.ventures}</td>
                    <td className="tabular-nums">{c.measures}</td>
                    <td className="tabular-nums">{c.on_target}</td>
                    <td className="tabular-nums">{c.deviation}</td>
                    <td className="tabular-nums">{c.insufficient_evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          {(["financial", "strategic"] as const).map((section) => (
            <div key={section} className="mt-2">
              <h4 className="text-[length:var(--fs-body)] mb-1">{section === "financial" ? tc("finance") : t("strategy")} {tc("section")}</h4>
              {(rollup?.[section].length ?? 0) > 0 ? (
                <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table" aria-label={t("p1MeasurementDetails", { p1: section })}>
                  <caption className="sr-only">{section} {t("sectionMeasurementDetails")}</caption>
                  <thead>
                    <tr><th scope="col">{tc("measurement")}</th><th scope="col">{t("class2")}</th><th scope="col">{tc("target")}</th><th scope="col">{tc("actual")}</th><th scope="col">{tc("status")}</th></tr>
                  </thead>
                  <tbody>
                    {rollup![section].map((r) => {
                      const meta = statusMeta(r.status, tr);
                      return (
                        <tr key={r.id}>
                          <td>{r.measure_key}</td>
                          <td>{tr(VENTURE_CLASS_KEY[r.venture_class] ?? r.venture_class)}</td>
                          <td>{r.target_value ?? "—"}</td>
                          <td>{r.actual_value ?? "—"}</td>
                          <td><span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              ) : (
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noMeasurementRecordsForThis")}</p>
              )}
            </div>
          ))}
          {(rollup?.insufficient_evidence.length ?? 0) > 0 && (
            <ul className="sizing-note-list mt-2">
              {rollup!.insufficient_evidence.map((e, i) => (
                <li key={`${e.section}-${e.measure_key}-${i}`}>
                  <strong>{t("exception")}</strong>: {e.measure_key} ({e.section}{t("cannotJudgeWithoutATarget")}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── ADR-0161: 적용되는 사후 관리 항목 · 신규 사업 가동 지표 · 통합/전략 제휴 모니터링 (읽기 전용) ── */}
        <PostManagementPanel projectId={projectId} />

        {/* ── LLM 모니터링 브리프 (결정 지원) — ADR-0118: 초안은 LLM, 전환 결정은 사람 ── */}
        {canAct && (
          <section className="market-section sizing-step mt-3" aria-label={t("aiMonitoringBrief")}>
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("aiMonitoringBriefDraft")}</h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("principleBoundaryTheTransitionDecision")} <b>{t("draft")}</b>{t("item")}
            </p>
            {recoError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mb-2">{recoError}</p>}
            {!reco && !recoLoading && !recoError && (
              <div className="flex flex-wrap items-center gap-2 mb-0">
                <button type="button" className="btn-ghost" onClick={() => void generateBrief()}>{t("generateMonitoringBrief")}</button>
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("draftsTheInvestmentStatusEvaluation")}</span>
              </div>
            )}
            {recoLoading && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">{t("draftingFromScorecardCertificationAnd")}</p>}
            {reco && (
              <>
                <p className="mb-1 flex flex-wrap items-center gap-1">
                  <span className={`status-chip ${reco.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                    {reco.source === "llm" ? t("llmDraftP1", { p1: reco.provider ? ` · ${reco.provider}` : "" }) : tc("deterministicFallback")}
                  </span>
                  {reco.brief.transition_suggestion && (
                    <span className="status-chip status-amber">{t("transitionProposal")} {tr(TRANSITION_DECISION_KEY[reco.brief.transition_suggestion] ?? reco.brief.transition_suggestion)}</span>
                  )}
                </p>
                {reco.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{reco.note}</p>}
                {reco.brief.assessment_draft && <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">{t("statusEvaluationDraft")}</span> {reco.brief.assessment_draft}</p>}
                {reco.brief.risk_flags.length > 0 && (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-1">{t("risk")} {reco.brief.risk_flags.join(" / ")}</p>
                )}
                {reco.brief.rationale_draft && <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">{t("transitionEvidenceDraft")}</span> {reco.brief.rationale_draft}</p>}
                {reco.brief.learning_capture_draft && <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">{t("lessonsSummaryDraft")}</span> {reco.brief.learning_capture_draft}</p>}
                <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{t("evidenceArtifactsOfThisProposal")} {reco.manifest.join(" · ")}</p>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => confirm(t("applyTheBriefDraftTo"), () => {
                    setForm((f) => ({
                      ...f,
                      decision: reco.brief.transition_suggestion ?? f.decision,
                      rationale: reco.brief.rationale_draft || f.rationale,
                      learning_capture: reco.brief.learning_capture_draft || f.learning_capture,
                    }));
                  }, { body: t("fillsTheDecisionFormWith"), confirmLabel: tc("reflect") })}
                >
                  {t("applyToDecisionForm")}
                </button>
              </>
            )}
          </section>
        )}

        {/* ── 전환 결정 장부 ─────────────────────────────────────────── */}
        <ReviewBuckets entityType="project" entityId={projectId} variant="expanded" gates={["transition"]} artifacts={stageArtifactTabs("S12")} />
        <section className="market-section sizing-step mt-3" aria-label={t("portfolioTransitionDecision")}>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge">⚖️</span> {t("portfolioTransitionDecisionHumanDecision")}
          </h3>
          <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
            {t("theRecordBelowIsA")} <strong>{tc("record")}</strong>{t("roleOnlyTheDeciderIs")}
            <RawKey parts={[
                      { label: "", raw: "decided_by", isFallback: false },
                      { label: "", raw: "recorded_by", isFallback: true },
                    ]} />
          </div>
          {(view?.decisions.history.length ?? 0) > 0 ? (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table" aria-label={t("transitionDecisionHistory")}>
              <caption className="sr-only">{t("transitionDecisionHistory2")}</caption>
              <thead>
                <tr><th scope="col">{tc("cycle")}</th><th scope="col">{tc("decision")}</th><th scope="col">{tc("evidence")}</th><th scope="col">{t("decisionDate")}</th><th scope="col">{tc("recordedBy")}</th></tr>
              </thead>
              <tbody>
                {view!.decisions.history.map((d) => (
                  <tr key={d.id}>
                    <td className="tabular-nums">{d.review_cycle}</td>
                    <td><span className={`status-chip ${d.decision === "kill_with_learning_captured" || d.decision === "reduce_or_divest" ? "status-red" : d.decision === "next_tranche_released" || d.decision === "graduate_to_core" ? "status-green" : "status-amber"}`}>
                      {tr(TRANSITION_DECISION_KEY[d.decision] ?? d.decision)}
                    </span>
                      {d.learning_capture && (
                        <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("learningRecovery")} {d.learning_capture}</span>
                      )}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">{d.rationale}</td>
                    <td className="text-[length:var(--fs-caption)] tabular-nums">{d.decided_at.slice(0, 10)}</td>
                    <td className="text-[length:var(--fs-caption)]">{d.recorded_by}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noTransitionDecisionsRecordedYet")}</p>
          )}

          {canAct && (
            <form className="sizing-new-form mt-2" aria-label={t("recordTransitionDecision")} onSubmit={(e) => { e.preventDefault(); recordDecision(); }}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("decisionVocabulary")}</span>
                  <select
                    value={form.decision}
                    onChange={(e) => setForm({ ...form, decision: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                  >
                    {Object.keys(TRANSITION_DECISION_KEY).map((k) => <option key={k} value={k}>{tr(TRANSITION_DECISION_KEY[k])}</option>)}
                  </select>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{tc("reviewCycle")}</span>
                  <input
                    value={form.review_cycle}
                    onChange={(e) => setForm({ ...form, review_cycle: e.target.value })}
                    className="sizing-new-input"
                    placeholder={t("emptyCurrentQuarter")}
                  />
                </label>
                <label className="text-[length:var(--fs-caption)] flex-1 min-w-[14rem]">
                  <span className="block mb-1">{tc("evidenceRequiredMark")}</span>
                  <input
                    value={form.rationale}
                    onChange={(e) => setForm({ ...form, rationale: e.target.value })}
                    className="sizing-new-input w-full"
                    placeholder={t("icEvidenceDecisionsWithoutEvidence")}
                  />
                </label>
              </div>
              {isKill && (
                <label className="text-[length:var(--fs-caption)] block mt-2">
                  <span className="block mb-1">{t("learningCaptureRequiredOnKill")}</span>
                  <input
                    value={form.learning_capture}
                    onChange={(e) => setForm({ ...form, learning_capture: e.target.value })}
                    className="sizing-new-input w-full"
                    placeholder={t("learningToRecoverIntoThe")}
                  />
                </label>
              )}
              {recordField && (
                <label className="text-[length:var(--fs-caption)] block mt-2">
                  <span className="block mb-1">
                    {recordField.label}
                    <RawKey parts={{ label: "", raw: recordField.key, isFallback: !RECORD_KEY[recordField.key] }} />
                  </span>
                  <input
                    value={form.record}
                    onChange={(e) => setForm({ ...form, record: e.target.value })}
                    className="sizing-new-input w-full"
                  />
                </label>
              )}
              <button type="submit" className="btn-ghost btn-sm mt-2" disabled={busy}>
                {busy ? tc("recording") : t("decisionRecordConfirmationNeeded")}
              </button>
            </form>
          )}
        </section>
        <PolicyMigrationPanel projectId={projectId} canAct={canAct} />
        {confirmDialog}
      </StageFrame>
</>
  );
}
