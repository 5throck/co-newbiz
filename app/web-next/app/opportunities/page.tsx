"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { useConfirm } from "../../components/crud.tsx";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";

// 기회 발굴 (/opportunities) — S2 기회 퍼널.
// 레이아웃 원칙(ADR-0127): 목록 행은 경량 퍼널(상태·점수·대표 액션)로 유지하고,
// 평가·요인·비즈니스 모델 검토 작업은 상세 화면(/opportunities/{id})에서 한다.
// 행 액션은 선별·제외·비즈니스 모델 검토·삭제만 둔다. S3 시너지·전략적 적합성은
// 상세 화면에서 S3 화면(/synergy)으로 이동하는 링크로 안내한다.

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
  synergy_rationale: string | null;
  fit_verdict: "Go" | "Hold" | "Kill" | null;
  fit_rationale: string | null;
  status: "identified" | "assessed" | "selected" | "dropped";
  rationale: string | null;
  created_by: string;
  created_at: string;
}

const COLUMNS: Array<{ status: OpportunityRow["status"]; label: string }> = [
  { status: "identified", label: "발굴" },
  { status: "assessed", label: "평가" },
  { status: "selected", label: "선별" },
  { status: "dropped", label: "제외" },
];

// S1 시장분석 인사이트 — 기회 발굴·평가의 입력(market-sizing 5-B).
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
}

type SetStatusFn = (id: string, status: OpportunityRow["status"], synergy?: number) => void;

/** 행 액션 — 평가(발굴→평가 진행)·선별·제외·비즈니스 모델 검토 (삭제는 별도 셀, ADR-0127). */
function nextStepActions(o: OpportunityRow, setStatus: SetStatusFn) {
  if (o.status === "identified") {
    // 매력도가 있으면 바로 평가 단계로 진행하고, 없으면 상세 화면의
    // 매력도 평가로 안내한다 — 발굴 단계가 퍼널 막힘 없이 흐르게 한다.
    return o.attractiveness_score !== null ? (
      <button type="button" className="btn-ghost btn-sm" onClick={() => setStatus(o.id, "assessed")}>매력도 평가</button>
    ) : (
      <Link className="btn-ghost btn-sm" href={`/opportunities/${encodeURIComponent(o.id)}`} title="상세 화면에서 매력도를 평가하면 평가 단계로 진행됩니다">매력도 평가 (미평가)</Link>
    );
  }
  if (o.status === "assessed") {
    // S3 경방 — 시너지 공식 + 적합성 판단이 있어야 선별/제외 가능
    const s3Ready = o.synergy_score !== null && o.fit_verdict !== null;
    const hint = !s3Ready ? "상세 화면에서 S3 시너지·적합성 평가를 먼저 진행하세요" : undefined;
    return (
      <>
        <button type="button" className="btn-ghost btn-sm" disabled={!s3Ready} title={hint} onClick={() => setStatus(o.id, "selected", o.synergy_score ?? o.attractiveness_score ?? 50)}>선별</button>
        <button type="button" className="btn-ghost btn-sm" disabled={!s3Ready} title={hint} onClick={() => setStatus(o.id, "dropped", o.synergy_score ?? o.attractiveness_score ?? 50)}>제외</button>
        <Link className="btn-ghost btn-sm" href={`/opportunities/${encodeURIComponent(o.id)}`} title="상세 화면에서 비즈니스 모델 검토를 봅니다">비즈니스 모델 검토</Link>
      </>
    );
  }
  if (o.status === "selected") {
    return (
      <Link className="btn-ghost btn-sm" href={`/opportunities/${encodeURIComponent(o.id)}`} title="상세 화면에서 비즈니스 모델 검토를 봅니다">비즈니스 모델 검토</Link>
    );
  }
  return <span className="text-[0.72rem] text-[color:var(--muted-fg)]">—</span>;
}

export function OpportunitiesView() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState<SizingInsight[] | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", market_scope: "", value_chain_node: "", attractiveness_score: "" });

  // KPI 클릭 = 상태 필터 (재클릭 해제)
  const [statusFilter, setStatusFilter] = useState<OpportunityRow["status"] | "">("");

  // S2 activities 상태 — 상세 작업은 /opportunities/{id} 화면으로 이동 (ADR-0127)
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"attractiveness" | "recent">("attractiveness");
  const [industryFilter, setIndustryFilter] = useState<string | "">("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [discoverNotice, setDiscoverNotice] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    api.get<OpportunityRow[]>(`/api/opportunities${qs}`).then((r) => setRows(r.data)).catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [statusFilter]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("status");
    // ?status= 딥링크는 유지 (?opportunity= 펼침은 상세 화면 분리로 폐지 — ADR-0127)
    if (initial && ["identified", "assessed", "selected", "dropped"].includes(initial)) {
      setStatusFilter(initial as OpportunityRow["status"]);
    }
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    api.get<{ insights: SizingInsight[] }>("/api/market-overview/insights").then((r) => setInsights(r.data.insights)).catch(() => setInsights([]));
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  searchParams; // ?status= 진입은 window.location.search로 처리됨

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/opportunities", {
        name: form.name,
        market_scope: form.market_scope || undefined,
        value_chain_node: form.value_chain_node || undefined,
        attractiveness_score: form.attractiveness_score ? Number(form.attractiveness_score) : undefined,
      });
      setForm({ name: "", market_scope: "", value_chain_node: "", attractiveness_score: "" });
      setShowCreateForm(false);
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

  // ── S2 activity: opportunity-discovery ──
  async function discoverOpportunities(industry: string) {
    if (discovering) return;
    setDiscovering(industry);
    setError(null);
    try {
      const res = await api.post<{ inserted: Array<{ name: string }>; source: string }>("/api/opportunities/discover", { industry });
      load();
      setDiscoverNotice(`기회 ${res.data.inserted.length}건이 발굴되었습니다 (${res.data.source === "llm" ? "LLM" : "결정론 합성"}${res.data.inserted.length ? `: ${res.data.inserted.map((o) => o.name).join(", ")}` : ""}). 기회/위험 요인도 자동 도출되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "기회 발굴 실패");
    } finally {
      setDiscovering(null);
    }
  }

  // 기회 삭제 — 테스트·오등록 정리용. 검토/안건으로 승격된 기회(project_id 연계)는
  // 서버에서도 차단되며, S4+ 단계 연계가 있으면 삭제가 거부된다.
  function deleteOpportunity(o: OpportunityRow) {
    confirm(
      `기회 "${o.name}" 삭제`,
      async () => {
        setError(null);
        try {
          await api.delete(`/api/opportunities/${o.id}`);
          setRows((prev) => (prev ? prev.filter((r) => r.id !== o.id) : prev));
        } catch (err) {
          setError(err instanceof Error ? err.message : "기회 삭제 실패");
        }
      },
      { body: "이 기회와 평가 요인이 함께 삭제되며 되돌릴 수 없습니다." },
    );
  }


  const counts = useMemo(() => {
    const c: Record<string, number> = { total: rows?.length ?? 0, identified: 0, assessed: 0, selected: 0, dropped: 0 };
    for (const r of rows ?? []) c[r.status]++;
    return c;
  }, [rows]);

  const industries = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) if (r.market_scope) set.add(r.market_scope);
    return [...set];
  }, [rows]);
  const sortedRows = useMemo(() => {
    const list = (rows ?? []).filter((r) => !industryFilter || r.market_scope === industryFilter);
    if (sortKey === "attractiveness") {
      list.sort((a, b) => (b.attractiveness_score ?? -1) - (a.attractiveness_score ?? -1));
    } else {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return list;
  }, [rows, sortKey, industryFilter]);

  const selectedInsight = insights?.find((s) => s.industry_name === selectedIndustry) ?? null;

  return (
    <main>
      {confirmDialog}
      <StageFrame stageId="S2">
        시장분석(S1) 산출물에서 기회를 발굴하고, 기회·위험 요인을 근거로 매력도를 평가합니다.
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── KPI 요약 (클릭 = 상태 필터) ── */}
      <div className="summary-cards mb-4">
        {([
          ["", "전체", counts.total],
          ["identified", "발굴", counts.identified],
          ["assessed", "평가", counts.assessed],
          ["selected", "선별", counts.selected],
          ["dropped", "제외", counts.dropped],
        ] as const).map(([key, label, count]) => (
          <button
            key={label}
            type="button"
            aria-pressed={statusFilter === key}
            className={`summary-card glass text-left ${statusFilter === key ? "border-[color:var(--accent)]" : ""}`}
            onClick={() => setStatusFilter(statusFilter === key || key === "" ? (key === "" ? "" : key as OpportunityRow["status"]) : key as OpportunityRow["status"])}
          >
            <span className="summary-value mono-num">{count}</span>
            <span className="text-label">{label}</span>
          </button>
        ))}
      </div>

      {discoverNotice && <p role="status" className="text-[color:var(--green-fg)] text-[0.85rem] mb-2">{discoverNotice}</p>}

      {/* ── 분석된 산업 (S1 연동, 접힘) ── */}
      <section aria-label="분석된 산업" className="market-section">
        <div className="section-toolbar"><span className="section-title"><h2>분석된 산업 — 선택해 기회 발굴</h2></span></div>
        {insights !== null && insights.length > 0 ? (
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
        ) : (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
            완료된 시장분석이 없습니다. <Link href="/market" className="text-[color:var(--accent)] underline">시장분석(S1)</Link>에서 산업을 먼저 분석하세요.
          </p>
        )}

        {/* 선택 산업: 발굴 버튼 + 요약 인사이트 (접힘) */}
        {selectedInsight && (
          <div className="sizing-new-form mt-3">
            {/* CAGR·격차는 위 칩에 이미 표시된다 — 선택된 산업명만 다시
                밝혀 어느 칩을 눌렀는지 스크롤 후에도 알 수 있게 한다. */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <strong className="text-[0.85rem]">{selectedInsight.industry_name}</strong>
              <button
                type="button"
                className="btn-ghost btn-sm"
                style={{ marginLeft: "auto" }} /* lint-exempt: 폼 내부 헤더(SectionToolbar 외부 컨텍스트) */
                disabled={discovering !== null}
                title="시장분석 근거(기회 요인·드라이버·격차 분석)에서 기회 후보를 자동 발굴하고, 기회/위험 요인도 함께 도출합니다"
                onClick={() => discoverOpportunities(selectedInsight.industry_name)}
              >
                {discovering === selectedInsight.industry_name ? "기회 발굴 중..." : "기회 발굴 (요인 자동 도출 포함)"}
              </button>
            </div>
            <details>
              <summary className="cursor-pointer text-[0.78rem] text-[color:var(--muted-fg)]">인사이트 상세 (기회·위험 요인, 격차 분석)</summary>
              <div className="chart-pair mt-2">
                <div className="chart-half sizing-grade-card">
                  <h4 className="text-[0.85rem] mb-2">✅ 기회 요인</h4>
                  <ul className="sizing-note-list">
                    {(selectedInsight.opportunity_factors.length ? selectedInsight.opportunity_factors : ["분석 보완 필요"]).map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
                <div className="chart-half sizing-grade-card">
                  <h4 className="text-[0.85rem] mb-2">위험 요인</h4>
                  <ul className="sizing-note-list">
                    {(selectedInsight.risk_factors.length ? selectedInsight.risk_factors : ["분석 보완 필요"]).map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                  {selectedInsight.external_forecast?.gap_analysis && (
                    <p className="mt-2 mb-0 text-[0.75rem] whitespace-pre-line">{selectedInsight.external_forecast.gap_analysis}</p>
                  )}
                </div>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* ── 기회 퍼널 (리스트 + 행 펼침 평가 패널) ── */}
      <section aria-label="기회 퍼널" className="market-section">
        <SectionToolbar
          title="기회 퍼널"
          icon=""
          count={sortedRows.length}
          filters={
            <>
              <span className="section-meta">
                {statusFilter ? `${COLUMNS.find((c) => c.status === statusFilter)?.label ?? statusFilter} 필터 · ` : ""}
              </span>
              <span role="group" aria-label="산업 필터" className="flex flex-wrap gap-1">
                <button
                  type="button"
                  aria-pressed={industryFilter === ""}
                  className={`control-chip ${industryFilter === "" ? "status-green" : "status-not-started"}`}
                  onClick={() => setIndustryFilter("")}
                >
                  전체 산업
                </button>
                {industries.map((ind) => (
                  <button
                    key={ind}
                    type="button"
                    aria-pressed={industryFilter === ind}
                    className={`control-chip ${industryFilter === ind ? "status-green" : "status-not-started"}`}
                    onClick={() => setIndustryFilter(ind)}
                  >
                    {ind}
                  </button>
                ))}
              </span>
            </>
          }
          actions={
            <>
            <button type="button" className="btn-primary btn-sm whitespace-nowrap" onClick={() => setShowCreateForm((v) => !v)} aria-expanded={showCreateForm}>
              ＋ 기회 등록
            </button>
            <span role="group" aria-label="정렬" className="flex gap-1">
              {([
                ["attractiveness", "매력도순"],
                ["recent", "최근 등록순"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={sortKey === key}
                  className={`control-chip ${sortKey === key ? "status-green" : "status-not-started"}`}
                  onClick={() => setSortKey(key)}
                >
                  {label}
                </button>
              ))}
            </span>
            </>
          }
        />
        {rows === null ? (
          <p>불러오는 중...</p>
        ) : sortedRows.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
            {statusFilter ? "필터 조건에 맞는 기회가 없습니다." : "등록된 기회가 없습니다 — 분석된 산업에서 기회 발굴을 시작하세요."}
          </p>
        ) : (
          <table className="data-table" aria-label="기회 퍼널 목록">
            <caption className="sr-only">기회 퍼널 목록</caption>
            <thead>
              <tr>
                <th scope="col" className="w-[5rem]">상태</th>
                <th scope="col">기회명</th>
                <th scope="col" className="w-[5rem]">매력도</th>
                <th scope="col" className="w-[5rem]">시너지</th>
                <th scope="col" className="w-[13rem]">다음 단계</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className={`status-chip ${o.status === "selected" ? "status-green" : o.status === "dropped" ? "status-red" : o.status === "assessed" ? "status-amber" : "status-not-started"}`}>
                      {COLUMNS.find((c) => c.status === o.status)?.label}
                    </span>
                  </td>
                  <td>
                    <Link
                      href={`/opportunities/${encodeURIComponent(o.id)}`}
                      className="font-semibold text-left underline-offset-2 hover:underline"
                      title="기회 상세 화면으로 이동합니다 (기회/위험 요인·비즈니스 모델 검토)"
                    >
                      {o.name}
                    </Link>
                    <span className="block text-[0.72rem]">
                      {o.market_scope && <span className="status-chip status-amber mr-1">{o.market_scope}</span>}
                      {o.value_chain_node && <span className="text-[color:var(--muted-fg)]">{o.value_chain_node}</span>}
                      {!o.market_scope && !o.value_chain_node && "—"}
                    </span>
                  </td>
                  <td className="tabular-nums">{o.attractiveness_score ?? "—"}</td>
                  <td className="tabular-nums">{o.synergy_score ?? "—"}</td>
                  <td className="sizing-actions-cell"><span className="actions-row">
                    {nextStepActions(o, setStatus)}
                    {!o.project_id && (
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        title="이 기회를 삭제합니다 (검토/안건으로 승격된 기회는 삭제할 수 없습니다)"
                        onClick={() => deleteOpportunity(o)}
                      >
                        삭제
                      </button>
                    )}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>


      {/* ── 수동 등록 (표준 토글 인라인 폼 — ADR-0083) ── */}
      <section aria-label="기회 수동 등록" className="market-section">
        <SectionToolbar
          title="기회 직접 등록"
          icon="✍️"
          actions={
            <button type="button" className="btn-ghost whitespace-nowrap" onClick={() => setShowCreateForm((v) => !v)} aria-expanded={showCreateForm}>
              ＋ 기회 직접 등록
            </button>
          }
        />
        {showCreateForm && (
          <form onSubmit={create} className="sizing-new-form mb-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[0.78rem]">
                <span className="block mb-1">기회명 *</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="sizing-new-input" />
              </label>
              <label className="text-[0.78rem]">
                <span className="block mb-1">시장 범위</span>
                <input value={form.market_scope} onChange={(e) => setForm({ ...form, market_scope: e.target.value })} className="sizing-new-input sizing-new-input-sm" />
              </label>
              <label className="text-[0.78rem]">
                <span className="block mb-1">가치사슬 노드</span>
                <input value={form.value_chain_node} onChange={(e) => setForm({ ...form, value_chain_node: e.target.value })} className="sizing-new-input sizing-new-input-sm" />
              </label>
              <label className="text-[0.78rem]">
                <span className="block mb-1">매력도 (0-100)</span>
                <input type="number" min={0} max={100} value={form.attractiveness_score} onChange={(e) => setForm({ ...form, attractiveness_score: e.target.value })} className="sizing-new-input sizing-new-input-sm" />
              </label>
              <button type="submit" className="btn-ghost" disabled={busy || !form.name.trim()}>
                {busy ? "등록 중..." : "등록"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowCreateForm(false)}>
                취소
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

export default function OpportunitiesPage() {
  return (
    <Suspense fallback={null}>
      <OpportunitiesView />
    </Suspense>
  );
}
