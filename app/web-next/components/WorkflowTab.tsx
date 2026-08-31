"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { BusinessCasePanel } from "./BusinessCasePanel.tsx";

// 딜 워크플로우 — S4~S7 4단계 카드 (시장분석·기회발굴 페이지와 동일한
// sizing-step 카드 스타일). 좌측 사이드바(WorkflowSidebar)의 단계 선택에 따라
// 해당 단계 카드로 스크롤된다. S1~S3(Long List)은 완료 전제.

interface ProcessEvaluation {
  currentStage: string | null;
  completedStages: string[];
  blockedStages: string[];
  nextStage: string | null;
  blockers: string[];
  requiredArtifacts: string[];
  gateStatus: Record<string, string>;
  track: "greenfield" | "brownfield" | null;
  subTrack: string | null;
  terminated: boolean;
}

interface OpportunityRow {
  id: string;
  name: string;
  status: string;
}

interface StageDef {
  id: string;
  no: number;
  title: string;
  objective: string;
  gates: Array<{ key: string; label: string }>;
}

const STAGES: StageDef[] = [
  {
    id: "S4", no: 4, title: "진출방식 결정",
    objective: "Greenfield(자체 개척)과 Brownfield(M&A) 중 진출 방식을 결정하고 근거·대안을 기록합니다.",
    gates: [{ key: "screening", label: "Screening" }],
  },
  {
    id: "S5", no: 5, title: "사업성 분석",
    objective: "Business Case와 재무 모델로 사업성을 검증합니다 (NPV/IRR/민감도).",
    gates: [{ key: "pre_fs", label: "Pre-FS" }],
  },
  {
    id: "S6", no: 6, title: "실사·검증",
    objective: "Commercial/Technical/Legal DD 워크스페이스에서 실사 체크리스트를 수행합니다.",
    gates: [{ key: "dd", label: "DD" }],
  },
  {
    id: "S7", no: 7, title: "투자심사·실행",
    objective: "Entity IC 투자심사를 통과하면 실행(PMI) 단계로 이행합니다.",
    gates: [{ key: "entity_ic", label: "Entity IC" }],
  },
];

const TRACK_LABEL: Record<string, string> = {
  greenfield: "Greenfield — 자체 개척",
  brownfield: "Brownfield — M&A",
  "greenfield:existing_business_rbd": "Greenfield · 기존 조직 성장 (R&BD)",
  "greenfield:intra_venture": "Greenfield · 사내벤처",
};

export function WorkflowTab({ projectId }: { projectId: string }) {
  const [projectEval, setProjectEval] = useState<ProcessEvaluation | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [routeForm, setRouteForm] = useState({ track: "greenfield", sub_track: "intra_venture", rationale: "", alternatives_considered: "", opportunity_id: "" });
  const [gateForm, setGateForm] = useState<{ gate: string; decision: string; rationale: string; missing: string }>({ gate: "screening", decision: "go", rationale: "", missing: "" });
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentLog, setAgentLog] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<ProcessEvaluation>(`/api/projects/${projectId}/process`).then((r) => setProjectEval(r.data)).catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    api.get<OpportunityRow[]>(`/api/opportunities?project_id=${projectId}`).then((r) => setOpps(r.data)).catch(() => setOpps([]));
  }, [projectId]);

  useEffect(load, [load]);

  async function saveRouteDecision(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const opportunityId = routeForm.opportunity_id || opps?.[0]?.id;
      if (!opportunityId) throw new Error("연결된 기회가 없습니다 — 먼저 기회를 등록·연결하세요.");
      await api.post(`/api/projects/${projectId}/route-decision`, {
        opportunity_id: opportunityId,
        track: routeForm.track,
        sub_track: routeForm.track === "greenfield" ? routeForm.sub_track : undefined,
        rationale: routeForm.rationale,
        alternatives_considered: routeForm.alternatives_considered || undefined,
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function saveGate(gate: string, e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData((e.target as HTMLFormElement));
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/gate-decisions`, {
        gate,
        decision: fd.get("decision"),
        rationale: fd.get("rationale"),
        missing_artifacts: fd.get("decision") === "hold" ? String(fd.get("missing") ?? "").split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "판정 기록 실패");
    } finally {
      setBusy(false);
    }
  }

  async function runAgents() {
    setAgentBusy(true);
    setError(null);
    try {
      const stageId = projectEval?.currentStage ?? "S4";
      const res = await api.post<{ stage: string; conclusion_md: string; recommendation: string }>(
        `/api/projects/${projectId}/agent-run`,
        { stage: stageId },
      );
      setAgentLog(`[${res.data.stage}] 권고: ${res.data.recommendation.toUpperCase()}\n\n${res.data.conclusion_md}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "에이전트 실행 실패");
    } finally {
      setAgentBusy(false);
    }
  }

  if (error && projectEval === null) {
    return <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>;
  }
  if (!projectEval) return <p>불러오는 중...</p>;

  const track = projectEval.track;
  const trackLabel = track ? (TRACK_LABEL[track + (projectEval.subTrack ? `:${projectEval.subTrack}` : "")] ?? TRACK_LABEL[track]) : null;

  return (
    <div>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {trackLabel && (
        <p className="market-section sizing-note-list text-[0.8rem]">
          진출방식: <strong>{trackLabel}</strong> · 현재 단계: <strong>{projectEval.currentStage ?? "—"}</strong>
          {projectEval.terminated && <> · <span className="status-chip status-red">종결</span></>}
        </p>
      )}

      {STAGES.map((stage) => {
        const isComplete = projectEval.completedStages.includes(stage.id);
        const isCurrent = projectEval.currentStage === stage.id;
        const isBlocked = projectEval.blockedStages.includes(stage.id);
        const gate = stage.gates[0];
        const gateVerdict = projectEval.gateStatus[gate.key];
        return (
          <section key={stage.id} id={`stage-${stage.id}`} aria-label={stage.title} className="market-section sizing-step" style={{ scrollMarginTop: "5rem" }}>
            <h3 className="sizing-step-title">
              <span className="sizing-step-badge">{stage.no}</span> {stage.title}
              <span className={`status-chip ml-2 ${isComplete ? "status-green" : isCurrent ? "status-amber" : "status-not-started"}`}>
                {isComplete ? "완료" : isCurrent ? "현재 단계" : isBlocked ? "보류(HOLD)" : "대기"}
              </span>
            </h3>
            <p className="mb-3 text-[color:var(--muted-fg)] text-[0.8rem]">{stage.objective}</p>

            {/* S4: 라우트 결정 */}
            {stage.id === "S4" && (
              <div>
                {track ? (
                  <p className="sizing-note-list">✅ 결정 완료 — <strong>{trackLabel}</strong></p>
                ) : (
                  <form onSubmit={saveRouteDecision} className="route-form">
                    <label>
                      트랙
                      <select value={routeForm.track} onChange={(e) => setRouteForm({ ...routeForm, track: e.target.value })}>
                        <option value="greenfield">Greenfield — 자체 개척</option>
                        <option value="brownfield">Brownfield — M&A</option>
                      </select>
                    </label>
                    {routeForm.track === "greenfield" && (
                      <label>
                        실행 형태
                        <select value={routeForm.sub_track} onChange={(e) => setRouteForm({ ...routeForm, sub_track: e.target.value })}>
                          <option value="existing_business_rbd">기존 조직 성장 (R&BD)</option>
                          <option value="intra_venture">사내벤처 (분사 염두)</option>
                        </select>
                      </label>
                    )}
                    <label>
                      근거
                      <textarea aria-label="결정 근거" value={routeForm.rationale} onChange={(e) => setRouteForm({ ...routeForm, rationale: e.target.value })} required />
                    </label>
                    <label>
                      검토한 대안
                      <textarea aria-label="검토한 대안" value={routeForm.alternatives_considered} onChange={(e) => setRouteForm({ ...routeForm, alternatives_considered: e.target.value })} />
                    </label>
                    {opps && opps.length > 0 && (
                      <label>
                        연결 기회
                        <select aria-label="연결 기회" value={routeForm.opportunity_id || opps[0].id} onChange={(e) => setRouteForm({ ...routeForm, opportunity_id: e.target.value })}>
                          {opps.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button type="submit" className="btn-premium" disabled={busy}>라우트 결정 저장</button>
                  </form>
                )}
              </div>
            )}

            {/* S5: 사업성 분석 도구 */}
            {stage.id === "S5" && track === "greenfield" && (
              <div>
                <p className="sizing-note-list mb-2 text-[0.78rem] text-[color:var(--muted-fg)]">Business Case 라인(매출·비용·투자)을 입력해 연도별 손익과 BEP을 산출합니다.</p>
                <BusinessCasePanel projectId={projectId} />
              </div>
            )}
            {stage.id === "S5" && track === "brownfield" && (
              <p className="sizing-note-list">
                브라운필드(M&A) 트랙의 사업성 분석은 Commercial DD(밸류에이션)가 주체입니다 —
                실사 단계(S6)의 Commercial DD 워크스페이스에서 밸류에이션 체크리스트를 진행하세요.
              </p>
            )}
            {stage.id === "S6" && (
              <p className="sizing-note-list">
                실사 체크리스트는 <strong>실사 탭</strong>의 DD 워크스페이스(Commercial/Technical/Legal)에서 항목별로
                평가하세요. 전체 항목 통과 시 아래 DD 게이트로 심사를 요청할 수 있습니다.
              </p>
            )}
            {stage.id === "S7" && (
              <p className="sizing-note-list">
                Entity IC 투자심사에서 최종 승인(GO)하면 실행(PMI)으로 이행합니다. PMI 증거 팩은 PMI 탭에서 관리합니다.
              </p>
            )}

            {/* 에이전트 실행 — 현재 단계에서만 */}
            {isCurrent && (
              <div className="mt-3">
                <button type="button" className="btn-ghost text-[0.78rem]" disabled={agentBusy} onClick={runAgents}>
                  {agentBusy ? "에이전트 실행 중..." : `🤖 현재 단계 에이전트 실행 (${stage.id})`}
                </button>
                {agentLog && (
                  <pre className="library-code mt-2"><code>{agentLog}</code></pre>
                )}
              </div>
            )}

            {/* 단계 게이트 판정 */}
            <details className="mt-3" open={isCurrent || isBlocked}>
              <summary className="cursor-pointer text-[0.8rem] text-[color:var(--accent)]">
                {gate.label} 게이트 판정 {gateVerdict ? `(현재: ${gateVerdict.toUpperCase()})` : "(미판정)"}
              </summary>
              {gateVerdict === "go" ? (
                <p className="sizing-note-list mt-2">✅ GO 판정 기록됨 — 다음 단계로 진행할 수 있습니다.</p>
              ) : (
                <form onSubmit={(e) => saveGate(gate.key, e)} className="route-form mt-2">
                  <label>
                    판정
                    <select name="decision" defaultValue="go">
                      <option value="go">GO</option>
                      <option value="hold">HOLD</option>
                      <option value="kill">KILL</option>
                    </select>
                  </label>
                  <label>
                    근거
                    <textarea name="rationale" required />
                  </label>
                  <label>
                    HOLD 시 보완 산출물 (쉼표 구분)
                    <input type="text" name="missing" />
                  </label>
                  <button type="submit" className="btn-premium" disabled={busy}>판정 기록</button>
                </form>
              )}
            </details>
          </section>
        );
      })}
    </div>
  );
}
