"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { BusinessCasePanel } from "./BusinessCasePanel.tsx";

// 워크플로우 탭 — 프로세스 스테이지 S1~S7의 단계 안내 뷰 (docs/process-flow.md).
// 현재 스테이지는 evaluateProcess()의 파생 상태다(저장하지 않음). S1~S4는
// 연결된 기회의 평가를, S5~S7은 프로젝트 평가를 표시하고, 스테이지 카드에는
// 필요 산출물 체크·Gate 판정(GO/HOLD/KILL)·트랙 분기 화면이 담긴다.

interface StageEval {
  id: string;
  name: string;
  sequence: number;
  objective: string;
  status: "complete" | "current" | "blocked" | "locked" | "terminated";
}

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
  stages: StageEval[];
}

interface OpportunityRow {
  id: string;
  name: string;
  status: string;
}

const STAGE_LABELS: Record<string, string> = {
  S1: "시장분석",
  S2: "기회발굴",
  S3: "시너지·적합성",
  S4: "진출방식 결정",
  S5: "사업성 분석",
  S6: "실사·검증",
  S7: "투자심사·실행",
};

const GATE_LABELS: Record<string, string> = {
  screening: "Screening",
  pre_fs: "Pre-FS",
  fs: "FS",
  dd: "DD",
  entity_ic: "Entity IC",
  group_ic: "Group IC",
};

export function WorkflowTab({ projectId }: { projectId: string }) {
  const [projectEval, setProjectEval] = useState<ProcessEvaluation | null>(null);
  const [oppEval, setOppEval] = useState<ProcessEvaluation | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // route decision form
  const [routeForm, setRouteForm] = useState({ track: "greenfield", sub_track: "intra_venture", rationale: "", alternatives_considered: "", opportunity_id: "" });
  // gate decision form
  const [gateForm, setGateForm] = useState({ gate: "screening", decision: "go", rationale: "", missing: "" });
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentLog, setAgentLog] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<ProcessEvaluation>(`/api/projects/${projectId}/process`).then((r) => setProjectEval(r.data)).catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
    api.get<OpportunityRow[]>(`/api/opportunities?project_id=${projectId}`).then((r) => {
      setOpps(r.data);
      const first = r.data[0];
      if (first) {
        api.get<ProcessEvaluation>(`/api/opportunities/${first.id}/process`).then((res) => setOppEval(res.data)).catch(() => setOppEval(null));
      }
    }).catch(() => setOpps([]));
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

  async function runAgents() {
    setAgentBusy(true);
    setError(null);
    try {
      const stageId = projectEval?.currentStage ?? "S5";
      const res = await api.post<{ stage: string; conclusion_md: string; recommendation: string }>(
        `/api/projects/${projectId}/agent-run`,
        { stage: stageId },
      );
      setAgentLog(`[${res.data.stage}] 권고: ${res.data.recommendation.toUpperCase()}

${res.data.conclusion_md}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "에이전트 실행 실패");
    } finally {
      setAgentBusy(false);
    }
  }

  async function saveGateDecision(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/gate-decisions`, {
        gate: gateForm.gate,
        decision: gateForm.decision,
        rationale: gateForm.rationale,
        missing_artifacts: gateForm.decision === "hold" ? gateForm.missing.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      });
      setGateForm({ gate: "screening", decision: "go", rationale: "", missing: "" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "판정 기록 실패");
    } finally {
      setBusy(false);
    }
  }

  if (error && projectEval === null) {
    return <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>;
  }
  if (!projectEval) return <p>불러오는 중...</p>;

  const stages = mergeStages(oppEval, projectEval);
  const track = projectEval.track;

  return (
    <div>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {projectEval.terminated && (
        <p role="alert" className="mnpi-banner">
          ⚠ 이 프로세스는 게이트 KILL 판정으로 종결되었습니다.
        </p>
      )}

      {/* Stepper */}
      <ol className="stage-stepper" aria-label="프로세스 스테이지">
        {stages.map((s) => (
          <li key={s.id} className={`stage-step stage-${s.status}`} title={s.objective}>
            <span className="stage-step-id">{s.id}</span>
            <span className="stage-step-name">{STAGE_LABELS[s.id]}</span>
            <span className="stage-step-mark">
              {s.status === "complete" ? "✓" : s.status === "current" ? "●" : s.status === "terminated" ? "✕" : "○"}
            </span>
          </li>
        ))}
      </ol>
      <p className="mb-3 text-[color:var(--muted-fg)] text-[0.82rem]">
        현재 스테이지: <strong>{projectEval.currentStage ?? "—"}</strong>
        {track && <> · 트랙: <strong>{track === "greenfield" ? "그린필드(자체)" : "브라운필드(M&A)"}</strong>{projectEval.subTrack ? ` (${projectEval.subTrack === "existing_business_rbd" ? "R&BD" : "사내벤처"})` : ""}</>}
        {" · "}스테이지는 저장되지 않고 산출물·게이트 상태에서 계산됩니다.
      </p>

      {/* Gate status */}
      <div className="gate-status-row" aria-label="게이트 상태">
        {Object.entries(projectEval.gateStatus).map(([gate, verdict]) => (
          <span key={gate} className={`status-chip ${verdict === "go" ? "status-green" : verdict === "hold" ? "status-amber" : verdict === "kill" ? "status-red" : "status-not-started"}`}>
            {GATE_LABELS[gate] ?? gate}: {verdict.toUpperCase()}
          </span>
        ))}
      </div>

      {/* Blockers */}
      {projectEval.blockers.length > 0 && (
        <ul className="workflow-blockers">
          {projectEval.blockers.map((b, i) => (
            <li key={i}>⚠ {b}</li>
          ))}
        </ul>
      )}

      {/* 에이전트 스테이지 실행 (Agentic-first) */}
      <section className="workflow-card" aria-label="에이전트 실행">
        <h3>에이전트 스테이지 실행</h3>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.82rem]">
          현재 스테이지({projectEval.currentStage ?? "—"})의 Activities를 매핑된 에이전트들이 수행하고, 입장과 결론을
          기록합니다. 결론의 게이트 권고는 gate_evaluation으로 기록되며 사람은 IC에서 최종 승인합니다.
        </p>
        <button type="button" className="btn-premium" disabled={agentBusy} onClick={runAgents}>
          {agentBusy ? "에이전트 실행 중..." : "에이전트 실행"}
        </button>
        {agentLog && (
          <pre className="library-code mt-2">
            <code>{agentLog}</code>
          </pre>
        )}
      </section>

      {/* S4 route decision form (visible until decided) */}
      {!track && (
        <section className="workflow-card" aria-label="진출방식 결정">
          <h3>S4 진출방식 결정</h3>
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
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="submit" className="btn-premium" disabled={busy}>
              라우트 결정 저장
            </button>
          </form>
        </section>
      )}

      {/* Gate decision form */}
      <section className="workflow-card" aria-label="게이트 판정 기록">
        <h3>게이트 판정 기록</h3>
        <form onSubmit={saveGateDecision} className="route-form">
          <label>
            게이트
            <select value={gateForm.gate} onChange={(e) => setGateForm({ ...gateForm, gate: e.target.value })}>
              {Object.entries(GATE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            판정
            <select value={gateForm.decision} onChange={(e) => setGateForm({ ...gateForm, decision: e.target.value })}>
              <option value="go">GO</option>
              <option value="hold">HOLD</option>
              <option value="kill">KILL</option>
            </select>
          </label>
          <label>
            근거
            <textarea aria-label="판정 근거" value={gateForm.rationale} onChange={(e) => setGateForm({ ...gateForm, rationale: e.target.value })} required />
          </label>
          {gateForm.decision === "hold" && (
            <label>
              보완 필요 산출물 (쉼표 구분)
              <input type="text" aria-label="보완 필요 산출물" value={gateForm.missing} onChange={(e) => setGateForm({ ...gateForm, missing: e.target.value })} />
            </label>
          )}
          <button type="submit" className="btn-premium" disabled={busy}>
            판정 기록
          </button>
        </form>
      </section>

      {/* Required artifacts of current stage */}
      {projectEval.requiredArtifacts.length > 0 && (
        <section className="workflow-card" aria-label="필요 산출물">
          <h3>현재 스테이지 필요 산출물</h3>
          <ul className="workflow-artifacts">
            {projectEval.requiredArtifacts.map((a, i) => (
              <li key={i}>☐ {a}</li>
            ))}
          </ul>
        </section>
      )}

      {/* S5 greenfield business case panel */}
      {projectEval.currentStage === "S5" && track === "greenfield" && (
        <BusinessCasePanel projectId={projectId} />
      )}
      {/* S5 brownfield: valuation is Commercial-DD-led — point at the DD workspace */}
      {projectEval.currentStage === "S5" && track === "brownfield" && (
        <section className="workflow-card" aria-label="M&A 밸류에이션 안내">
          <h3>S5 사업성 분석 (M&A)</h3>
          <p className="text-[0.85rem]">
            브라운필드 트랙의 사업성 분석은 Commercial DD(밸류에이션)가 주체입니다. 실사 탭의 Commercial DD 워크스페이스에서
            밸류에이션 관련 체크리스트를 진행하세요.
          </p>
        </section>
      )}
    </div>
  );
}

function mergeStages(oppEval: ProcessEvaluation | null, projectEval: ProcessEvaluation): StageEval[] {
  const oppStages = oppEval?.stages ?? [];
  const projectStages = projectEval.stages;
  const out: StageEval[] = [];
  for (const s of oppStages) out.push(s);
  for (const s of projectStages) out.push(s);
  // If no linked opportunity, render S1–S4 as locked placeholders.
  if (!oppEval) {
    for (const id of ["S1", "S2", "S3", "S4"]) {
      const exists = out.some((s) => s.id === id);
      if (!exists) out.unshift({ id, name: "", sequence: Number(id.slice(1)), objective: "", status: "locked" });
    }
    out.sort((a, b) => a.sequence - b.sequence);
  }
  return out;
}
