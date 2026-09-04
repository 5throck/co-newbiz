"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { api } from "../../../../lib/api.ts";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { GateDecisionPanel } from "../../../../components/GateDecisionPanel.tsx";
import { useConfirm } from "../../../../components/crud.tsx";

// S10 투자심사·실행 — IC 패키지 열람 + Entity/Group IC 게이트 기록 + 설립 실행
// 5단계 진행 화면 (ADR-0100 §3). 경계 #2: RAG 등급은 'AI 제안'으로만 표시되고
// (승인 도장 없음), 게이트 GO/HOLD/KILL 기록과 설립 단계 완료 기록은 사람의
// 행위다. 이 화면은 패키지를 읽어오는 GET만 자동화하고, 쓰기는 명시적 P4
// 확인(useConfirm)을 거친 analyst+ 행위다.

interface SimRow { scenario: string; percentile: string; npv_krw_m: number; irr: number | null; note: string | null }
interface AdoptedCase { id: string; name: string; kind: string; scenario: string | null; simulations: SimRow[] }
interface IcPackage {
  project: { id: string; project_no: string };
  business_case: { adopted: AdoptedCase | null; adoption: { modelId: string; adoptedBy: string; adoptedAt: string } | null; note?: string };
  dd: {
    completion: { total: number; pending: number; mandatoryUnmet: number };
    findings: Array<{ id: string; category: string; description: string; value_impact: number | null; evidence_ref: string | null }>;
    finding_count: number;
  };
  rag: { grade: string | null; isProposal: true; rationale: string | null; assessed_at: string | null; confidence_cap: string | null; confidence_note: string | null };
  gates: {
    latest: Array<{ gate: string; decision: "go" | "hold" | "kill" | null; rationale: string | null; missing_artifacts: string[] | null }>;
    history: Array<{ id: string; gate: string; decision: string; rationale: string; decided_by: string; decided_at: string }>;
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

export default function IcReviewPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { me } = useAuth();
  const canAct = me?.role === "admin" || me?.role === "analyst";
  const { confirm, confirmDialog } = useConfirm();
  const [pkg, setPkg] = useState<IcPackage | null>(null);
  const [est, setEst] = useState<EstablishmentView | null>(null);
  const [form, setForm] = useState<{ step_no: number; status: string; evidence_url: string; note: string }>({
    step_no: 1, status: "done", evidence_url: "", note: "",
  });
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

  function updateStep() {
    confirm("설립 실행 단계 기록", () => {
      void (async () => {
        setBusy(true); setError(null);
        try {
          await api.put(`/api/projects/${encodeURIComponent(projectId)}/establishment`, {
            step_no: form.step_no,
            status: form.status,
            origin: est?.project.origin ?? "internal",
            evidence_url: form.evidence_url || undefined,
            note: form.note || undefined,
          });
          setNotice("설립 실행 단계가 기록되었습니다. 완료확인(5단계)은 선행 4단계가 모두 완료된 후에만 완료할 수 있습니다.");
          load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "설립 실행 기록 실패");
        } finally {
          setBusy(false);
        }
      })();
    }, {
      body: "설립 실행 단계 상태를 기록합니다. 이 기록은 담당자(owner)가 확인한 실행 증적이며, 에이전트가 대신 완료 처리할 수 없습니다.",
      confirmLabel: "기록",
    });
  }

  const bothGatesGo = ["entity_ic", "group_ic"].every((g) =>
    pkg?.gates.latest.find((x) => x.gate === g)?.decision === "go",
  );
  const estComplete = pkg?.establishment.complete ?? false;
  const origin = est?.project.origin;
  const estApplies = origin == null || origin === "internal" || origin === "joint";

  return (
    <main>
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S10" heading="S10 투자심사·실행 — IC 패키지 · Entity/Group IC · 설립 실행">
        <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-2">
          Entity IC와 Group IC 승인이 모두 기록되고, origin∈{"{internal,joint}"} 프로젝트는 설립 5단계 완료 기록이
          존재해야 S10이 완료됩니다 (flow.spec v2.0.0).
          <span className={`status-chip ${bothGatesGo ? "status-green" : "status-amber"} ml-2`}>
            {bothGatesGo ? "● IC 게이트 2/2 GO" : "○ IC 게이트 미승인"}
          </span>
          {estApplies && (
            <span className={`status-chip ${estComplete ? "status-green" : "status-amber"} ml-1`}>
              {estComplete ? `● 설립 실행 완료 (${pkg?.establishment.progress ?? "—"})` : `◐ 설립 실행 ${pkg?.establishment.progress ?? "—"} (internal/joint 적용)`}
            </span>
          )}
        </p>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">✕ {error}</p>}
        {notice && <p role="status" className="text-[color:var(--green-fg)] text-[0.82rem] mb-2">✓ {notice}</p>}

        {/* ── IC 패키지 요약 ─────────────────────────────────────────── */}
        <section className="market-section sizing-step" aria-label="IC 패키지 요약">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">📦</span> IC 패키지 — Business Case · DD · RAG 제안
          </h3>

          <h4 className="text-[0.85rem] mt-2 mb-1">채택 Business Case (S8)</h4>
          {pkg?.business_case.adopted ? (
            <>
              <p className="text-[0.82rem]">
                {pkg.business_case.adopted.name}
                <span className="status-chip status-green ml-2">✓ 채택됨</span>
                {pkg.business_case.adopted.scenario && (
                  <span className="status-chip status-not-started ml-1">시나리오: {pkg.business_case.adopted.scenario}</span>
                )}
                {pkg.business_case.adoption && (
                  <span className="block text-[0.72rem] text-[color:var(--muted-fg)]">
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
            <p className="text-[0.82rem] text-[color:var(--muted-fg)]">
              {pkg?.business_case.note ?? "채택된 Business Case가 없습니다."}
            </p>
          )}

          <h4 className="text-[0.85rem] mt-3 mb-1">DD 요약 (S9)</h4>
          <p className="text-[0.82rem]">
            <span className={`status-chip ${pkg && pkg.dd.completion.total > 0 && pkg.dd.completion.pending === 0 && pkg.dd.completion.mandatoryUnmet === 0 ? "status-green" : "status-amber"}`}>
              {pkg && pkg.dd.completion.total > 0
                ? `판정 ${pkg.dd.completion.total}건 · 대기 ${pkg.dd.completion.pending}건 · 필수 미충족 ${pkg.dd.completion.mandatoryUnmet}건`
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

          <h4 className="text-[0.85rem] mt-3 mb-1">RAG 종합 등급</h4>
          {pkg?.rag.grade ? (
            <p className="text-[0.82rem]">
              <span className={`status-chip ${RAG_META[pkg.rag.grade]?.cls ?? "status-not-started"}`}>
                {RAG_META[pkg.rag.grade]?.icon ?? "?"} {pkg.rag.grade.toUpperCase()}
              </span>
              <span className="status-chip status-amber ml-2" title="경계 #2 — 이 등급은 AI 분석이 제안한 값이며, IC 승인 기록이 아닙니다">
                ⚠ AI 제안 (승인 아님)
              </span>
              {pkg.rag.confidence_cap && (
                <span className="status-chip status-not-started ml-1" title={pkg.rag.confidence_note ?? ""}>
                  신뢰도 상한 {pkg.rag.confidence_cap}
                </span>
              )}
              {pkg.rag.rationale && (
                <span className="block text-[0.75rem] text-[color:var(--muted-fg)] mt-1">근거: {pkg.rag.rationale}</span>
              )}
            </p>
          ) : (
            <p className="text-[0.82rem] text-[color:var(--muted-fg)]">RAG 종합 평가 기록이 없습니다.</p>
          )}
        </section>

        {/* ── 설립 실행 5단계 ────────────────────────────────────────── */}
        <section className="market-section sizing-step mt-3" aria-label="설립 실행 5단계">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">🏗</span> 설립 실행 — 5단계 (origin∈{"{internal,joint}"})
          </h3>
          <table className="data-table" aria-label="설립 실행 단계 현황">
            <caption className="sr-only">설립 실행 5단계 진행 현황</caption>
            <thead>
              <tr><th scope="col">단계</th><th scope="col">상태</th><th scope="col">담당자</th><th scope="col">갱신</th></tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((n) => {
                const row = est?.steps.find((s) => s.step_no === n) ?? pkg?.establishment.steps.find((s) => s.step_no === n);
                const meta = stepMeta(row?.status);
                return (
                  <tr key={n}>
                    <td><span className="tabular-nums mr-1 text-[0.75rem] text-[color:var(--muted-fg)]">{n}</span>{STEP_TITLES[n]}</td>
                    <td><span className={`status-chip ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                    <td className="text-[0.78rem]">{row?.owner ?? "—"}</td>
                    <td className="text-[0.75rem] tabular-nums">{row?.updated_at?.slice(0, 10) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {canAct && estApplies && (
            <form className="sizing-new-form mt-2" aria-label="설립 실행 단계 기록" onSubmit={(e) => { e.preventDefault(); updateStep(); }}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[0.78rem]">
                  <span className="block mb-1">단계</span>
                  <select
                    value={form.step_no}
                    onChange={(e) => setForm({ ...form, step_no: Number(e.target.value) })}
                    className="sizing-new-input sizing-new-input-sm"
                  >
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}. {STEP_TITLES[n]}</option>)}
                  </select>
                </label>
                <label className="text-[0.78rem]">
                  <span className="block mb-1">상태</span>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                  >
                    {Object.entries(STEP_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                </label>
                <label className="text-[0.78rem] flex-1 min-w-[12rem]">
                  <span className="block mb-1">증적 URL</span>
                  <input
                    value={form.evidence_url}
                    onChange={(e) => setForm({ ...form, evidence_url: e.target.value })}
                    className="sizing-new-input w-full"
                    placeholder="data room 링크 (선택)"
                  />
                </label>
                <label className="text-[0.78rem] flex-1 min-w-[12rem]">
                  <span className="block mb-1">비고</span>
                  <input
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    className="sizing-new-input w-full"
                    placeholder="선택"
                  />
                </label>
              </div>
              <button type="submit" className="btn-ghost btn-sm mt-2" disabled={busy}>
                {busy ? "기록 중..." : "단계 기록 (확인 필요)"}
              </button>
            </form>
          )}
        </section>

        {/* ── 게이트 결정 ×2 ─────────────────────────────────────────── */}
        <div className="mt-4">
          <GateDecisionPanel
            opportunityId={projectId}
            gates={["entity_ic"]}
            entityType="project"
            killHint={null}
          />
        </div>
        <div className="mt-3">
          <GateDecisionPanel
            opportunityId={projectId}
            gates={["group_ic"]}
            entityType="project"
            killHint={null}
          />
        </div>
        {confirmDialog}
      </StageFrame>
    </main>
  );
}
