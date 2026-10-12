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
import { EstablishmentPanel } from "./EstablishmentPanel.tsx";
import { establishmentApplies, type EventView, type MemberView, type StepRowView } from "../../lib/establishment-view.ts";
import { canWriteProject } from "../../lib/project-write-access.ts";
import { ExecutionBaselinePanel } from "./ExecutionBaselinePanel.tsx";

// S11 투자심사·실행 — 투자심의 자료 열람 + 법인·그룹 투자심의위원회 진행 기록 + 설립 실행
// 5단계 진행 화면 (ADR-0100 §3). 경계 #2: RAG 등급은 'AI 추천'으로만 표시되고
// (승인 도장 없음), 진행 GO/HOLD/KILL 기록과 설립 단계 완료 기록은 사람의
// 행위다. 이 화면은 패키지를 읽어오는 GET만 자동화하고, 쓰기는 명시적 P4
// 확인(useConfirm)을 거친 analyst+ 행위다.

interface SimRow { scenario: string; percentile: string; npv_krw_m: number; irr: number | null; note: string | null }
interface AdoptedCase { id: string; name: string; kind: string; scenario: string | null; archived_at?: string | null; simulations: SimRow[] }
interface IcPackage {
  project: { id: string; project_no: string };
  business_case: { adopted: AdoptedCase | null; adoption: { modelId: string; adoptedBy: string; adoptedAt: string } | null; note?: string };
  dd: {
    completion: { total: number; pending: number; unassessed: number; mandatoryUnmet: number };
    findings: Array<{ id: string; category: string; description: string; value_impact: number | null; evidence_ref: string | null }>;
    finding_count: number;
  };
  rag: { status: "graded" | "not_graded"; grade: string | null; isProposal: true; rationale: string | null; assessed_at: string | null; missing_dimensions: string[]; confidence_cap: string | null; confidence_note: string | null };
  pmi_kickoff: { applies: boolean; sub_track: string | null; record: { id: string; recordedBy: string; recordedAt: string; owner: string; planNote: string } | null };
  gates: {
    latest: Array<{ gate: string; decision: "go" | "hold" | "kill" | null; rationale: string | null; missing_artifacts: string[] | null; gap_override?: { items: string[]; rationale: string } | null }>;
    history: Array<{ id: string; gate: string; decision: string; rationale: string; decided_by: string; decided_at: string; gap_override?: { items: string[]; rationale: string } | null }>;
    /** Artifacts an IC GO would be missing right now (empty = none). */
    go_gaps?: string[];
  };
  establishment: {
    steps: Array<{ id: string; step_no: number; status: string; origin: string; owner: string; updated_at: string; note: string | null; evidence_url: string | null; keyed_by: string }>;
    done: number; total: number; complete: boolean; progress: string;
  };
}

interface EstablishmentView {
  project: { id: string; project_no: string; origin: string | null };
  steps: StepRowView[];
  members: MemberView[];
  history: EventView[];
  complete: boolean;
  progress: string;
}

const RAG_META: Record<string, { icon: string; cls: string }> = {
  green: { icon: "●", cls: "status-green" },
  amber: { icon: "◐", cls: "status-amber" },
  red: { icon: "✕", cls: "status-red" },
};

// 데이터 신뢰도 등급(green/amber/red)의 한글 라벨 — 원문 등급은 개발자 세부정보 성격으로 괄호에 병기한다.
const CAP_LABEL: Record<string, string> = { green: "높음", amber: "중간", red: "낮음" };
const capLabel = (cap: string) => (CAP_LABEL[cap] ? `${CAP_LABEL[cap]} (${cap})` : cap);

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

  const entityGo = pkg?.gates.latest.find((x) => x.gate === "entity_ic")?.decision === "go";
  const bothGatesGo = ["entity_ic", "group_ic"].every((g) =>
    pkg?.gates.latest.find((x) => x.gate === g)?.decision === "go",
  );
  const estComplete = pkg?.establishment.complete ?? false;
  const origin = est?.project.origin;
  const estApplies = establishmentApplies(origin);

  return (
<>
      <StageTabs projectId={projectId} />
      <GateDecisionJump gate={entityGo ? "group_ic" : "entity_ic"} />
      {/* One review block for both IC gates (the panels below do not repeat it). */}
      <ReviewBuckets entityType="project" entityId={projectId} gates={["entity_ic", "group_ic"]} artifacts={stageArtifactTabs("S11")} />
      <StageFrame stageId="S11" heading="S11 투자심사·실행 — 투자심의 자료 · 법인·그룹 투자심의위원회 · 설립 실행">
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          법인 투자심의위원회와 그룹 투자심의위원회 승인이 모두 기록되고, 내부 추진·합작 프로젝트는 설립 5단계 완료 기록이
          존재해야 S11이 완료됩니다.
          <Link href={`/projects/${projectId}/charter`} className="ml-2 underline">프로젝트 추진계획(차터) 보기 →</Link>
          <span className={`status-chip ${bothGatesGo ? "status-green" : "status-amber"} ml-2`}>
            {bothGatesGo ? "● 투자심의위원회 2/2 GO" : "○ 투자심의위원회 미승인"}
          </span>
          {estApplies && (
            <span className={`status-chip ${estComplete ? "status-green" : "status-amber"} ml-1`}>
              {estComplete ? `● 설립 실행 완료 (${pkg?.establishment.progress ?? "—"})` : `◐ 설립 실행 ${pkg?.establishment.progress ?? "—"} (내부 추진·합작 적용)`}
            </span>
          )}
        </p>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}

        {/* ── 투자심의 자료 요약 ─────────────────────────────────────────── */}
        <section className="market-section sizing-step" aria-label="투자심의 자료 요약">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">📦</span> 투자심의 자료 — Business Case · DD · RAG 제안
          </h3>

          <h4 className="text-[length:var(--fs-body)] mt-2 mb-1">채택 Business Case (S8)</h4>
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
                      <td>{s.scenario}</td>
                      <td className="tabular-nums">{s.percentile}</td>
                      <td className="mono-num">{s.npv_krw_m}</td>
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

          <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">DD 요약 (S9)</h4>
          <p className="text-[length:var(--fs-caption)]">
            <span className={`status-chip ${pkg && pkg.dd.completion.total > 0 && pkg.dd.completion.pending === 0 && pkg.dd.completion.unassessed === 0 && pkg.dd.completion.mandatoryUnmet === 0 ? "status-green" : "status-amber"}`}>
              {pkg && pkg.dd.completion.total > 0
                ? `판정 ${pkg.dd.completion.total}건 · 대기 ${pkg.dd.completion.pending}건 · 미판정 ${pkg.dd.completion.unassessed}건 · 필수 미충족 ${pkg.dd.completion.mandatoryUnmet}건`
                : "판정 기록 없음"}
            </span>
          </p>
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
                {RAG_META[pkg.rag.grade]?.icon ?? "?"} {pkg.rag.grade.toUpperCase()}
              </span>
              <span className="status-chip status-amber ml-2" title="경계 #2 — 이 등급은 AI 분석이 제안한 값이며, IC 승인 기록이 아닙니다">
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
              <span className="status-chip status-not-started">○ 미산정 (not graded)</span>
              <span className="status-chip status-amber ml-2" title="경계 #2 — 이 평가는 AI 분석이 제안한 값이며, IC 승인 기록이 아닙니다">
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
                  : "RAG 평가 기록이 없습니다 — 입력이 채워지면 자동 제안됩니다."}
              </span>
            </p>
          )}
          {(() => {
            const overrides = (pkg?.gates.history ?? []).filter((h) => h.gap_override);
            if (overrides.length === 0) return null;
            return (
              <>
                <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">누락 산출물 예외 근거 (GO 기록 시 작성)</h4>
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

        {/* ── 설립 실행 5단계 (ADR-0165) ───────────────────────────────── */}
        <EstablishmentPanel
          projectId={projectId}
          canAct={canAct}
          est={est}
          fallbackSteps={pkg?.establishment.steps ?? []}
          gateHistory={pkg?.gates.history ?? []}
          onChanged={load}
        />

        {/* ── 신규 사업 실행 기준선 (ADR-0161) — greenfield 전용, 그 외 트랙은 아무것도 그리지 않는다 ── */}
        <ExecutionBaselinePanel projectId={projectId} canAct={canAct} />

        {/* ── PMI 킥오프 (brownfield M&A·JV·전략적 투자) ─────────────── */}
        {pkg?.pmi_kickoff.applies && (
          <section className="market-section sizing-step mt-3" aria-label="PMI 킥오프">
            <h3 className="sizing-step-title text-[0.95rem]">
              <span className="sizing-step-badge">🤝</span> PMI 킥오프 — Brownfield 통합 계획 기준선
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
        )}

        {/* ── 의사결정: 법인 → 그룹 투자심의위원회 한 구역 (검토 블록은 상단에 한 번만) ── */}
        <div className="mt-4">
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
