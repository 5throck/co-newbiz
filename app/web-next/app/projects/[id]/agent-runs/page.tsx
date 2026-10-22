"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState } from "../../../../components/ui.tsx";

// 실행 타임라인 6열 — 시각·단계·유형·상태는 좁게, 활동 id에 넉넉한 몫.
const AGENT_RUN_COL_PCT = [18, 12, 28, 12, 14, 16] as const;

// 에이전트 실행 이력 (ADR-0123 #1) — 어떤 에이전트가 언제 무엇을 실행/제안했는지
// 타임라인으로 추적한다. 읽기 전용 — 제안(PROPOSAL)과 사람 기록은 항상 구분된다.
interface Run {
  run_id: string; spec_version: string; stage: string; status: string; started_by: string;
  started_at: string; activity_id: string | null; activity_status: string | null; proposals: number;
}

function AgentRunsView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ runs: Run[]; proposals: Array<{ id: string; gate: string; recommendation: string; started_at: string }>; reliability: Array<{ gate: string; total: number; accepted: number; agreement_pct: number }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ runs: Run[]; proposals: Array<{ id: string; gate: string; recommendation: string; started_at: string }>; reliability: Array<{ gate: string; total: number; accepted: number; agreement_pct: number }> }>(`/api/projects/${encodeURIComponent(id)}/agent-runs`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>에이전트 실행 이력</h1>
      <p className="objective">이 검토/안건에서 에이전트·AI가 실행한 활동과 제안을 추적합니다 — 제안과 사람 기록은 항상 구분됩니다.</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <section className="market-section" aria-label="실행 타임라인">
        <h2 className="text-[length:var(--fs-body)] mb-2">실행 타임라인</h2>
        {data === null ? <PageState state="loading" /> : data.runs.length === 0 ? (
          <PageState state="empty" emptyText="실행된 에이전트 활동이 없습니다." emptyAction={<Link href="/deals" className="text-[color:var(--accent)] underline not-italic">파이프라인 시작 →</Link>} />
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48" aria-label="실행 타임라인">
              <caption className="sr-only">에이전트 실행 타임라인</caption>
              <ColGroup widths={AGENT_RUN_COL_PCT} />
              <thead><tr><th>시각</th><th>단계</th><th>활동</th><th>유형</th><th>상태</th><th>실행자</th></tr></thead>
              <tbody>{data.runs.map((r, i) => (
                <tr key={`${r.run_id}-${i}`}>
                  <td className="text-[length:var(--fs-caption)] tabular-nums">{r.started_at.slice(0, 16).replace("T", " ")}</td>
                  <td><span className="status-chip status-not-started">{r.stage}</span></td>
                  <td className="text-[length:var(--fs-caption)]">{r.activity_id ?? "—"}</td>
                  <td>{r.activity_id ? <span className="status-chip status-gray">산출물</span> : <span className="chip gray">—</span>}</td>
                  <td>{r.activity_status ? <span className={`status-chip ${r.activity_status === "done" ? "status-green" : r.activity_status === "failed" ? "status-red" : "status-amber"}`}>{r.activity_status}</span> : "—"}</td>
                  <td className="text-[length:var(--fs-caption)]">{r.started_by}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <section className="market-section" aria-label="AI 신뢰도">
        <h2 className="text-[length:var(--fs-body)] mb-2">AI 추천 신뢰도 점수 <span className="note">— 제안 후 사람의 같은 의사결정과의 일치율 (표시 전용)</span></h2>
        {data === null ? <PageState state="loading" /> : data.reliability.length === 0 ? (
          <PageState state="empty" emptyText="아직 사람 결정과 비교할 제안이 없습니다." />
        ) : (
          <table className="data-table" aria-label="AI 신뢰도">
            <caption className="sr-only">AI 추천 신뢰도</caption>
            <thead><tr><th>진행</th><th className="col-num">제안</th><th className="col-num">수용</th><th className="col-num">일치율</th></tr></thead>
            <tbody>{data.reliability.map((r) => (
              <tr key={r.gate}>
                <td className="font-semibold">{r.gate}</td>
                <td className="col-num tabular-nums">{r.total}</td>
                <td className="col-num tabular-nums">{r.accepted}</td>
                <td className="col-num tabular-nums"><span className={`status-chip ${r.agreement_pct >= 70 ? "status-green" : "status-amber"}`}>{r.agreement_pct}%</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="note" style={{ marginBottom: 0 }}>일치율은 학습 신호일 뿐 진행 처리에 사용되지 않습니다 — 판단은 사람이 유지합니다.</p>
      </section>
      <section className="market-section" aria-label="제안 기록">
        <h2 className="text-[length:var(--fs-body)] mb-2">위원회 제안 기록</h2>
        {data === null ? <PageState state="loading" /> : data.proposals.length === 0 ? (
          <PageState state="empty" emptyText="기록된 위원회 제안이 없습니다." />
        ) : (
          <table className="data-table" aria-label="제안">
            <thead><tr><th>시각</th><th>진행</th><th>권고 (제안)</th></tr></thead>
            <tbody>{data.proposals.map((p) => (
              <tr key={p.id}>
                <td className="text-[length:var(--fs-caption)] tabular-nums">{p.started_at.slice(0, 16).replace("T", " ")}</td>
                <td>{p.gate}</td>
                <td><span className={`status-chip ${p.recommendation === "go" ? "status-green" : p.recommendation === "kill" ? "status-red" : "status-amber"}`}>{p.recommendation.toUpperCase()}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </main>
  );
}

export default function AgentRunsPage() {
  return <Suspense fallback={null}><AgentRunsView /></Suspense>;
}
