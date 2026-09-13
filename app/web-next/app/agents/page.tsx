"use client";

// /agents — 런타임 에이전트팀 질의 화면 (ADR-0128). 사용자는 PM 에이전트에게
// 질의하고, PM이 수행 에이전트(또는 체인)를 배정해 답변을 취합한다. 모든
// 응답은 제안 전용(proposal-only)이며 단계별 provenance가 함께 표시된다.
import { Suspense, useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";

interface AgentEntry { key: string; name: string; role: string; domain: string | null }
interface StepResult { step: number; agentKey: string; purpose: string; summary: string; source: string }
interface QueryResult {
  mode: "single" | "chain";
  agentKey?: string;
  task?: string;
  answer: string;
  source?: string;
  classifiedBy?: string;
  steps?: StepResult[];
  proposalOnly: boolean;
}

export function AgentsView() {
  const [query, setQuery] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [opportunities, setOpportunities] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [roster, setRoster] = useState<AgentEntry[] | null>(null);

  const loadRoster = useCallback(() => {
    api.get<{ agents: AgentEntry[] }>("/api/agents/registry").then((r) => setRoster(r.data.agents)).catch(() => setRoster([]));
  }, []);
  useEffect(() => {
    loadRoster();
    api.get<Array<{ id: string; name: string }>>("/api/opportunities").then((r) => setOpportunities(r.data)).catch(() => setOpportunities([]));
  }, [loadRoster]);

  async function ask() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<QueryResult>("/api/agents/query", {
        query: query.trim(),
        opportunityId: opportunityId || undefined,
      });
      setResult(r.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "질의 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <StageFrame stageId="S2">
        PM 에이전트에게 질의하세요. PM이 질의를 분류해 적임 에이전트(또는 에이전트 체인)를 배정하고, 각 에이전트의 관점을 취합해 제안을 돌려줍니다.
        모든 응답은 제안 전용이며 최종 판단과 기록은 사람의 몫입니다. 기회를 연결하면 그 기회의 근거(요인·점수·판정)가 에이전트에게 함께 제공됩니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      <section aria-label="에이전트 질의" className="market-section">
        <SectionToolbar title="PM 에이전트에게 질의" icon="" />
        <div className="sizing-new-form">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[0.78rem]" style={{ flex: "2 1 16rem" }}>
              <span className="block mb-1">질의 *</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
                placeholder="예: 이 기회의 매력도와 리스크를 종합 평가해줘 / 규제 리스크 관점에서 봐줘"
                className="sizing-new-input w-full"
              />
            </label>
            <label className="text-[0.78rem]" style={{ flex: "1 1 12rem" }}>
              <span className="block mb-1">연결 기회 (선택 — 체인 평가에 필요)</span>
              <select value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} className="sizing-new-input w-full">
                <option value="">없음</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-primary" disabled={busy || !query.trim()} onClick={() => void ask()}>
              {busy ? "에이전트 실행 중..." : "질의"}
            </button>
          </div>
        </div>

        {busy && <p role="status" className="text-[0.85rem] mt-2">PM이 질의를 분류하고 에이전트를 배정하는 중입니다...</p>}

        {result && (
          <div className="sizing-grade-card mt-3">
            <div className="flex flex-wrap items-center gap-1 mb-2">
              <span className={`status-chip ${result.mode === "chain" ? "status-in-progress" : "status-green"}`}>
                {result.mode === "chain" ? "에이전트 체인" : `${result.agentKey} 배정`}
              </span>
              {result.task && <span className="text-[0.75rem] text-[color:var(--muted-fg)]">{result.task}</span>}
              {result.classifiedBy && <span className="status-chip status-not-started">{result.classifiedBy === "llm" ? "PM LLM 분류" : "규칙 분류"}</span>}
              <span className="status-chip status-amber">제안 전용</span>
            </div>
            {result.steps && result.steps.length > 0 && (
              <table className="data-table mb-2" aria-label="체인 단계별 실행 기록">
                <caption className="sr-only">체인 단계별 실행 기록</caption>
                <thead>
                  <tr><th scope="col">단계</th><th scope="col">에이전트</th><th scope="col">수행</th><th scope="col">요약</th><th scope="col">출처</th></tr>
                </thead>
                <tbody>
                  {result.steps.map((s) => (
                    <tr key={s.step}>
                      <td className="tabular-nums">{s.step}</td>
                      <td>{s.agentKey}</td>
                      <td>{s.purpose}</td>
                      <td className="text-[0.78rem]">{s.summary}</td>
                      <td>{s.source === "llm" ? "LLM" : "결정론"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[0.85rem] mb-0" style={{ whiteSpace: "pre-line" }}>{result.answer}</p>
          </div>
        )}
      </section>

      <section aria-label="에이전트 로스터" className="market-section">
        <SectionToolbar title="에이전트 로스터" icon="" count={roster?.length ?? 0} />
        {roster === null ? (
          <p>불러오는 중...</p>
        ) : roster.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">로스터를 불러오지 못했습니다.</p>
        ) : (
          <details>
            <summary className="cursor-pointer text-[0.8rem] text-[color:var(--accent)]">배정 가능 에이전트 {roster.length}건 보기</summary>
            <table className="data-table mt-2" aria-label="에이전트 로스터">
              <caption className="sr-only">에이전트 로스터</caption>
              <thead><tr><th scope="col">키</th><th scope="col">이름</th><th scope="col">역할</th><th scope="col">도메인</th></tr></thead>
              <tbody>
                {roster.map((a) => (
                  <tr key={a.key}>
                    <td><code className="dd-item-id">{a.key}</code></td>
                    <td className="font-semibold">{a.name}</td>
                    <td className="text-[0.75rem] text-[color:var(--muted-fg)]">{a.role}</td>
                    <td>{a.domain ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>
    </main>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentsView />
    </Suspense>
  );
}
