"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api.ts";
import { StageFrame } from "../../../../components/StageFrame.tsx";

// 프로젝트 파이프라인 — D1/D2 (ADR-0104): 선발된 모든 프로젝트의 S8~S11 퍼널
// 스냅샷 + HOLD/kill 게이트 에이징. 읽기 전용 화면 — 결정 기록은 각 게이트
// 표면(IC 심의 등)에서 인간이 수행한다 (경계 #2).

interface PipelineProject {
  projectId: string;
  projectNo: string;
  projectName: string | null;
  track: string | null;
  currentStage: string | null;
  nextStage: string | null;
  gates: Record<string, string>;
  blockers: string[];
}
interface AgingRow {
  entityType: "opportunity" | "project";
  entityId: string;
  label: string;
  gate: string;
  decision: string;
  decidedAt: string;
  ageDays: number;
}
interface PipelineView {
  projects: PipelineProject[];
  aging: AgingRow[];
}

const GATE_CHIP: Record<string, { label: string; cls: string }> = {
  go: { label: "GO", cls: "status-green" },
  hold: { label: "HOLD", cls: "status-amber" },
  kill: { label: "KILL", cls: "status-red" },
};

function gateChip(value: string | undefined) {
  if (!value) return <span className="status-chip status-not-started">미기록</span>;
  const meta = GATE_CHIP[value] ?? { label: value, cls: "status-not-started" };
  return <span className={`status-chip ${meta.cls}`}>{meta.label}</span>;
}

const GATES = ["fs", "dd", "entity_ic", "group_ic"] as const;

function PipelineViewInner() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<PipelineView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<PipelineView>("/api/portfolio/pipeline")
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "파이프라인을 불러오지 못했습니다."));
  }, []);

  useEffect(() => { load(); }, [load]);

  const aging = [...(data?.aging ?? [])].sort((a, b) => b.ageDays - a.ageDays);

  return (
    <main>
      <p className="text-[0.8rem] mb-2"><a className="text-[color:var(--accent)] underline" href={`/projects/${params.id}/process`}>프로세스 현황 →</a></p>
      <StageFrame stageId="S8" heading="프로젝트 파이프라인 — 퍼널 스냅샷 + 게이트 에이징">
        <p className="text-[0.82rem] text-[color:var(--muted-fg)] mb-2">
          선발된 모든 프로젝트의 현재 스테이지와 게이트 기록을 한눈에 보고, HOLD·KILL 상태로
          머물러 있는 결정의 경과일을 추적합니다 (D1/D2). 읽기 전용 — 게이트 결정 기록은 각 심의 표면에서 수행합니다.
        </p>

        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem] mb-2">✕ {error}</p>}
        {!data && !error && <p className="text-[0.82rem]">불러오는 중...</p>}

        {data && (
          <>
            <section className="market-section sizing-step" aria-label="프로젝트 퍼널">
              <h3 className="sizing-step-title text-[0.9rem]">프로젝트 퍼널 (D1)</h3>
              {data.projects.length === 0 ? (
                <p className="text-[0.82rem] text-[color:var(--muted-fg)]">표시 가능한 프로젝트가 없습니다.</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table" aria-label="프로젝트 퍼널">
                    <caption className="sr-only">프로젝트 퍼널 — 스테이지 및 게이트 스냅샷</caption>
                    <thead>
                      <tr>
                        <th scope="col">프로젝트</th>
                        <th scope="col">트랙</th>
                        <th scope="col">현재</th>
                        <th scope="col">다음</th>
                        {GATES.map((g) => <th scope="col" key={g}>{g}</th>)}
                        <th scope="col">블로커</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.projects.map((p) => (
                        <tr key={p.projectId}>
                          <td className="text-[0.8rem]">
                            <a className="text-[color:var(--accent)] underline" href={`/projects/${p.projectId}/process`}>
                              <span className="tabular-nums text-[0.72rem] text-[color:var(--muted-fg)] mr-1">{p.projectNo}</span>
                              {p.projectName ?? p.projectNo}
                            </a>
                          </td>
                          <td>{p.track ? <span className={`status-chip ${p.track === "brownfield" ? "status-amber" : "status-green"}`}>{p.track}</span> : <span className="status-chip status-not-started">미결정</span>}</td>
                          <td><span className="status-chip status-not-started">{p.currentStage ?? "—"}</span></td>
                          <td className="text-[0.78rem]">{p.nextStage ?? "—"}</td>
                          {GATES.map((g) => <td key={g}>{gateChip(p.gates[g])}</td>)}
                          <td className="text-[0.75rem]">
                            {p.blockers.length === 0 ? "—" : (
                              <ul className="sizing-note-list m-0">
                                {p.blockers.map((b, i) => <li key={i}>{b}</li>)}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="market-section sizing-step mt-3" aria-label="게이트 에이징">
              <h3 className="sizing-step-title text-[0.9rem]">게이트 에이징 (D2) — HOLD·KILL 경과</h3>
              {aging.length === 0 ? (
                <p className="text-[0.82rem] text-[color:var(--muted-fg)]">에이징 중인 HOLD·KILL 게이트가 없습니다.</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table" aria-label="게이트 에이징">
                    <caption className="sr-only">게이트 에이징 — 경과일 내림차순</caption>
                    <thead>
                      <tr>
                        <th scope="col">대상</th>
                        <th scope="col">게이트</th>
                        <th scope="col">결정</th>
                        <th scope="col">결정일</th>
                        <th scope="col">경과일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aging.map((r) => (
                        <tr key={`${r.entityType}:${r.entityId}:${r.gate}`}>
                          <td className="text-[0.8rem]">{r.label}</td>
                          <td className="tabular-nums text-[0.78rem]">{r.gate}</td>
                          <td>
                            <span className={`status-chip ${r.decision === "kill" ? "status-red" : "status-amber"}`}>
                              {r.decision.toUpperCase()}
                            </span>
                          </td>
                          <td className="text-[0.75rem] tabular-nums">{r.decidedAt.slice(0, 10)}</td>
                          <td className="tabular-nums text-[0.8rem]">{r.ageDays}일</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </StageFrame>
    </main>
  );
}

export default function PipelinePage() {
  return (
    <Suspense fallback={null}>
      <PipelineViewInner />
    </Suspense>
  );
}
