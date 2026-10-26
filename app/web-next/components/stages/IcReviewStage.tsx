"use client";

// S11 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/ic-review 페이지와
// /deals/[id]/s11 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.

import { TranslatorFn, resolveLabels } from "../../i18n/config.ts";
import { DD_DOMAIN_KEY, DECISION_LABEL_KEY, GATE_LABEL_KEY, RAG_DIMENSION_KEY } from "../../lib/label-keys.ts";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { StageTabs } from "../StageTabs.tsx";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { StageFrame } from "../StageFrame.tsx";
import { GateDecisionJump, GateDecisionPanel } from "../GateDecisionPanel.tsx";
import { useToast } from "../ui.tsx";
import { useConfirm } from "../crud.tsx";
import { modeBadgeText, type HistoryStepView } from "../../lib/establishment-mode-view.ts";
import { EstablishmentPanel } from "./EstablishmentPanel.tsx";
import { establishmentApplies, type EventView, type MemberView, type StepRowView } from "../../lib/establishment-view.ts";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { ExecutionBaselinePanel } from "./ExecutionBaselinePanel.tsx";
import { IcReviewStepsPanel } from "./IcReviewStepsPanel.tsx";
import { fmtNpvKrwM } from "../../lib/npv-format.ts";
import { useTranslations } from "next-intl";

// S11 투자심사·실행 — 투자심의 자료 열람 + 법인·그룹 투자심의위원회 진행 기록 + 설립 실행
// 5단계 진행 화면 (ADR-0100 §3). 경계 #2: 종합 등급은 'AI 추천'으로만 표시되고
// (승인 도장 없음), 진행 GO/HOLD/KILL 기록과 설립 단계 완료 기록은 사람의
// 행위다. 이 화면은 패키지를 읽어오는 GET만 자동화하고, 쓰기는 명시적 P4
// 확인(useConfirm)을 거친 analyst+ 행위다.

interface SimRow { scenario: string; percentile: string; npv_krw_m: number; irr: number | null; note: string | null }
// UI 표시용 라벨(식별자/enum 값은 그대로 유지)
const SCENARIO_UI = (tr: TranslatorFn): Record<string, string> => resolveLabels(tr, { base: "common.defaultLabel", upside: "stages.s11.stage.upside", downside: "stages.s11.stage.downside" });
const PCTL_UI = (tr: TranslatorFn): Record<string, string> => resolveLabels(tr, { p05: "stages.s11.stage.bottom", p50: "stages.s11.stage.median", p95: "stages.s11.stage.top" });
interface AdoptedCase { id: string; name: string; kind: string; scenario: string | null; archived_at?: string | null; simulations: SimRow[] }
interface IcPackage {
  project: { id: string; project_no: string };
  business_case: { adopted: AdoptedCase | null; adoption: { modelId: string; adoptedBy: string; adoptedAt: string } | null; note?: string };
  dd: {
    completion: { total: number; pending: number; unassessed: number; mandatoryUnmet: number };
    findings: Array<{ id: string; category: string; description: string; value_impact: number | null; evidence_ref: string | null }>;
    finding_count: number;
    review_status?: { in_scope: number; draft_ai: number };
  };
  rag: { status: "graded" | "not_graded"; grade: string | null; isProposal: true; rationale: string | null; assessed_at: string | null; missing_dimensions: string[]; confidence_cap: string | null; confidence_note: string | null };
  pmi_kickoff: { applies: boolean; sub_track: string | null; record: { id: string; recordedBy: string; recordedAt: string; owner: string; planNote: string } | null };
  gates: {
    latest: Array<{ gate: string; decision: "go" | "hold" | "kill" | null; rationale: string | null; missing_artifacts: string[] | null; gap_override?: { items: string[]; rationale: string } | null }>;
    history: Array<{ id: string; gate: string; decision: string; rationale: string; decided_by: string; decided_at: string; gap_override?: { items: string[]; rationale: string } | null }>;
    /** Artifacts an IC GO would be missing right now (empty = none). */
    go_gaps?: string[];
  };
  /** ADR-0167 — standing risk lines for the establishment mode (informational). */
  standing_risks?: Array<{ key: string; text: string }>;
  establishment: {
    steps: Array<{ id: string; step_no: number; status: string; origin: string; owner: string; updated_at: string; note: string | null; evidence_url: string | null; keyed_by: string }>;
    done: number; total: number; complete: boolean; progress: string;
    /** ADR-0167 — active mode; null = a Green Field project that has not chosen one. */
    mode?: string | null;
    reopened_after_gate?: boolean;
    reopened_after_gate_detail?: { steps: number[]; count: number; since: string } | null;
  };
}

interface EstablishmentView {
  project: { id: string; project_no: string; origin: string | null };
  steps: StepRowView[];
  members: MemberView[];
  history: EventView[];
  complete: boolean;
  progress: string;
  mode?: string | null;
  step_titles?: Record<string, string> | null;
  all_step_titles?: Record<string, Record<string, string>>;
  history_steps?: HistoryStepView[];
  reopened_after_gate?: boolean;
  reopened_after_gate_detail?: { steps: number[]; count: number; since: string } | null;
}

const RAG_META = (tr: TranslatorFn): Record<string, { icon: string; cls: string }> => ({
  green: { icon: "●", cls: "status-green" },
  amber: { icon: "◐", cls: "status-amber" },
  red: { icon: "✕", cls: "status-red" },
});

// 데이터 신뢰도 등급(green/amber/red)의 한글 라벨 — 원문 등급은 개발자 세부정보 성격으로 괄호에 병기한다.
const CAP_LABEL = (tr: TranslatorFn): Record<string, string> => resolveLabels(tr, { green: "common.high", amber: "common.medium", red: "common.low" });
const capLabel = (cap: string, tr: TranslatorFn) => CAP_LABEL(tr)[cap] ?? cap;
// 종합 등급 표시명 — 원문(green/amber/red)은 화면에 노출하지 않는다.
const RAG_LABEL = (tr: TranslatorFn): Record<string, string> => resolveLabels(tr, { green: "stages.s11.stage.greenGood", amber: "stages.s11.stage.yellowCaution", red: "stages.s11.stage.redRisk" });

export function IcReviewStage({ projectId }: { projectId: string }) {const tr = useTranslations(); const t = useTranslations("stages.s11.stage"); const tc = useTranslations("common");
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const { confirm, confirmDialog } = useConfirm();
  const [pkg, setPkg] = useState<IcPackage | null>(null);
  const [est, setEst] = useState<EstablishmentView | null>(null);
  const { toast } = useToast();
  const [pmiForm, setPmiForm] = useState<{ owner: string; plan_note: string }>({ owner: "", plan_note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback((): Promise<unknown> => {
    const pkgP = api.get<IcPackage>(`/api/projects/${encodeURIComponent(projectId)}/ic-package`)
      .then((r) => setPkg(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheIc")));
    const estP = api.get<EstablishmentView>(`/api/projects/${encodeURIComponent(projectId)}/establishment`)
      .then((r) => setEst(r.data))
      .catch(() => { /* the IC package already carries establishment progress */ });
    return Promise.all([pkgP, estP]);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function recordKickoff() {
    confirm(t("recordPmiKickoff"), () => {
      void (async () => {
        setBusy(true); setError(null);
        try {
          await api.post(`/api/projects/${encodeURIComponent(projectId)}/pmi/kickoff`, pmiForm);
          setNotice(t("pmiKickoffRecorded"));
          toast(t("pmiKickoffRecorded2"));
          setPmiForm({ owner: "", plan_note: "" });
          load();
        } catch (e) {
          setError(e instanceof Error ? e.message : t("failedToRecordPmiKickoff"));
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: t("recordsTheIntegrationLeadAnd"),
      confirmLabel: tc("record"),
      tone: "neutral",
    });
  }

  // 2026-10-21 decider: S11 화면을 업무 절차 순서의 내부 탭으로 구분한다.
  // 2차 지시로 실행 기준선(트랜치·인허가/인증·인력/조직·가동 KPI·인센티브 의무)을
  // 설립 실행에서 떼어 별도 탭으로 분리한다.
  type IcView = "dossier" | "steps" | "establishment" | "baseline" | "decision";
  const IC_VIEWS: Array<{ key: IcView; label: string }> = [
    { key: "dossier", label: t("icMaterials") },
    { key: "steps", label: t("investmentReviewProcedureSteps") },
    { key: "establishment", label: t("executionPmi") },
    { key: "baseline", label: t("executionBaseline") },
    { key: "decision", label: t("andApprovalRecord") },
  ];
  const [icView, setIcView] = useState<IcView>("dossier");
  const entityGo = pkg?.gates.latest.find((x) => x.gate === "entity_ic")?.decision === "go";
  const bothGatesGo = ["entity_ic", "group_ic"].every((g) =>
    pkg?.gates.latest.find((x) => x.gate === g)?.decision === "go",
  );
  const estComplete = pkg?.establishment.complete ?? false;
  const origin = est?.project.origin;
  const estApplies = establishmentApplies(origin);
  const estMode = est ? est.mode : pkg?.establishment.mode;

  return (
<>
      {/* 리뷰 2026-10-22 (사용자 리포트): StageTabs는 레일 슬롯으로 — 머리 위치 일관성. */}
      <StageFrame
        stageId="S11"
        heading={t("s11InvestmentReviewAndExecution")}
        railSlot={<StageTabs projectId={projectId} />}
      >
        {/* 게이트 결정은 "의사결정 · 승인 기록" 내부 탭에 있다 — 점프 전에 탭을
            열어 포커스 대상이 실제로 보이게 한다(F6, BusinessCaseStage와 동일 패턴). */}
        <GateDecisionJump inline gate={entityGo ? "group_ic" : "entity_ic"} beforeJump={() => setIcView("decision")} />
        {/* One review block for both IC gates (the panels below do not repeat it). */}
        <ReviewBuckets entityType="project" entityId={projectId} gates={["entity_ic", "group_ic"]} artifacts={stageArtifactTabs("S11")} />
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          {t("entityAndGroupInvestmentCommittee")}
          <Link href={`/projects/${projectId}/charter`} className="ml-2 underline">{t("viewTheProjectCharter")}</Link>
          <span className={`status-chip ${bothGatesGo ? "status-green" : "status-amber"} ml-2`}>
            {bothGatesGo ? t("investmentCommittee22In") : t("notApprovedByTheInvestment")}
          </span>
          {estApplies && (
            <span className={`status-chip ${estComplete ? "status-green" : "status-amber"} ml-1`}>
              {estComplete ? t("establishmentExecutionCompleteP1", { p1: pkg?.establishment.progress ?? "—" }) : t("establishmentExecutionP1", { p1: pkg?.establishment.progress ?? "—" })}
            </span>
          )}
          {estApplies && (
            <span className={`status-chip ${estMode ? "status-not-started" : "status-amber"} ml-1`}>
              {estMode ? "" : "○ "}{modeBadgeText(estMode)}
            </span>
          )}
        </p>
        {/* 내부 탭 — 업무 절차 순서: 자료 → 절차 단계 → 설립·실행 → 의사결정 (2026-10-21 decider) */}
        <div role="tablist" aria-label={t("investmentReviewScreen")} className="flex flex-wrap gap-1 mb-3">
          {IC_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              id={`ic-tab-${v.key}`}
              aria-controls={v.key === "establishment" ? "ic-panel-establishment ic-panel-pmi" : `ic-panel-${v.key}`}
              aria-selected={icView === v.key}
              className={`stage-tab${icView === v.key ? " stage-tab-active" : ""}`}
              onClick={() => setIcView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}

        {/* ── 투자심의 자료 요약 ─────────────────────────────────────────── */}
        <section id="ic-panel-dossier" role="tabpanel" aria-labelledby="ic-tab-dossier" className="market-section sizing-step" hidden={icView !== "dossier"}>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge" aria-hidden="true">📦</span> {t("icMaterialsBusinessCaseDd")}
          </h3>

          <h4 className="text-[length:var(--fs-body)] mt-2 mb-1">{t("adoptedBusinessCaseS8")}</h4>
          {pkg?.business_case.adopted ? (
            <>
              <p className="text-[length:var(--fs-caption)]">
                {pkg.business_case.adopted.name}
                <span className="status-chip status-green ml-2">{t("adopted")}</span>
                {pkg.business_case.adopted.archived_at && (
                  <span className="status-chip status-not-started ml-1" title={t("archivedP1", { p1: pkg.business_case.adopted.archived_at.slice(0, 10) })}>{t("archived")}</span>
                )}
                {pkg.business_case.adopted.scenario && (
                  <span className="status-chip status-not-started ml-1">{t("scenario")} {pkg.business_case.adopted.scenario}</span>
                )}
                {pkg.business_case.adoption && (
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    {t("adoptedBy")} {pkg.business_case.adoption.adoptedBy} · {pkg.business_case.adoption.adoptedAt.slice(0, 10)}
                  </span>
                )}
              </p>
              <table className="data-table" aria-label={t("valuationSimulation")}>
                <caption className="sr-only">{t("simulationNpvQuantilesOfThe")}</caption>
                <thead>
                  <tr><th scope="col">{t("scenario2")}</th><th scope="col">{t("quantile")}</th><th scope="col">{t("npvMillionsOfKrw")}</th><th scope="col">IRR</th></tr>
                </thead>
                <tbody>
                  {pkg.business_case.adopted.simulations.map((s, i) => (
                    <tr key={`${s.scenario}-${s.percentile}-${i}`}>
                      <td>{SCENARIO_UI(tr)[s.scenario] ?? s.scenario}</td>
                      <td className="tabular-nums">{PCTL_UI(tr)[s.percentile] ?? s.percentile}</td>
                      <td className="mono-num">{fmtNpvKrwM(s.npv_krw_m)}</td>
                      <td className="mono-num">{s.irr != null ? (s.irr * 100).toFixed(1) + "%" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {pkg?.business_case.note ?? t("noBusinessCaseAdoptedGenerate")}
            </p>
          )}

          {(pkg?.standing_risks?.length ?? 0) > 0 && (
            <>
              <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">{t("standingRisk")}</h4>
              <ul className="sizing-note-list" aria-label={t("standingRisk2")}>
                {pkg!.standing_risks!.map((r) => (
                  <li key={r.key}>
                    <span className="status-chip status-amber"><span aria-hidden="true">◐</span> {t("caution")}</span> {r.text}
                  </li>
                ))}
              </ul>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("informationalOnlyItDoesNot")}</p>
            </>
          )}
          <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">{t("ddSummaryS9")}</h4>
          <p className="text-[length:var(--fs-caption)]">
            <span className={`status-chip ${pkg && pkg.dd.completion.total > 0 && pkg.dd.completion.pending === 0 && pkg.dd.completion.unassessed === 0 && pkg.dd.completion.mandatoryUnmet === 0 ? "status-green" : "status-amber"}`}>
              {pkg && pkg.dd.completion.total > 0
                ? t("p1JudgementSPendingP2", { p1: pkg.dd.completion.total, p2: pkg.dd.completion.pending, p3: pkg.dd.completion.unassessed, p4: pkg.dd.completion.mandatoryUnmet })
                : t("noJudgementRecord")}
            </span>
          </p>
          {pkg?.dd.review_status && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={t("aiDraftedStatuteOriginalsPartially")}>
              {t("unconfirmedAreasChecklistItems")} {pkg.dd.review_status.in_scope}{t("of")} {pkg.dd.review_status.draft_ai}{t("itemSAreStillAnd")}
            </p>
          )}
          {(pkg?.dd.findings.length ?? 0) > 0 && (
            <ul className="sizing-note-list mt-1">
              {pkg!.dd.findings.map((f) => (
                <li key={f.id}>
                  <strong>{tr(DD_DOMAIN_KEY[f.category] ?? f.category)}</strong>: {f.description}
                  {f.value_impact != null && <span className="ml-1 tabular-nums">{t("valueImpact")} {f.value_impact})</span>}
                </li>
              ))}
            </ul>
          )}

          <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">{t("overallGrade")}</h4>
          {pkg?.rag.grade ? (
            <p className="text-[length:var(--fs-caption)]">
              <span className={`status-chip ${RAG_META(tr)[pkg.rag.grade]?.cls ?? "status-not-started"}`}>
                {RAG_META(tr)[pkg.rag.grade]?.icon ?? "?"} {RAG_LABEL(tr)[pkg.rag.grade] ?? pkg.rag.grade}
              </span>
              <span className="status-chip status-amber ml-2" title={t("thisGradeIsAValue")}>
                {t("aiRecommendationNotAnApproval")}
              </span>
              {pkg.rag.confidence_cap && (
                <span className="status-chip status-not-started ml-1" title={pkg.rag.confidence_note ?? ""}>
                  {t("confidenceCap")} {capLabel(pkg.rag.confidence_cap, tr)}
                </span>
              )}
              {pkg.rag.rationale && (
                <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{tc("evidenceColon")} {pkg.rag.rationale}</span>
              )}
            </p>
          ) : (
            // Incomplete assessment: NO overall grade and NO color — "not graded"
            // is a distinct outcome, never a default Amber.
            <p className="text-[length:var(--fs-caption)]">
              <span className="status-chip status-not-started">{t("notAssessed")}</span>
              <span className="status-chip status-amber ml-2" title={t("thisEvaluationIsAValue")}>
                {t("aiRecommendationNotAnApproval2")}
              </span>
              {pkg?.rag.confidence_cap && (
                <span className="status-chip status-not-started ml-1" title={pkg.rag.confidence_note ?? ""}>
                  {t("confidenceCap2")} {capLabel(pkg.rag.confidence_cap, tr)}
                </span>
              )}
              <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                {pkg?.rag.missing_dimensions?.length
                  ? t("anOverallGradeCannotBe", { p1: [...new Set(pkg.rag.missing_dimensions)].map((k) => tr(RAG_DIMENSION_KEY[k] ?? k)).join(", ") })
                  : t("noOverallGradeEvaluationRecord")}
              </span>
            </p>
          )}
          {(() => {
            const overrides = (pkg?.gates.history ?? []).filter((h) => h.gap_override);
            if (overrides.length === 0) return null;
            return (
              <>
                <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">{t("exceptionEvidenceWrittenWhenRecording")}</h4>
                <ul className="sizing-note-list" aria-label={t("exceptionEvidence")}>
                  {overrides.map((h) => (
                    <li key={h.id}>
                      <strong>{tr(GATE_LABEL_KEY[h.gate] ?? h.gate)} {tr(DECISION_LABEL_KEY[h.decision] ?? h.decision)}</strong> - {h.decided_by} · {h.decided_at.slice(0, 10)}
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("missing")} {h.gap_override!.items.join("; ")}</span>
                      <span className="block text-[length:var(--fs-caption)]">{tc("evidenceColon")} {h.gap_override!.rationale}</span>
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}
        </section>

        {/* ── 투자심사 절차 단계 (entity-ic-review · group-investment-review) ── */}
        <div id="ic-panel-steps" role="tabpanel" aria-labelledby="ic-tab-steps" hidden={icView !== "steps"}>
          <IcReviewStepsPanel projectId={projectId} canAct={canAct} />
        </div>

        {/* ── 설립 실행 5단계 (ADR-0165) — 승인 후 실행 활동 ── */}
        <div id="ic-panel-establishment" role="tabpanel" aria-labelledby="ic-tab-establishment" hidden={icView !== "establishment"}>
          <EstablishmentPanel
            projectId={projectId}
            canAct={canAct}
            est={est}
            fallbackSteps={pkg?.establishment.steps ?? []}
            fallbackReopen={pkg?.establishment}
            onChanged={load}
          />
        </div>

        {/* ── 신규 사업 실행 기준선 (ADR-0161 Row 3) — 별도 탭 (2026-10-21 decider 2차) ── */}
        <div id="ic-panel-baseline" role="tabpanel" aria-labelledby="ic-tab-baseline" hidden={icView !== "baseline"}>
          <ExecutionBaselinePanel projectId={projectId} canAct={canAct} />
        </div>

        {/* ── PMI 킥오프 (brownfield M&A·JV·전략적 투자) — 실행 · PMI 탭 패널 안에 렌더링 ─────────────── */}
        {pkg?.pmi_kickoff.applies && (
          // 품평회 2026-10-22 잔여 #2: PMI 섹션이 establishment 탭패널의 형제 div였으면
          // 탭의 aria-controls 매핑이 불완전했다 — 자체 패널 id를 부여하고 탭 쪽에서
          // 두 패널을 함께 가리킨다.
          <div id="ic-panel-pmi" role="tabpanel" aria-labelledby="ic-tab-establishment" hidden={icView !== "establishment"}>
          <section className="market-section sizing-step mt-3" aria-label={t("pmiKickoff")}>
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">
              <span className="sizing-step-badge" aria-hidden="true">🤝</span> {t("pmiKickoffBrownfieldIntegrationPlan")}
            </h3>
            {pkg.pmi_kickoff.record ? (
              <p className="text-[length:var(--fs-caption)]">
                <span className="status-chip status-green">{t("kickoffRecorded")}</span>
                <span className="block text-[length:var(--fs-caption)] mt-1">{t("integrationLead")} {pkg.pmi_kickoff.record.owner} {t("recorder")} {pkg.pmi_kickoff.record.recordedBy} · {pkg.pmi_kickoff.record.recordedAt.slice(0, 10)}</span>
                <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{pkg.pmi_kickoff.record.planNote}</span>
              </p>
            ) : (
              <p className="text-[length:var(--fs-caption)]">
                <span className="status-chip status-amber">{t("kickoffNotRecorded")}</span>
                <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{t("s11CompletionRequiresAPmi")}</span>
              </p>
            )}
            {canAct && !pkg.pmi_kickoff.record && (
              <form className="sizing-new-form mt-2" aria-label={t("recordPmiKickoff2")} onSubmit={(e) => { e.preventDefault(); recordKickoff(); }}>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[length:var(--fs-caption)] min-w-[10rem]">
                    <span className="block mb-1">{t("integrationLeadRequired")}</span>
                    <input
                      value={pmiForm.owner}
                      onChange={(e) => setPmiForm({ ...pmiForm, owner: e.target.value })}
                      className="sizing-new-input w-full"
                      required
                    />
                  </label>
                  <label className="text-[length:var(--fs-caption)] flex-1 min-w-[16rem]">
                    <span className="block mb-1">{t("integrationPlanBaselineRequired20")}</span>
                    <input
                      value={pmiForm.plan_note}
                      onChange={(e) => setPmiForm({ ...pmiForm, plan_note: e.target.value })}
                      className="sizing-new-input w-full"
                      required
                      minLength={20}
                    />
                  </label>
                </div>
                <button type="submit" className="btn-ghost btn-sm mt-2" disabled={busy}>
                  {busy ? tc("recording") : t("recordKickoffConfirmationNeeded")}
                </button>
              </form>
            )}
          </section>
          </div>
        )}

        {/* ── 의사결정: 법인 → 그룹 투자심의위원회 한 구역 (검토 블록은 상단에 한 번만) ── */}
        <div id="ic-panel-decision" role="tabpanel" aria-labelledby="ic-tab-decision" className="mt-4" hidden={icView !== "decision"}>
          <GateDecisionPanel
            opportunityId={projectId}
            gates={["entity_ic", "group_ic"]}
            sequence
            entityType="project"
            killHint={null}
            showReview={false}
            goGaps={pkg?.gates.go_gaps}
            nextStage={{ label: t("s12Management"), href: `/projects/${projectId}/portfolio` }}
          />
        </div>
        {confirmDialog}
      </StageFrame>
</>
  );
}
