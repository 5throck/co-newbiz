"use client";

// S2 기회 발굴 본문 — ADR-0120 Wave 2 Phase A 추출(/opportunities 페이지와
// /deals/[id]/s2 탭이 동일 컴포넌트를 소비한다). StageFrame과 main 셸은 호출자가
// 제공한다(공통 규칙 #6). opportunityId가 주어지면(deals 탭 진입) 퍼널에서 해당
// 기회 행을 표시한다 — 검토/안건의 캐리어가 어떤 기회인지 목록에서 바로 보이게.
//
// 레이아웃 원칙(ADR-0127): 목록 행은 경량 퍼널(상태·점수·대표 액션)로 유지하고,
// 평가·요인·비즈니스 모델 검토 작업은 상세 화면(/opportunities/{id})에서 한다.
// 행 액션은 선별·제외·비즈니스 모델 검토·삭제만 둔다. S3 시너지·전략적 적합성은
// 상세 화면에서 S3 화면(/synergy)으로 이동하는 링크로 안내한다.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ReviewBuckets } from "../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../lib/review/stage-artifact-labels.ts";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../lib/project-write-access.ts";
import { useConfirm } from "../crud.tsx";
import { SectionToolbar } from "../layout.tsx";

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
  synergy_score_confirmed_at: string | null;
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
  escalated_cagr_pct: number | null;
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

/**
 * 행 액션 — 매력도 평가(입력 있는 실제 평가 UI)·S3 시너지·적합성 평가·선별
 * 승격·비즈니스 모델 검토는 모두 상세 화면(/opportunities/{id})과 그 안에서
 * 이어지는 /synergy(S4로 진행 버튼, 시너지 근거 포함 승격)에서만 이루어진다.
 * 목록의 상태 전환 단축 버튼(구 "매력도 평가"/"선별"/"제외")은 실제 평가
 * 없이 상태만 바꾸는 중복 경로였다 — 제거하고 상세 화면 링크 하나로 통일
 * (삭제는 별도 셀, ADR-0127).
 */
function nextStepActions(o: OpportunityRow) {
  return (
    <Link className="btn-ghost btn-sm" href={`/opportunities/${encodeURIComponent(o.id)}?tab=sketch`} title="상세 화면의 비즈니스 모델 검토 탭으로 이동합니다">
      비즈니스 모델 검토
    </Link>
  );
}

export function OpportunityFunnelStage({ opportunityId }: { opportunityId?: string }) {
  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);
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

  // ?status= 딥링크는 유지 (?opportunity= 펼침은 상세 화면 분리로 폐지 — ADR-0127)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("status");
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
    <>
      {confirmDialog}
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {opportunityId && <ReviewBuckets entityType="opportunity" entityId={opportunityId} artifacts={stageArtifactTabs("S2")} />}

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
                  {s.escalated_cagr_pct !== null && <span title="에스컬레이션 조정 CAGR (외부 참조 × 0.85 — 사람 결정)"> · 에스컬레이션 {s.escalated_cagr_pct}%</span>}
                  {s.external_forecast?.gap_pct != null ? ` · 격차 ${s.external_forecast.gap_pct > 0 ? "+" : ""}${s.external_forecast.gap_pct}%` : ""}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
            완료된 시장분석이 없습니다.{" "}
            <Link
              href={opportunityId ? `/deals/${encodeURIComponent(opportunityId)}/s1` : "/market"}
              className="text-[color:var(--accent)] underline"
            >
              시장분석(S1)
            </Link>
            에서 산업을 먼저 분석하세요.
          </p>
        )}

        {/* 선택 산업: 발굴 버튼 + 요약 인사이트 (접힘) */}
        {selectedInsight && (
          <div className="sizing-new-form mt-3">
            {/* CAGR·격차는 위 칩에 이미 표시된다 — 선택된 산업명만 다시
                밝혀 어느 칩을 눌렀는지 스크롤 후에도 알 수 있게 한다. */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <strong className="text-[0.85rem]">{selectedInsight.industry_name}</strong>
              {canAct && <button
                type="button"
                className="btn-primary btn-sm"
                style={{ marginLeft: "auto" }} /* lint-exempt: 폼 내부 헤더(SectionToolbar 외부 컨텍스트) */
                disabled={discovering !== null}
                title="시장분석 근거(기회 요인·드라이버·격차 분석)에서 기회 후보를 자동 발굴하고, 기회/위험 요인도 함께 도출합니다"
                onClick={() => discoverOpportunities(selectedInsight.industry_name)}
              >
                {discovering === selectedInsight.industry_name ? "기회 발굴 중..." : "기회 발굴 (요인 자동 도출)"}
              </button>}
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
            {canAct && (
            <button type="button" className="btn-primary btn-sm whitespace-nowrap" onClick={() => setShowCreateForm((v) => !v)} aria-expanded={showCreateForm}>
              ＋ 기회 등록
            </button>
            )}
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
          <table className="data-table list-table" aria-label="기회 퍼널 목록">
            <caption className="sr-only">기회 퍼널 목록</caption>
            <thead>
              <tr>
                <th scope="col" className="w-[6rem]">상태</th>
                {/* 기회명은 유일한 무제한 열 — .list-table 고정 레이아웃에서 나머지
                    폭을 흡수하지만 테이블 최대 폭(64rem) 안에서 유지된다. */}
                <th scope="col">기회명</th>
                <th scope="col" className="w-[6rem]">매력도</th>
                <th scope="col" className="w-[7rem]">시너지</th>
                <th scope="col" className="w-[13rem]"><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((o) => (
                <tr key={o.id} aria-current={o.id === opportunityId ? "true" : undefined}>
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
                    {/* deals 탭에서 진입한 경우 — 이 검토/안건의 캐리어 기회를 표시 */}
                    {o.id === opportunityId && <span className="status-chip status-amber ml-1" title="이 검토/안건의 캐리어 기회입니다">이 안건</span>}
                    <span className="block text-[0.72rem]">
                      {o.market_scope && <span className="status-chip status-amber mr-1">{o.market_scope}</span>}
                      {o.value_chain_node && <span className="text-[color:var(--muted-fg)]">{o.value_chain_node}</span>}
                      {!o.market_scope && !o.value_chain_node && "—"}
                    </span>
                  </td>
                  <td className="tabular-nums">
                    {o.attractiveness_score ?? "—"}
                    {o.attractiveness_score !== null && o.status === "identified" && (
                      <span className="block text-[0.65rem] text-[color:var(--muted-fg)]">제안</span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {o.synergy_score ?? "—"}
                    {/* 경계 #2 — 파이프라인 권고와 사람 확정을 구분해 표시한다. */}
                    {o.synergy_score !== null && (
                      o.synergy_score_confirmed_at
                        ? <span className="block text-[0.65rem] text-[color:var(--muted-fg)]">확정</span>
                        : <span className="block text-[0.65rem] text-[color:var(--muted-fg)]">권고(미확정)</span>
                    )}
                  </td>
                  <td className="sizing-actions-cell"><span className="actions-row">
                    {nextStepActions(o)}
                    {canAct && !o.project_id && (
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
      {canAct && (
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
      )}
    </>
  );
}
