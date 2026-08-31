"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api.ts";

// 기회 발굴 (/opportunities) — S2 기회 레지스트리의 퍼널 보드. 시장분석(S1)에서
// 발굴한 기회를 identified → assessed → selected/dropped로 진행하고, selected
// 기회를 딜(Project)로 승격한다(docs/process-flow.md §3 S2, 불변식 #2:
// Opportunity ≠ Project — project_id는 승격 전까지 NULL).

interface OpportunityRow {
  id: string;
  project_id: string | null;
  name: string;
  market_scope: string | null;
  value_chain_node: string | null;
  market_size_krw_m: number | null;
  growth_rate: number | null;
  attractiveness_score: number | null;
  synergy_score: number | null;
  status: "identified" | "assessed" | "selected" | "dropped";
  rationale: string | null;
  created_by: string;
  created_at: string;
}

const COLUMNS: Array<{ status: OpportunityRow["status"]; label: string }> = [
  { status: "identified", label: "발굴" },
  { status: "assessed", label: "평가" },
  { status: "selected", label: "선별" },
  { status: "dropped", label: "drop" },
];

const nf = new Intl.NumberFormat("ko-KR");

// S1 시장분석에서 넘어온 인사이트 — 성장률과 외부 전망 대비 격차(신규
// 드라이버 포함)를 기회 평가의 입력으로 제공한다(market-sizing 5-B).
interface SizingInsight {
  analysis_id: string;
  industry_name: string;
  completed_at: string | null;
  bottom_up_cagr_pct: number | null;
  external_forecast: {
    source_label: string;
    target_year: number;
    external_size_b: number;
    our_size_b: number | null;
    gap_pct: number | null;
    gap_analysis: string | null;
    new_drivers: string[];
  } | null;
  opportunity_factors: string[];
  risk_factors: string[];
  chain_direction: { position?: string; note?: string; relatedIndustries?: Array<{ relation?: string; name?: string; note?: string }> } | null;
}

export function OpportunitiesView() {
  const router = useRouter();
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState<SizingInsight[] | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  // S3 진입(사이드바 "적합성 평가") 지원 — ?status=assessed로 열린다.
  const [statusFilter, setStatusFilter] = useState<OpportunityRow["status"] | "">("");
  const [form, setForm] = useState({ name: "", market_scope: "", value_chain_node: "", market_size_krw_m: "", growth_rate: "", attractiveness_score: "" });
  const [promoteFor, setPromoteFor] = useState<string | null>(null);
  const [projectNo, setProjectNo] = useState("");
  const [promoteCompany, setPromoteCompany] = useState("");

  const load = useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    api.get<OpportunityRow[]>(`/api/opportunities${qs}`).then((r) => setRows(r.data)).catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [statusFilter]);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("status");
    if (initial && ["identified", "assessed", "selected", "dropped"].includes(initial)) {
      setStatusFilter(initial as OpportunityRow["status"]);
    }
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    api.get<{ insights: SizingInsight[] }>("/api/market-overview/insights").then((r) => setInsights(r.data.insights)).catch(() => setInsights([]));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/opportunities", {
        name: form.name,
        market_scope: form.market_scope || undefined,
        value_chain_node: form.value_chain_node || undefined,
        market_size_krw_m: form.market_size_krw_m ? Number(form.market_size_krw_m) : undefined,
        growth_rate: form.growth_rate ? Number(form.growth_rate) : undefined,
        attractiveness_score: form.attractiveness_score ? Number(form.attractiveness_score) : undefined,
      });
      setForm({ name: "", market_scope: "", value_chain_node: "", market_size_krw_m: "", growth_rate: "", attractiveness_score: "" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: OpportunityRow["status"], synergy?: number) {
    setError(null);
    try {
      await api.put(`/api/opportunities/${id}`, {
        status,
        ...(synergy !== undefined ? { synergy_score: synergy } : {}),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "상태 변경 실패");
    }
  }

  async function promote(id: string) {
    setError(null);
    try {
      const res = await api.post<{ project_id: string }>(`/api/opportunities/${id}/promote`, { project_no: projectNo, company_name: promoteCompany });
      setPromoteFor(null);
      setProjectNo("");
      load();
      // navigate to the new deal
      router.push(`/projects/${res.data.project_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "승격 실패");
    }
  }

  return (
    <main>
      <h1>기회 발굴</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        시장분석(S1) 결과에서 가치사슬상 사업 기회를 발굴·평가하고, 선별된 기회를 딜로 승격합니다
        (프로세스 스테이지 S2 — docs/process-flow.md). 분석된 산업을 선택하면 그 시장의 인사이트가 열립니다.
      </p>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}

      {/* ── 분석된 산업 리스트 (시장분석과 동일한 select-then-insight 흐름) ── */}
      {insights !== null && insights.length > 0 && (
        <section aria-label="분석된 산업" className="market-section">
          <h2 className="text-[0.92rem] mb-2">🔬 분석된 산업 — 선택하면 시장 인사이트가 열립니다</h2>
          <div className="flex flex-wrap gap-2">
            {insights.map((s) => (
              <button
                key={s.analysis_id}
                type="button"
                aria-pressed={selectedIndustry === s.industry_name}
                className={`sizing-industry-chip ${selectedIndustry === s.industry_name ? "sizing-industry-chip-active" : ""}`}
                onClick={() => setSelectedIndustry(selectedIndustry === s.industry_name ? null : s.industry_name)}
              >
                <span className="font-semibold">{s.industry_name}</span>
                <span className="sizing-chip-meta">
                  CAGR {s.bottom_up_cagr_pct !== null ? `${s.bottom_up_cagr_pct}%` : "—"}
                  {s.external_forecast?.gap_pct != null ? ` · 격차 ${s.external_forecast.gap_pct > 0 ? "+" : ""}${s.external_forecast.gap_pct}%` : ""}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── 선택된 산업의 시장 인사이트 (정량 + 정성) ── */}
      {insights !== null && selectedIndustry && (() => {
        const sel = insights.find((s) => s.industry_name === selectedIndustry);
        if (!sel) return null;
        return (
          <section aria-label="선택 산업 시장 인사이트" className="market-section sizing-step sizing-step-deep">
            <h2 className="text-[0.95rem] mb-1">📊 {sel.industry_name} 시장 인사이트</h2>
            <p className="mb-3 text-[0.75rem] text-[color:var(--muted-fg)]">
              정량 지표(성장률·외부 전망 대비 격차)와 정성 분석(기회·위험 요인)을 함께 제공합니다 —
              기회 등록 시 성장률·매력도 평가의 근거로 사용하세요.
            </p>
            <div className="chart-pair">
              <div className="chart-half sizing-grade-card">
                <h4 className="text-[0.85rem] mb-2">📈 정량 인사이트</h4>
                <ul className="sizing-note-list">
                  <li>바텀업 CAGR: <strong>{sel.bottom_up_cagr_pct !== null ? `${sel.bottom_up_cagr_pct}%` : "—"}</strong></li>
                  {sel.external_forecast ? (
                    <>
                      <li>외부 전망: ${sel.external_forecast.external_size_b.toFixed(2)}B @ {sel.external_forecast.target_year} ({sel.external_forecast.source_label})</li>
                      <li>격차: <strong>{sel.external_forecast.gap_pct !== null ? `${sel.external_forecast.gap_pct > 0 ? "+" : ""}${sel.external_forecast.gap_pct}%` : "—"}</strong> (우리 추정 ${sel.external_forecast.our_size_b?.toFixed(2) ?? "—"}B)</li>
                    </>
                  ) : (
                    <li className="text-[color:var(--muted-fg)]">외부 전망 미입수 — CAGR 외삽 기준</li>
                  )}
                </ul>
                {sel.external_forecast?.gap_analysis && (
                  <p className="mt-2 mb-0 text-[0.78rem] whitespace-pre-line">{sel.external_forecast.gap_analysis}</p>
                )}
              </div>
              <div className="chart-half">
                <div className="sizing-grade-card mb-3">
                  <h4 className="text-[0.85rem] mb-2">✅ 기회 요인</h4>
                  <ul className="sizing-note-list">
                    {(sel.opportunity_factors.length ? sel.opportunity_factors : ["분석 보완 필요"]).map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
                <div className="sizing-grade-card">
                  <h4 className="text-[0.85rem] mb-2">⚠️ 위험 요인</h4>
                  <ul className="sizing-note-list">
                    {(sel.risk_factors.length ? sel.risk_factors : ["분석 보완 필요"]).map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      <details className="opportunity-create">
        <summary className="btn-ghost">+ 기회 등록</summary>
        <form onSubmit={create} aria-label="기회 등록" className="opportunity-form">
          <input type="text" aria-label="기회명" placeholder="기회명 (예: 조선용 고향압 프레스 부품)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input type="text" aria-label="시장 범위" placeholder="시장 범위" value={form.market_scope} onChange={(e) => setForm({ ...form, market_scope: e.target.value })} />
          <input type="text" aria-label="가치사슬 노드" placeholder="가치사슬 노드" value={form.value_chain_node} onChange={(e) => setForm({ ...form, value_chain_node: e.target.value })} />
          <input type="number" aria-label="시장 규모 (KRM)" placeholder="시장규모 KRM" value={form.market_size_krw_m} onChange={(e) => setForm({ ...form, market_size_krw_m: e.target.value })} />
          <input type="number" step="0.1" aria-label="성장률 (%)" placeholder="성장률 %" value={form.growth_rate} onChange={(e) => setForm({ ...form, growth_rate: e.target.value })} />
          <input type="number" min={0} max={100} aria-label="매력도 (0-100)" placeholder="매력도 0-100" value={form.attractiveness_score} onChange={(e) => setForm({ ...form, attractiveness_score: e.target.value })} />
          <button type="submit" className="btn-premium" disabled={busy}>
            등록
          </button>
        </form>
      </details>

      {rows === null ? (
        <p>불러오는 중...</p>
      ) : (
        <div className="funnel-board" role="list" aria-label="기회 발굴">
          {COLUMNS.map(({ status, label }) => {
            const col = rows.filter((r) => r.status === status);
            return (
              <div key={status} className="funnel-column" role="listitem">
                <h2 className="funnel-column-title">
                  {label} <span className="funnel-count">{col.length}</span>
                </h2>
                <ul className="funnel-cards">
                  {col.map((o) => (
                    <li key={o.id} className="funnel-card">
                      <strong className="funnel-card-name">{o.name}</strong>
                      <p className="funnel-card-meta">
                        {[o.market_scope, o.value_chain_node].filter(Boolean).join(" · ") || "—"}
                      </p>
                      <p className="funnel-card-meta tabular-nums">
                        {o.market_size_krw_m !== null ? `규모 ${nf.format(o.market_size_krw_m)} KRM` : "규모 —"}
                        {o.growth_rate !== null ? ` · 성장 ${o.growth_rate}%` : ""}
                      </p>
                      <p className="funnel-card-scores tabular-nums">
                        매력도 {o.attractiveness_score ?? "—"} · 시너지 {o.synergy_score ?? "—"}
                      </p>
                      {o.rationale && <p className="funnel-card-rationale">{o.rationale}</p>}
                      <div className="funnel-card-actions">
                        {status === "identified" && (
                          <button type="button" className="btn-ghost" onClick={() => setStatus(o.id, "assessed")}>
                            평가로 이동
                          </button>
                        )}
                        {status === "assessed" && (
                          <>
                            <button type="button" className="btn-ghost" onClick={() => setStatus(o.id, "selected", o.synergy_score ?? o.attractiveness_score ?? 50)}>
                              선별
                            </button>
                            <button type="button" className="btn-ghost" onClick={() => setStatus(o.id, "dropped", o.synergy_score ?? o.attractiveness_score ?? 50)}>
                              제외
                            </button>
                          </>
                        )}
                        {status === "selected" && !o.project_id && (
                          promoteFor === o.id ? (
                            <span className="flex gap-1">
                              <input type="text" aria-label="새 딜 번호" placeholder="딜 번호 (예: P-2026-001)" value={projectNo} onChange={(e) => setProjectNo(e.target.value)} />
                              <input type="text" aria-label="대상 회사명" placeholder="대상 회사명 (필수)" value={promoteCompany} onChange={(e) => setPromoteCompany(e.target.value)} />
                              <button type="button" className="btn-premium" onClick={() => promote(o.id)}>
                                승격
                              </button>
                            </span>
                          ) : (
                            <button type="button" className="btn-premium" onClick={() => { setPromoteFor(o.id); setProjectNo(""); }}>
                              딜로 승격
                            </button>
                          )
                        )}
                        {o.project_id && (
                          <Link href={`/projects/${o.project_id}`} className="text-[color:var(--accent)] underline text-[0.8rem]">
                            딜 열기 →
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                  {col.length === 0 && <li className="funnel-empty">—</li>}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

export default OpportunitiesView;
