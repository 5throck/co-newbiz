"use client";

// /agents — 런타임 에이전트팀 질의 화면 (ADR-0128). 사용자는 PM 에이전트에게
// 질의하고, PM이 수행 에이전트(또는 체인)를 배정해 답변을 취합한다. 모든
// 응답은 제안 전용(proposal-only)이며 단계별 provenance가 함께 표시된다.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { ColGroup } from "../../components/ui.tsx";

// 표 열 비율(2026-10-11-table-column-sizing-system batch 2) — 에이전트 로스터와
// 체인 단계 기록 모두 본문 열(역할/요약)에 폭을 주고 좁은 칩·숫자 열은 균등 분할.
const AGENT_ROSTER_COL_PCT = [18, 18, 48, 16] as const;
const AGENT_STEPS_COL_PCT = [8, 16, 18, 44, 14] as const;

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
  const t = useTranslations("pages.agents");
  const tc = useTranslations("common");
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
      setError(err instanceof Error ? err.message : t("queryFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>{t("heading")}</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        {t("intro")}
      </p>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      <section aria-label={t("sectionAria")} className="market-section">
        <SectionToolbar title={t("toolbarTitle")} icon="" />
        <div className="sizing-new-form">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[length:var(--fs-caption)]" style={{ flex: "2 1 16rem" }}>
              <span className="block mb-1">{t("lblQuery")}</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
                placeholder={t("phQuery")}
                className="sizing-new-input w-full"
              />
            </label>
            <label className="text-[length:var(--fs-caption)]" style={{ flex: "1 1 12rem" }}>
              <span className="block mb-1">{t("lblOpp")}</span>
              <select value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} className="sizing-new-input w-full">
                <option value="">{t("optNone")}</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-primary" disabled={busy || !query.trim()} onClick={() => void ask()}>
              {busy ? t("busyBtn") : t("askBtn")}
            </button>
          </div>
        </div>

        {busy && <p role="status" className="text-[length:var(--fs-body)] mt-2">{t("busyStatus")}</p>}

        {result && (
          <div className="sizing-grade-card mt-3">
            <div className="flex flex-wrap items-center gap-1 mb-2">
              <span className={`status-chip ${result.mode === "chain" ? "status-in-progress" : "status-green"}`}>
                {result.mode === "chain" ? t("chipChain") : t("chipAssigned", { agent: result.agentKey ?? "" })}
              </span>
              {result.task && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{result.task}</span>}
              {result.classifiedBy && <span className="status-chip status-not-started">{result.classifiedBy === "llm" ? t("chipLlmClassified") : t("chipRuleClassified")}</span>}
              <span className="status-chip status-amber">{t("chipProposalOnly")}</span>
            </div>
            {result.steps && result.steps.length > 0 && (
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table mb-2 table-fixed-pct tmin-48" aria-label={t("stepsTableAria")}>
                <caption className="sr-only">{t("stepsTableAria")}</caption>
                <ColGroup widths={AGENT_STEPS_COL_PCT} />
                <thead>
                  <tr><th scope="col">{tc("stage")}</th><th scope="col">{t("thAgent")}</th><th scope="col">{t("thPurpose")}</th><th scope="col">{t("thSummary")}</th><th scope="col">{tc("source")}</th></tr>
                </thead>
                <tbody>
                  {result.steps.map((s) => (
                    <tr key={s.step}>
                      <td className="tabular-nums">{s.step}</td>
                      <td>{s.agentKey}</td>
                      <td>{s.purpose}</td>
                      <td className="cell-truncate text-[length:var(--fs-caption)]">{s.summary}</td>
                      <td>{s.source === "llm" ? t("srcLlm") : t("srcDeterministic")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
            <p className="text-[length:var(--fs-body)] mb-0" style={{ whiteSpace: "pre-line" }}>{result.answer}</p>
          </div>
        )}
      </section>

      <section aria-label={t("rosterTitle")} className="market-section">
        <SectionToolbar title={t("rosterTitle")} icon="" count={roster?.length ?? 0} />
        {roster === null ? (
          <p>{tc("loading")}</p>
        ) : roster.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">{t("rosterLoadFailed")}</p>
        ) : (
          <details>
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("rosterSummary", { count: roster.length })}</summary>
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table mt-2 table-fixed-pct tmin-40" aria-label={t("rosterTitle")}>
              <caption className="sr-only">{t("rosterTitle")}</caption>
              <ColGroup widths={AGENT_ROSTER_COL_PCT} />
              <thead><tr><th scope="col">{t("thKey")}</th><th scope="col">{t("thName")}</th><th scope="col">{t("thRole")}</th><th scope="col">{t("thDomain")}</th></tr></thead>
              <tbody>
                {roster.map((a) => (
                  <tr key={a.key}>
                    <td><code className="dd-item-id">{a.key}</code></td>
                    <td className="font-semibold">{a.name}</td>
                    <td className="cell-truncate text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{a.role}</td>
                    <td>{a.domain ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
