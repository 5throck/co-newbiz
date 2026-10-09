"use client";

// S11 프로젝트 단계 본문 — ADR-0120 Wave 3 추출(/projects/[id]/ic-review 페이지와
// /deals/[id]/s11 탭이 동일 컴포넌트를 소비한다). StageTabs·StageFrame이
// projectId에 결합되어 있어 컴포넌트가 직접 렌더링한다 — 호출자는 main 셸만 제공.

import { DECISION_LABEL, GATE_LABEL } from "../../lib/labels.ts";
import { Fragment, useCallback, useEffect, useState } from "react";
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
import { canWriteProject } from "../../lib/project-write-access.ts";

// S11 투자심사·실행 — IC 패키지 열람 + Entity/Group IC 진행 기록 + 설립 실행
// 5단계 진행 화면 (ADR-0100 §3). 경계 #2: RAG 등급은 'AI 제안'으로만 표시되고
// (승인 도장 없음), 진행 GO/HOLD/KILL 기록과 설립 단계 완료 기록은 사람의
// 행위다. 이 화면은 패키지를 읽어오는 GET만 자동화하고, 쓰기는 명시적 P4
// 확인(useConfirm)을 거친 analyst+ 행위다.

interface SimRow { scenario: string; percentile: string; npv_krw_m: number; irr: number | null; note: string | null }
interface AdoptedCase { id: string; name: string; kind: string; scenario: string | null; simulations: SimRow[] }
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

interface StepRow { step_no: number; status: string; origin: string; checklist_item: string | null; evidence_url: string | null; note: string | null; owner: string; updated_at: string; keyed_by: string }
interface EstablishmentView {
  project: { id: string; project_no: string; origin: string | null };
  steps: StepRow[];
  complete: boolean;
  progress: string;
}

// P5: 상태는 색+아이콘+텍스트의 조합 — 색 단독으로 상태를 전달하지 않는다.
const STEP_STATUS_META: Record<string, { icon: string; label: string; cls: string }> = {
  pending: { icon: "○", label: "대기", cls: "status-not-started" },
  in_progress: { icon: "◐", label: "진행 중", cls: "status-amber" },
  done: { icon: "●", label: "완료", cls: "status-green" },
  halted: { icon: "✕", label: "중단", cls: "status-red" },
  escalated: { icon: "▲", label: "에스컬레이션", cls: "status-amber" },
};

function stepMeta(status: string | undefined) {
  return STEP_STATUS_META[status ?? "pending"] ?? { icon: "?", label: status ?? "unknown", cls: "status-not-started" };
}

const STEP_TITLES: Record<number, string> = {
  1: "설립준비(관할·주식구조·이사회 결의)",
  2: "법인등기·정관·사업자등록",
  3: "인허가 이전/재발급 분류",
  4: "인력이전(신 근로계약+PIIA)",
  5: "완료확인(IP양도체인·거버넌스 베이스라인)",
};

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
  // Per-step action panel (R2-B item 7): which establishment step is open, and its draft.
  const [openStep, setOpenStep] = useState<number | null>(null);
  const [form, setForm] = useState<{ status: string; evidence_url: string; note: string }>({
    status: "done", evidence_url: "", note: "",
  });
  const { toast } = useToast();
  const [pmiForm, setPmiForm] = useState<{ owner: string; plan_note: string }>({ owner: "", plan_note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<IcPackage>(`/api/projects/${encodeURIComponent(projectId)}/ic-package`)
      .then((r) => setPkg(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "IC 패키지를 불러오지 못했습니다."));
    api.get<EstablishmentView>(`/api/projects/${encodeURIComponent(projectId)}/establishment`)
      .then((r) => setEst(r.data))
      .catch(() => { /* the IC package already carries establishment progress */ });
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function updateStep(stepNo: number) {
    if (form.status === "done" && !form.evidence_url.trim() && !form.note.trim()) {
      setError("완료 처리에는 증적 URL 또는 비고(증적 설명)가 필요합니다.");
      return;
    }
    confirm(`설립 실행 ${stepNo}단계 기록`, () => {
      void (async () => {
        setBusy(true); setError(null);
        try {
          await api.put(`/api/projects/${encodeURIComponent(projectId)}/establishment`, {
            step_no: stepNo,
            status: form.status,
            origin: est?.project.origin ?? "internal",
            evidence_url: form.evidence_url || undefined,
            note: form.note || undefined,
          });
          setNotice("설립 실행 단계가 기록되었습니다. 완료확인(5단계)은 선행 4단계가 모두 완료된 후에만 완료할 수 있습니다.");
          toast(`설립 실행 ${stepNo}단계를 기록했습니다.`);
          setOpenStep(null);
          setForm({ status: "done", evidence_url: "", note: "" });
          load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "설립 실행 기록 실패");
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: "설립 실행 단계 상태를 기록합니다. 기록하는 사람이 이 단계의 담당자로 남으며, 이 기록은 담당자가 확인한 실행 증적입니다. 에이전트가 대신 완료 처리할 수 없습니다.",
      confirmLabel: "기록",
      tone: "neutral",
    });
  }

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
  const estApplies = origin === "internal" || origin === "joint";

  return (
<>
      <StageTabs projectId={projectId} />
      <GateDecisionJump gate={entityGo ? "group_ic" : "entity_ic"} />
      {/* One review block for both IC gates (the panels below do not repeat it). */}
      <ReviewBuckets entityType="project" entityId={projectId} gates={["entity_ic", "group_ic"]} artifacts={stageArtifactTabs("S11")} />
      <StageFrame stageId="S11" heading="S11 투자심사·실행 — IC 패키지 · Entity/Group IC · 설립 실행">
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          Entity IC와 Group IC 승인이 모두 기록되고, 내부 추진·합작 프로젝트는 설립 5단계 완료 기록이
          존재해야 S11이 완료됩니다.
          <Link href={`/projects/${projectId}/charter`} className="ml-2 underline">프로젝트 추진계획(차터) 보기 →</Link>
          <span className={`status-chip ${bothGatesGo ? "status-green" : "status-amber"} ml-2`}>
            {bothGatesGo ? "● IC 진행 2/2 GO" : "○ IC 진행 미승인"}
          </span>
          {estApplies && (
            <span className={`status-chip ${estComplete ? "status-green" : "status-amber"} ml-1`}>
              {estComplete ? `● 설립 실행 완료 (${pkg?.establishment.progress ?? "—"})` : `◐ 설립 실행 ${pkg?.establishment.progress ?? "—"} (내부 추진·합작 적용)`}
            </span>
          )}
        </p>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-caption)] mb-2">✓ {notice}</p>}

        {/* ── IC 패키지 요약 ─────────────────────────────────────────── */}
        <section className="market-section sizing-step" aria-label="IC 패키지 요약">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">📦</span> IC 패키지 — Business Case · DD · RAG 제안
          </h3>

          <h4 className="text-[length:var(--fs-body)] mt-2 mb-1">채택 Business Case (S8)</h4>
          {pkg?.business_case.adopted ? (
            <>
              <p className="text-[length:var(--fs-caption)]">
                {pkg.business_case.adopted.name}
                <span className="status-chip status-green ml-2">✓ 채택됨</span>
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
                  <strong>{f.category}</strong>: {f.description}
                  {f.value_impact != null && <span className="ml-1 tabular-nums">(가치 영향 {f.value_impact})</span>}
                </li>
              ))}
            </ul>
          )}

          <h4 className="text-[length:var(--fs-body)] mt-3 mb-1">RAG 종합 등급</h4>
          {pkg?.rag.grade ? (
            <p className="text-[length:var(--fs-caption)]">
              <span className={`status-chip ${RAG_META[pkg.rag.grade]?.cls ?? "status-not-started"}`}>
                {RAG_META[pkg.rag.grade]?.icon ?? "?"} {pkg.rag.grade.toUpperCase()}
              </span>
              <span className="status-chip status-amber ml-2" title="경계 #2 — 이 등급은 AI 분석이 제안한 값이며, IC 승인 기록이 아닙니다">
                ⚠ AI 제안 (승인 아님)
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
                ⚠ AI 제안 (승인 아님)
              </span>
              {pkg?.rag.confidence_cap && (
                <span className="status-chip status-not-started ml-1" title={pkg.rag.confidence_note ?? ""}>
                  신뢰도 상한 {capLabel(pkg.rag.confidence_cap)}
                </span>
              )}
              <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
                {pkg?.rag.missing_dimensions?.length
                  ? `종합 등급을 낼 수 없습니다 — 미평가 차원: ${pkg.rag.missing_dimensions.join(", ")}. 여섯 차원이 모두 평가되어야 종합 등급이 산정됩니다 (빨강 신호는 예외로 즉시 표시).`
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

        {/* ── 설립 실행 5단계 ────────────────────────────────────────── */}
        <section className="market-section sizing-step mt-3" aria-label="설립 실행 5단계">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">🏗</span> 설립 실행 — 5단계 (내부 추진·합작 프로젝트)
          </h3>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
            담당자는 단계를 기록한 사람입니다. 완료 처리는 증적(URL 또는 설명)과 함께 사람이 기록하며, 에이전트는 대신 완료할 수 없습니다.
            {!estApplies && " 이 프로젝트는 내부 추진·합작이 아니어서 설립 실행이 적용되지 않습니다."}
          </p>
          <div className="table-scroll">
          <table className="data-table" aria-label="설립 실행 단계 현황">
            <caption className="sr-only">설립 실행 5단계 진행 현황</caption>
            <thead>
              <tr><th scope="col">단계</th><th scope="col">상태</th><th scope="col">담당자 (기록자)</th><th scope="col">갱신</th>{canAct && estApplies && <th scope="col">작업</th>}</tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((n) => {
                const row = est?.steps.find((s) => s.step_no === n) ?? pkg?.establishment.steps.find((s) => s.step_no === n);
                const meta = stepMeta(row?.status);
                const isDone = row?.status === "done";
                const open = openStep === n;
                return (
                  <Fragment key={n}>
                    <tr>
                      <td><span className="tabular-nums mr-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{n}</span>{STEP_TITLES[n]}</td>
                      <td><span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                      <td className="text-[length:var(--fs-caption)]">
                        {row?.owner ?? "미지정"}
                        {row?.evidence_url && <span className="block text-[color:var(--muted-fg)]">증적: {row.evidence_url}</span>}
                      </td>
                      <td className="text-[length:var(--fs-caption)] tabular-nums">{row?.updated_at?.slice(0, 10) ?? "—"}</td>
                      {canAct && estApplies && (
                        <td>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={busy || isDone}
                            aria-expanded={open}
                            aria-controls={`est-step-${n}`}
                            onClick={() => { setOpenStep(open ? null : n); setForm({ status: "done", evidence_url: "", note: "" }); }}
                          >
                            {isDone ? "완료됨" : open ? "닫기" : "증적과 함께 완료"}
                          </button>
                          {isDone && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">이미 완료 처리됨</span>}
                        </td>
                      )}
                    </tr>
                    {open && canAct && estApplies && (
                      <tr id={`est-step-${n}`}>
                        <td colSpan={5}>
                          <form className="sizing-new-form" aria-label={`설립 실행 ${n}단계 기록`} onSubmit={(e) => { e.preventDefault(); updateStep(n); }}>
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="text-[length:var(--fs-caption)]">
                                <span className="block mb-1">상태</span>
                                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="sizing-new-input sizing-new-input-sm">
                                  {Object.entries(STEP_STATUS_META).filter(([k]) => k !== "pending").map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                                </select>
                              </label>
                              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]">
                                <span className="block mb-1">증적 URL (완료 시 URL 또는 비고 필수)</span>
                                <input value={form.evidence_url} onChange={(e) => setForm({ ...form, evidence_url: e.target.value })} className="sizing-new-input w-full" placeholder="data room 링크" />
                              </label>
                              <label className="text-[length:var(--fs-caption)] flex-1 min-w-[12rem]">
                                <span className="block mb-1">비고</span>
                                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sizing-new-input w-full" />
                              </label>
                              <button type="submit" className="btn-ghost btn-sm" disabled={busy}>{busy ? "기록 중..." : "단계 기록 (확인 필요)"}</button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>

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

        {/* ── 의사결정 ×2 (검토 블록은 상단에 한 번만) ───────────────── */}
        <div className="mt-4">
          <GateDecisionPanel
            opportunityId={projectId}
            gates={["entity_ic"]}
            entityType="project"
            killHint={null}
            showReview={false}
            goGaps={pkg?.gates.go_gaps}
            nextStage={{ label: "Group IC 결정 기록", href: "#gate-decision-group_ic" }}
          />
        </div>
        <div className="mt-3">
          <GateDecisionPanel
            opportunityId={projectId}
            gates={["group_ic"]}
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
