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
}

export function OpportunitiesView() {
  const router = useRouter();
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState<SizingInsight[] | null>(null);
  // S3 진입(사이드바 "적합성 평가") 지원 — ?status=assessed로 열린다.
  const [statusFilter, setStatusFilter] = useState<OpportunityRow["status"] | "">("");
  const [form, setForm] = useState({ name: "", market_scope: "", value_chain_node: "", market_size_krw_m: "", growth_rate: "", attractiveness_score: "" });
  const [promoteFor, setPromoteFor] = useState<string | null>(null);
  const [projectNo, setProjectNo] = useState("");

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
      const res = await api.post<{ project_id: string }>(`/api/opportunities/${id}/promote`, { project_no: projectNo });
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
        (프로세스 스테이지 S2 — docs/process-flow.md).
      </p>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}

      {/* ── S1 시장분석 인사이트: 성장률 + 외부 전망 대비 격차(드라이버 요인) ── */}
      {insights !== null && insights.length > 0 && (
        <section aria-label="시장분석 인사이트" className="market-section sizing-step mb-4">
          <h2 className="text-[0.92rem] mb-1">🔬 시장분석 인사이트 (S1 → S2)</h2>
          <p className="mb-2 text-[0.75rem] text-[color:var(--muted-fg)]">
            완료된 산업 분석의 성장률과, 외부 미래 전망이 우리 CAGR 외삽과 갈릴 때 그 격차를 만드는
            요인(신규·강화 드라이버)입니다. 기회의 성장률·매력도 평가 시 입력으로 사용하세요.
          </p>
          <table className="data-table sizing-insight-table" aria-label="시장분석 인사이트">
            <caption className="sr-only">시장분석 인사이트</caption>
            <thead>
              <tr>
                <th scope="col">산업</th>
                <th scope="col">우리 CAGR (바텀업)</th>
                <th scope="col">외부 전망 대비 격차</th>
                <th scope="col">신규·강화 드라이버 / 격차 요인</th>
              </tr>
            </thead>
            <tbody>
              {insights.map((s) => (
                <tr key={s.analysis_id}>
                  <td className="font-semibold">
                    {s.industry_name}
                    <br />
                    <Link href="/market" className="text-[0.72rem] text-[color:var(--accent)] underline">리포트 열기</Link>
                  </td>
                  <td className="tabular-nums">{s.bottom_up_cagr_pct !== null ? `${s.bottom_up_cagr_pct}%` : "—"}</td>
                  <td className="tabular-nums">
                    {s.external_forecast?.gap_pct != null ? (
                      <>
                        {s.external_forecast.gap_pct > 0 ? "+" : ""}{s.external_forecast.gap_pct}%
                        <br />
                        <span className="text-[0.7rem] text-[color:var(--muted-fg)]">
                          vs {s.external_forecast.source_label} ({s.external_forecast.target_year})
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-[0.78rem]">
                    {s.external_forecast ? (
                      <>
                        {s.external_forecast.new_drivers.length > 0 && (
                          <span className="mr-1">
                            {s.external_forecast.new_drivers.map((d) => (
                              <span key={d} className="status-chip status-in-progress mr-1">{d}</span>
                            ))}
                          </span>
                        )}
                        {s.external_forecast.gap_analysis}
                      </>
                    ) : (
                      <span className="text-[color:var(--muted-fg)]">외부 전망 미입수 — CAGR 외삽 기준</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

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
