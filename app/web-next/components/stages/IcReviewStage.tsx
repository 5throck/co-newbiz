"use client";

// S11 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/ic-review 페이지와
// /deals/[id]/s11 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.

import { DECISION_LABEL, FINDING_CATEGORY_LABEL, GATE_LABEL, ragDimensionsLabel } from "../../lib/labels.ts";
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

// S11 투자심사·실행 — 투자심의 자료 열람 + 법인·그룹 투자심의위원회 진행 기록 + 설립 실행
// 5단계 진행 화면 (ADR-0100 §3). 경계 #2: 종합 등급은 'AI 추천'으로만 표시되고
// (승인 도장 없음), 진행 GO/HOLD/KILL 기록과 설립 단계 완료 기록은 사람의
// 행위다. 이 화면은 패키지를 읽어오는 GET만 자동화하고, 쓰기는 명시적 P4
// 확인(useConfirm)을 거친 analyst+ 행위다.

interface SimRow { scenario: string; percentile: string; npv_krw_m: number; irr: number | null; note: string | null }
// UI 표시용 라벨(식별자/enum 값은 그대로 유지)
const SCENARIO_UI: Record<string, string> = { base: "기본", upside: "상승", downside: "하락" };
const PCTL_UI: Record<string, string> = { p05: "하위 5%", p50: "중앙값", p95: "상위 5%" };
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

const RAG_META: Record<string, { icon: string; cls: string }> = {
  green: { icon: "●", cls: "status-green" },
  amber: { icon: "◐", cls: "status-amber" },
  red: { icon: "✕", cls: "status-red" },
};

// 데이터 신뢰도 등급(green/amber/red)의 한글 라벨 — 원문 등급은 개발자 세부정보 성격으로 괄호에 병기한다.
const CAP_LABEL: Record<string, string> = { green: "높음", amber: "중간", red: "낮음" };
const capLabel = (cap: string) => CAP_LABEL[cap] ?? cap;
// 종합 등급 표시명 — 원문(green/amber/red)은 화면에 노출하지 않는다.
const RAG_LABEL: Record<string, string> = { green: "녹색(양호)", amber: "황색(주의)", red: "적색(위험)" };

export function IcReviewStage({ projectId }: { projectId: string }) {
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
      .catch((e) => setError(e instanceof Error ? e.message : "투자심의 자료를 불러오지 못했습니다."));
    const estP = api.get<EstablishmentView>(`/api/projects/${encodeURIComponent(projectId)}/establishment`)
      .then((r) => setEst(r.data))
      .catch(() => { /* the IC package already carries establishment progress */ });
    return Promise.all([pkgP, estP]);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function recordKickoff() {
    confirm("PMI 킥오프 기록", () => {
      void (async () => {
        setBusy(true); setError(null);
        try {
          await api.post(`/api/projects/${encodeURIComponent(projectId)}/pmi/kickoff`, pmiForm);
          setNotice("PMI 킥오프가 기록되었습니다.");
          toast("PMI 킥오프를 기록했습니다.");
          setPmiForm({ owner: "", plan_note: "" });
          load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "PMI 킥오프 기록 실패");
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: "통합 책임자와 통합 계획 기준선을 기록합니다. 이 기록은 사람이 확인한 PMI 킥오프이며, 에이전트가 대신 기록할 수 없습니다.",
      confirmLabel: "기록",
      tone: "neutral",
    });
  }

  // 2026-10-21 decider: S11 화면을 업무 절차 순서의 내부 탭으로 구분한다.
  // 2차 지시로 실행 기준선(트랜치·인허가/인증·인력/조직·가동 KPI·인센티브 의무)을
  // 설립 실행에서 떼어 별도 탭으로 분리한다.
  type IcView = "dossier" | "steps" | "establishment" | "baseline" | "decision";
  const IC_VIEWS: Array<{ key: IcView; label: string }> = [
    { key: "dossier", label: "투자심의 자료" },
    { key: "steps", label: "투자심사 절차 단계" },
    { key: "establishment", label: "실행 · PMI" },
    { key: "baseline", label: "실행 기준선" },
    { key: "decision", label: "의사결정 · 승인 기록" },
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
        heading="S11 투자심사·실행 — 투자심의 자료 · 법인·그룹 투자심의위원회 · 설립 실행"
        railSlot={<StageTabs projectId={projectId} />}
      >
        {/* 게이트 결정은 "의사결정 · 승인 기록" 내부 탭에 있다 — 점프 전에 탭을
            열어 포커스 대상이 실제로 보이게 한다(F6, BusinessCaseStage와 동일 패턴). */}
        <GateDecisionJump gate={entityGo ? "group_ic" : "entity_ic"} beforeJump={() => setIcView("decision")} />
        {/* One review block for both IC gates (the panels below do not repeat it). */}
        <ReviewBuckets entityType="project" entityId={projectId} gates={["entity_ic", "group_ic"]} artifacts={stageArtifactTabs("S11")} />
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          법인 투자심의위원회와 그룹 투자심의위원회 승인이 모두 기록되고, 내부 추진·합작 프로젝트는 S10에서 확정한 설립 방식
          (신규 법인 설립 또는 신규 사업부 추진)의 5단계 완료 기록이 존재해야 S11이 완료됩니다.
          <Link href={`/projects/${projectId}/charter`} className="ml-2 underline">프로젝트 추진계획(차터) 보기 →</Link>
          <span className={`status-chip ${bothGatesGo ? "status-green" : "status-amber"} ml-2`}>
            {bothGatesGo ? "● 투자심의위원회 2/2 진행" : "○ 투자심의위원회 미승인"}
          </span>
          {estApplies && (
            <span className={`status-chip ${estComplete ? "status-green" : "status-amber"} ml-1`}>
              {estComplete ? `● 설립 실행 완료 (${pkg?.establishment.progress ?? "—"})` : `◐ 설립 실행 ${pkg?.establishment.progress ?? "—"}`}
            </span>
          )}
          {estApplies && (
            <span className={`status-chip ${estMode ? "status-not-started" : "status-amber"} ml-1`}>
              {estMode ? "" : "○ "}{modeBadgeText(estMode)}
            </span>
          )}
        </p>
        {/* 내부 탭 — 업무 절차 순서: 자료 → 절차 단계 → 설립·실행 → 의사결정 (2026-10-21 decider) */}
        <div role="tablist" aria-label="투자심사 화면" className="flex flex-wrap gap-1 mb-3">
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
            <span className="sizing-step-badge" aria-hidden="true">📦</span> 투자심의 자료 — 사업성 · 실사 · 종합 등급 제안
          </h3>

          <h4 className="text-[length:var(--fs-body)] mt-2 mb-1">채택 사업성 케이스 (S8)</h4>
          {pkg?.business_case.adopted ? (
            <>
              <p className="text-[length:var(--fs-caption)]">
                {pkg.business_case.adopted.name}
                <span className="status-chip status-green ml-2">✓ 채택됨</span>
                {pkg.business_case.adopted.archived_at && (
                  <span className="status-chip status-not-started ml-1" title={`보관일 ${pkg.business_case.adopted.archived_at.slice(0, 10)}`}>보관됨</span>
                )}
                {pkg.business_case.adopted.scenario && (
                  <span className="status-chip status-not-started ml-1">시나리오: {pkg.business_case.adopted.scenario}</span>
                )}
                {pkg.business_case.adoption && (
                  <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    채택자 {pkg.business_case.adoption.adoptedBy} · {pkg.business_case.adoption.adoptedAt.slice(0, 10)}
                  </span>
                )}
              </p>
              <table className="data-table" aria-label="밸류에이션 시뮬레이션">
                <caption className="sr-only">채택 케이스의 시뮬레이션 NPV 분위수</caption>
                <thead>
                  <tr><th scope="col">시나리오</th><th scope="col">분위수</th><th scope="col">NPV (백만 KRW)</th><th scope="col">IRR</th></tr>
                </thead>
                <tbody>
                  {pkg.business_case.adopted.simulations.map((s, i) => (
                    <tr key={`${s.scenario}-${s.percentile}-${i}`}>
                      <td>{SCENARIO_UI[s.scenario] ?? s.scenario}</td>
                      <td className="tabular-nums">{PCTL_UI[s.percentile] ?? s.percentile}</td>
                      <td className="mono-num">{fmtNpvKrwM(s.npv_krw_m)}</td>
                      <td className="mono-num">{s.irr != null ? (s.irr * 100).toFixed(1) + "%" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {pkg?.business_case.note ?? "채택된 Business Case가 없습니다 — 사업성 분석 탭에서 케이스를 생성·채택하세요."}
            </p>
          )}

          {(pkg?.standing_risks?.length ?? 0) > 0 && (
            <>
              <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">상시 위험</h4>
              <ul className="sizing-note-list" aria-label="상시 위험">
                {pkg!.standing_risks!.map((r) => (
                  <li key={r.key}>
                    <span className="status-chip status-amber"><span aria-hidden="true">◐</span> 주의</span> {r.text}
                  </li>
                ))}
              </ul>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">참고 표시이며 게이트를 막지 않고 종합 등급을 자동으로 바꾸지 않습니다.</p>
            </>
          )}
          <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">DD 요약 (S9)</h4>
          <p className="text-[length:var(--fs-caption)]">
            <span className={`status-chip ${pkg && pkg.dd.completion.total > 0 && pkg.dd.completion.pending === 0 && pkg.dd.completion.unassessed === 0 && pkg.dd.completion.mandatoryUnmet === 0 ? "status-green" : "status-amber"}`}>
              {pkg && pkg.dd.completion.total > 0
                ? `판정 ${pkg.dd.completion.total}건 · 대기 ${pkg.dd.completion.pending}건 · 미판정 ${pkg.dd.completion.unassessed}건 · 필수 미충족 ${pkg.dd.completion.mandatoryUnmet}건`
                : "판정 기록 없음"}
            </span>
          </p>
          {pkg?.dd.review_status && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title="AI 작성 · 법령 원문 일부 확인 · 변호사 검토 전 — 확정 아님">
              확인하지 못한 영역: 범위 안 체크리스트 항목 {pkg.dd.review_status.in_scope}건 중 {pkg.dd.review_status.draft_ai}건이 아직 AI 작성·검토 전입니다 (참고 표시이며 게이트를 막지 않습니다).
            </p>
          )}
          {(pkg?.dd.findings.length ?? 0) > 0 && (
            <ul className="sizing-note-list mt-1">
              {pkg!.dd.findings.map((f) => (
                <li key={f.id}>
                  <strong>{FINDING_CATEGORY_LABEL[f.category] ?? f.category}</strong>: {f.description}
                  {f.value_impact != null && <span className="ml-1 tabular-nums">(가치 영향 {f.value_impact})</span>}
                </li>
              ))}
            </ul>
          )}

          <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">종합 등급</h4>
          {pkg?.rag.grade ? (
            <p className="text-[length:var(--fs-caption)]">
              <span className={`status-chip ${RAG_META[pkg.rag.grade]?.cls ?? "status-not-started"}`}>
                {RAG_META[pkg.rag.grade]?.icon ?? "?"} {RAG_LABEL[pkg.rag.grade] ?? pkg.rag.grade}
              </span>
              <span className="status-chip status-amber ml-2" title="이 등급은 AI 분석이 제안한 값이며, IC 승인 기록이 아닙니다">
                ⚠ AI 추천 (승인 아님)
              </span>
              {pkg.rag.confidence_cap && (
                <span className="status-chip status-not-started ml-1" title={pkg.rag.confidence_note ?? ""}>
                  신뢰도 상한 {capLabel(pkg.rag.confidence_cap)}
                </span>
              )}
              {pkg.rag.rationale && (
                <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">근거: {pkg.rag.rationale}</span>
              )}
            </p>
          ) : (
            // Incomplete assessment: NO overall grade and NO color — "not graded"
            // is a distinct outcome, never a default Amber.
            <p className="text-[length:var(--fs-caption)]">
              <span className="status-chip status-not-started">○ 미산정</span>
              <span className="status-chip status-amber ml-2" title="이 평가는 AI 분석이 제안한 값이며, IC 승인 기록이 아닙니다">
                ⚠ AI 추천 (승인 아님)
              </span>
              {pkg?.rag.confidence_cap && (
                <span className="status-chip status-not-started ml-1" title={pkg.rag.confidence_note ?? ""}>
                  신뢰도 상한 {capLabel(pkg.rag.confidence_cap)}
                </span>
              )}
              <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                {pkg?.rag.missing_dimensions?.length
                  ? `종합 등급을 낼 수 없습니다 — 미평가 차원: ${ragDimensionsLabel(pkg.rag.missing_dimensions)}. 여섯 차원이 모두 평가되어야 종합 등급이 산정됩니다 (빨강 신호는 예외로 즉시 표시).`
                  : "종합 등급 평가 기록이 없습니다 — 입력이 채워지면 자동 제안됩니다."}
              </span>
            </p>
          )}
          {(() => {
            const overrides = (pkg?.gates.history ?? []).filter((h) => h.gap_override);
            if (overrides.length === 0) return null;
            return (
              <>
                <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">누락 산출물 예외 근거 (진행 기록 시 작성)</h4>
                <ul className="sizing-note-list" aria-label="누락 산출물 예외 근거">
                  {overrides.map((h) => (
                    <li key={h.id}>
                      <strong>{GATE_LABEL[h.gate] ?? h.gate} {DECISION_LABEL[h.decision] ?? h.decision}</strong> - {h.decided_by} · {h.decided_at.slice(0, 10)}
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">누락: {h.gap_override!.items.join("; ")}</span>
                      <span className="block text-[length:var(--fs-caption)]">근거: {h.gap_override!.rationale}</span>
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
          <section className="market-section sizing-step mt-3" aria-label="PMI 킥오프">
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">
              <span className="sizing-step-badge" aria-hidden="true">🤝</span> PMI 킥오프 — Brownfield 통합 계획 기준선
            </h3>
            {pkg.pmi_kickoff.record ? (
              <p className="text-[length:var(--fs-caption)]">
                <span className="status-chip status-green">● 킥오프 기록됨</span>
                <span className="block text-[length:var(--fs-caption)] mt-1">통합 책임자 {pkg.pmi_kickoff.record.owner} · 기록자 {pkg.pmi_kickoff.record.recordedBy} · {pkg.pmi_kickoff.record.recordedAt.slice(0, 10)}</span>
                <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">{pkg.pmi_kickoff.record.planNote}</span>
              </p>
            ) : (
              <p className="text-[length:var(--fs-caption)]">
                <span className="status-chip status-amber">○ 킥오프 미기록</span>
                <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">S11 완료에는 사람이 기록한 PMI 킥오프(통합 책임자·계획 기준선)가 필요합니다.</span>
              </p>
            )}
            {canAct && !pkg.pmi_kickoff.record && (
              <form className="sizing-new-form mt-2" aria-label="PMI 킥오프 기록" onSubmit={(e) => { e.preventDefault(); recordKickoff(); }}>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[length:var(--fs-caption)] min-w-[10rem]">
                    <span className="block mb-1">통합 책임자 (필수)</span>
                    <input
                      value={pmiForm.owner}
                      onChange={(e) => setPmiForm({ ...pmiForm, owner: e.target.value })}
                      className="sizing-new-input w-full"
                      required
                    />
                  </label>
                  <label className="text-[length:var(--fs-caption)] flex-1 min-w-[16rem]">
                    <span className="block mb-1">통합 계획 기준선 (필수, 20자 이상)</span>
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
                  {busy ? "기록 중..." : "킥오프 기록 (확인 필요)"}
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
            nextStage={{ label: "S12 사후 관리", href: `/projects/${projectId}/portfolio` }}
          />
        </div>
        {confirmDialog}
      </StageFrame>
</>
  );
}
