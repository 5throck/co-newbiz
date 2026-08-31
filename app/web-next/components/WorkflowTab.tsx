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
    id: "S4", no: 4, title: "진출방식 결정 (Route Decision)",
    objective: "Greenfield(자체 역량 진출)과 Brownfield(기존 기업·자산 결합) 중 진출 방식을 결정합니다 — Brownfield는 M&A만이 아니라 JV·전략적 투자·소수점 지분·파트너십·R&BD·사내벤처를 포함합니다.",
    gates: [{ key: "screening", label: "Screening" }],
  },
  {
    id: "S5", no: 5, title: "사업성 분석 · 대상 선별",
    objective: "Greenfield는 역량 평가·Entry Strategy·Business Case를, Brownfield는 대상 기업 Long List → 스크리닝 → Short List 선별을 수행합니다.",
    gates: [{ key: "pre_fs", label: "Pre-FS" }],
  },
  {
    id: "S6", no: 6, title: "실사·검증 / 실현가능성",
    objective: "Brownfield는 Short List 대상 CDD/TDD 등 실사를, Greenfield는 실현가능성·역량 격차 검증을 수행합니다.",
    gates: [{ key: "dd", label: "DD" }],
  },
  {
    id: "S7", no: 7, title: "투자심사·실행",
    objective: "Entity IC 투자심사를 통과하면 실행(PMI) 단계로 이행합니다.",
    gates: [{ key: "entity_ic", label: "Entity IC" }],
  },
];

const TRACK_LABEL: Record<string, string> = {
  greenfield: "Greenfield — 자체 역량 진출",
  brownfield: "Brownfield — 기존 기업·자산 결합",
  "greenfield:existing_business_rbd": "Greenfield · 기존 조직 성장 (R&BD)",
  "greenfield:intra_venture": "Greenfield · 사내벤처",
  "brownfield:m_and_a": "Brownfield · M&A",
  "brownfield:jv": "Brownfield · JV",
  "brownfield:strategic_investment": "Brownfield · 전략적 투자",
  "brownfield:minority_investment": "Brownfield · 소수점 지분 투자",
  "brownfield:partnership": "Brownfield · 파트너십",
  "brownfield:rbd": "Brownfield · R&BD",
  "brownfield:corporate_venture": "Brownfield · 사내벤처 투자 (CVC)",
};

export function WorkflowTab({ projectId }: { projectId: string }) {
  const [projectEval, setProjectEval] = useState<ProcessEvaluation | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [routeForm, setRouteForm] = useState({ track: "greenfield", sub_track: "intra_venture", brownfield_route: "m_and_a", rationale: "", alternatives_considered: "", opportunity_id: "" });
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
        sub_track: routeForm.track === "greenfield" ? routeForm.sub_track : routeForm.brownfield_route,
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
                        <option value="greenfield">Greenfield — 자체 역량 진출</option>
                        <option value="brownfield">Brownfield — 기존 기업·자산 결합</option>
                      </select>
                    </label>
                    {routeForm.track === "brownfield" && (
                      <label>
                        Brownfield Route (M&A만이 아닙니다)
                        <select value={routeForm.brownfield_route} onChange={(e) => setRouteForm({ ...routeForm, brownfield_route: e.target.value })}>
                          <option value="m_and_a">M&A</option>
                          <option value="jv">JV (합작)</option>
                          <option value="strategic_investment">전략적 투자</option>
                          <option value="minority_investment">소수점 지분 투자</option>
                          <option value="partnership">파트너십</option>
                          <option value="rbd">R&BD 결합</option>
                          <option value="corporate_venture">사내벤처 투자 (CVC)</option>
                        </select>
                      </label>
                    )}
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
              <TargetScreeningPanel projectId={projectId} />
            )}
            {stage.id === "S6" && (
              <p className="sizing-note-list">
                {track === "brownfield"
                  ? <>Short List 대상의 실사 체크리스트는 <strong>실사 탭</strong>의 DD 워크스페이스(Commercial/Technical/Legal)에서 항목별로 평가하세요. 전체 항목 통과 시 아래 DD 게이트로 심사를 요청할 수 있습니다.</>
                  : <>Greenfield는 DD 대신 <strong>실현가능성·역량 격차 검증</strong>을 수행합니다 — Business Case의 가정이 자체 역량으로 실현 가능한지 확인하세요.</>}
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

/* ── S5 Brownfield — 대상 기업 Long List → Short List 선별 (agentic screening) ── */
interface TargetRow { id: string; company_id: string; role: string; company_name: string; dart_corp_code: string | null }

function TargetScreeningPanel({ projectId }: { projectId: string }) {
  const [targets, setTargets] = useState<TargetRow[] | null>(null);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ targets: TargetRow[]; primary_target_id: string | null }>(`/api/projects/${projectId}/targets`)
      .then((r) => { setTargets(r.data.targets); setPrimaryId(r.data.primary_target_id); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [projectId]);

  useEffect(load, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/targets`, body);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "처리 실패");
    } finally {
      setBusy(false);
    }
  }

  const candidates = targets?.filter((t) => t.role === "candidate") ?? [];
  const shortList = targets?.filter((t) => t.role === "target") ?? [];

  return (
    <div>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.8rem]">{error}</p>}

      {/* Long List 추가 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const list = names.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
          if (list.length === 0) return;
          void act({ action: "add_candidates", names: list }).then(() => setNames(""));
        }}
        className="sizing-new-form"
        aria-label="대상 기업 Long List 추가"
      >
        <label className="text-[0.78rem] w-full">
          <span className="block mb-1">대상 기업 후보 추가 (Long List — 줄바꿈/쉼표 구분)</span>
          <textarea
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder={"레인보우로보틱스\n애드로보틱스\n더방로보틱스"}
            rows={3}
            className="w-full"
          />
        </label>
        <button type="submit" className="btn-ghost text-[0.8rem]" disabled={busy || !names.trim()}>Long List 추가</button>
      </form>

      {/* Long List → Short List 스크리닝 */}
      <table className="data-table mt-3" aria-label="대상 기업 선별">
        <caption className="sr-only">대상 기업 Long/Short List</caption>
        <thead>
          <tr><th scope="col">기업</th><th scope="col">단계</th><th scope="col">액션</th></tr>
        </thead>
        <tbody>
          {targets === null ? (
            <tr><td colSpan={3}>불러오는 중...</td></tr>
          ) : targets.length === 0 ? (
            <tr><td colSpan={3} className="text-[color:var(--muted-fg)] italic">Long List가 비어 있습니다 — 후보 기업을 추가하세요 (Target Universe → Long List).</td></tr>
          ) : (
            targets.map((t) => {
              const isPrimary = primaryId === t.company_id;
              return (
                <tr key={t.id}>
                  <td className="font-semibold">
                    {t.company_name}
                    {isPrimary && <span className="status-chip status-green ml-1">주 대상</span>}
                  </td>
                  <td>
                    <span className={`status-chip ${t.role === "target" ? "status-in-progress" : "status-not-started"}`}>
                      {t.role === "target" ? "Short List" : "Long List"}
                    </span>
                  </td>
                  <td className="sizing-actions-cell">
                    {t.role === "candidate" && (
                      <button type="button" className="btn-ghost text-[0.75rem]" disabled={busy}
                        onClick={() => act({ action: "promote_to_shortlist", company_id: t.company_id })}>
                        Short List 추가
                      </button>
                    )}
                    {!isPrimary && (
                      <button type="button" className="btn-ghost text-[0.75rem] sizing-rerun-btn" disabled={busy}
                        title="주 대상으로 지정 — 이후 DD·투자심사가 이 기업으로 진행됩니다."
                        onClick={() => act({ action: "set_primary", company_id: t.company_id })}>
                        주 대상 지정
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <p className="sizing-note-list mt-2 text-[0.75rem] text-[color:var(--muted-fg)]">
        Target Universe → Long List → 스크리닝(전략적 적합성·역량·재무·소유구조·규제) → Short List →
        주 대상 지정 순으로 좁힙니다. 주 대상이 지정되면 이후 DD·투자심사가 해당 기업으로 진행됩니다.
      </p>
      {shortList.length > 0 && (
        <p className="sizing-note-list text-[0.78rem]">Short List: {shortList.map((s) => s.company_name).join(", ")}</p>
      )}
    </div>
  );
}
