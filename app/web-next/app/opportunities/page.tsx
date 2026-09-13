"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { useConfirm } from "../../components/crud.tsx";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { SketchCanvas } from "../../components/SketchCanvas.tsx";
import { PromotionPanel } from "../../components/PromotionPanel.tsx";

// 기회 발굴 (/opportunities) — S2 기회 퍼널.
// 레이아웃 원칙: 요약(KPI)이 먼저, 상세는 접힘(details) — 산업·기회가 많아져도
// 스크롤 과부하 없이 주요 항목을 인지할 수 있다.
// 기회/위험 요인은 자동 도출(insight-synthesis) + 수동 등록 모두 지원하며,
// 매력도 평가는 요인 근거 위에서 이루어진다.
// S4 이후(트랙 결정·검토/안건 승격)는 flow.spec v2.0.0 재설계에 따라 재구축 예정.

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

const nf = new Intl.NumberFormat("ko-KR");

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

interface Sketch {
  customer?: string;
  valueProposition?: string;
  revenueModel?: string;
  requiredCapabilities?: string[];
  keyRisks?: string[];
  scenarios?: Array<{ name?: string; assumption?: string }>;
}

interface OppFactors {
  opportunity: string[];
  risk: string[];
}

type SetStatusFn = (id: string, status: OpportunityRow["status"], synergy?: number) => void;
type SketchMap = Record<string, { sketch: Sketch; source: string | null } | "loading">;

/** 상태별 다음 단계 액션 — 리스트의 "다음 단계" 셀에서 한 개만 노출한다. */
function nextStepActions(
  o: OpportunityRow,
  setStatus: SetStatusFn,
  showSketch: (id: string, force?: boolean) => void,
  sketchOf: SketchMap,
) {
  if (o.status === "identified") {
    return (
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={o.attractiveness_score === null}
        title={o.attractiveness_score === null ? "행을 펼쳐 매력도를 평가하세요" : undefined}
        onClick={() => setStatus(o.id, "assessed")}
      >
        평가로 이동
      </button>
    );
  }
  if (o.status === "assessed") {
    // S3 경방 — 시너지 공식 + 적합성 판단이 있어야 선별/제외 가능
    const s3Ready = o.synergy_score !== null && o.fit_verdict !== null;
    const hint = !s3Ready ? "행을 펼쳐 시너지 분석·전략적 적합성 평가를 실행하세요 (S3)" : undefined;
    return (
      <>
        <button type="button" className="btn-ghost btn-sm" disabled={!s3Ready} title={hint} onClick={() => setStatus(o.id, "selected", o.synergy_score ?? o.attractiveness_score ?? 50)}>선별</button>
        <button type="button" className="btn-ghost btn-sm" disabled={!s3Ready} title={hint} onClick={() => setStatus(o.id, "dropped", o.synergy_score ?? o.attractiveness_score ?? 50)}>제외</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => showSketch(o.id)} disabled={sketchOf[o.id] === "loading"}>
          {sketchOf[o.id] === "loading" ? "..." : "스케치"}
        </button>
      </>
    );
  }
  if (o.status === "selected") {
    return (
      <>
        {/* 선별 직후 다음 단계 — S4 진출방식 결정 화면으로 이어준다 (기회 선택 상태로 진입) */}
        <Link
          className="btn-ghost btn-sm"
          href={`/route-decision?opportunity=${encodeURIComponent(o.id)}`}
          title="진출방식 결정(S4) 화면으로 이동합니다"
        >
          S4 평가 진행
        </Link>
        <button type="button" className="btn-ghost btn-sm" onClick={() => showSketch(o.id)} disabled={sketchOf[o.id] === "loading"}>
          {sketchOf[o.id] === "loading" ? "..." : "스케치"}
        </button>
      </>
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

  // S2 activities 상태
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [attractDraft, setAttractDraft] = useState<Record<string, string>>({});
  const [sketchOf, setSketchOf] = useState<Record<string, { sketch: Sketch; source: string | null } | "loading">>({});
  const [factorsOf, setFactorsOf] = useState<Record<string, { factors: OppFactors; source: string | null } | "loading">>({});
  const [factorDraft, setFactorDraft] = useState<Record<string, { type: "opportunity" | "risk"; text: string }>>({});
  // S3 시너지·적합성 실행 상태
  const [screeningBusy, setScreeningBusy] = useState<Record<string, "synergy" | "fit">>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
    if (initial && ["identified", "assessed", "selected", "dropped"].includes(initial)) {
      setStatusFilter(initial as OpportunityRow["status"]);
    }
    // ?opportunity= 딥링크 — 프로젝트 목록("기회 보기") 등에서 건너올 때 해당 행을 펼친다.
    const opp = params.get("opportunity");
    if (opp) setExpanded((prev) => ({ ...prev, [opp]: true }));
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

  // ── 매력도 평가 ──
  async function evaluateAttractiveness(id: string) {
    const raw = attractDraft[id];
    const v = raw === undefined || raw === "" ? null : Math.min(100, Math.max(0, Number(raw)));
    if (v === null || Number.isNaN(v)) { setError("매력도를 0-100 사이로 입력하세요."); return; }
    setError(null);
    try {
      await api.put(`/api/opportunities/${id}`, { attractiveness_score: v });
      setAttractDraft((prev) => { const n = { ...prev }; delete n[id]; return n; });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "매력도 평가 실패");
    }
  }

  // ── 매력도 LLM 초안 (ADR-0118) — 제안이며 기록은 사람(매력도 평가 버튼)이 한다 ──
  interface AttractivenessReco {
    source: "llm" | "synthesis";
    note: string | null;
    manifest: string[];
    recommendation: { suggested_score: number | null; rationale_draft: string; key_evidence: string[]; cautions: string[] };
  }
  const [attractReco, setAttractReco] = useState<Record<string, AttractivenessReco | "loading">>({});

  async function generateAttractDraft(id: string) {
    setAttractReco((prev) => ({ ...prev, [id]: "loading" }));
    try {
      const r = await api.post<AttractivenessReco>(`/api/opportunities/${encodeURIComponent(id)}/attractiveness-recommendation`, {});
      setAttractReco((prev) => ({ ...prev, [id]: r.data }));
      if (r.data.recommendation.suggested_score !== null) {
        setAttractDraft((prev) => ({ ...prev, [id]: String(r.data.recommendation.suggested_score) }));
      }
    } catch (err) {
      setAttractReco((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setError(err instanceof Error ? err.message : "매력도 초안 생성 실패");
    }
  }


  // ── 요인: 자동 도출 / 수동 추가 / 삭제 ──
  async function autoDeriveFactors(id: string) {
    setFactorsOf((prev) => ({ ...prev, [id]: "loading" }));
    setError(null);
    try {
      const res = await api.post<{ factors: OppFactors; source: string }>(`/api/opportunities/${id}/factors`, {});
      setFactorsOf((prev) => ({ ...prev, [id]: { factors: res.data.factors, source: res.data.source } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "요인 자동 도출 실패");
      setFactorsOf((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  async function addFactor(id: string, type: "opportunity" | "risk") {
    const text = factorDraft[id]?.type === type ? factorDraft[id]?.text?.trim() : "";
    if (!text) { setError("요인 내용을 입력하세요."); return; }
    setError(null);
    try {
      const res = await api.put<{ factors: OppFactors }>(`/api/opportunities/${id}/factors`, { type, text });
      setFactorsOf((prev) => ({ ...prev, [id]: { factors: res.data.factors, source: prev[id] && prev[id] !== "loading" ? prev[id].source : "manual" } }));
      setFactorDraft((prev) => ({ ...prev, [id]: { type, text: "" } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "요인 등록 실패");
    }
  }

  function removeFactor(id: string, type: "opportunity" | "risk", index: number, text: string) {
    confirm(
      "요인 삭제",
      async () => {
        setError(null);
        try {
          const res = await api.delete<{ factors: OppFactors }>(`/api/opportunities/${id}/factors`, { type, index });
          setFactorsOf((prev) => ({ ...prev, [id]: { factors: res.data.factors, source: prev[id] && prev[id] !== "loading" ? prev[id].source : "manual" } }));
        } catch (err) {
          setError(err instanceof Error ? err.message : "요인 삭제 실패");
        }
      },
      { body: text.length > 60 ? `${text.slice(0, 60)}…` : text },
    );
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

  async function fetchFactors(id: string) {
    try {
      const res = await api.get<{ factors: OppFactors; source: string | null }>(`/api/opportunities/${id}/factors`);
      setFactorsOf((prev) => ({ ...prev, [id]: { factors: res.data.factors, source: res.data.source } }));
    } catch { /* 요인 없음 — 빈 상태로 표시 */ }
  }

  // ── business-model-sketch ──
  // ── S3: 시너지 분석 / 전략적 적합성 평가 ──
  async function runScreening(id: string, kind: "synergy" | "fit") {
    setScreeningBusy((prev) => ({ ...prev, [id]: kind }));
    setError(null);
    try {
      await api.post(`/api/opportunities/${id}/screening`, { kind });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "S3 평가 실패");
    } finally {
      setScreeningBusy((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  async function showSketch(id: string, force = false) {
    setSketchOf((prev) => ({ ...prev, [id]: "loading" }));
    setError(null);
    try {
      const res = await api.post<{ sketch: Sketch; source: string | null }>(`/api/opportunities/${id}/sketch`, force ? { force: true } : {});
      setSketchOf((prev) => ({ ...prev, [id]: { sketch: res.data.sketch, source: res.data.source } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "스케치 생성 실패");
      setSketchOf((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
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
                <th scope="col" className="w-[6rem]">요인</th>
                <th scope="col" className="w-[13rem]">다음 단계</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((o) => {
                const factorState = factorsOf[o.id];
                const fs = factorState && factorState !== "loading" ? factorState.factors : null;
                const isOpen = !!expanded[o.id];
                return (
                  <Fragment key={o.id}>
                    <tr className={isOpen ? "row-selected" : undefined}>
                      <td>
                        <span className={`status-chip ${o.status === "selected" ? "status-green" : o.status === "dropped" ? "status-red" : o.status === "assessed" ? "status-amber" : "status-not-started"}`}>
                          {COLUMNS.find((c) => c.status === o.status)?.label}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="font-semibold text-left underline-offset-2 hover:underline"
                          title="행을 펼쳐 평가 패널을 열기"
                          onClick={() => {
                            setExpanded((prev) => ({ ...prev, [o.id]: !isOpen }));
                            if (!isOpen && !factorsOf[o.id]) void fetchFactors(o.id);
                          }}
                        >
                          {o.name}
                        </button>
                        <span className="block text-[0.72rem]">
                          {o.market_scope && <span className="status-chip status-amber mr-1">{o.market_scope}</span>}
                          {o.value_chain_node && <span className="text-[color:var(--muted-fg)]">{o.value_chain_node}</span>}
                          {!o.market_scope && !o.value_chain_node && "—"}
                        </span>
                      </td>
                      <td className="tabular-nums">{o.attractiveness_score ?? "—"}</td>
                      <td className="tabular-nums">{o.synergy_score ?? "—"}</td>
                      <td className="tabular-nums">{fs ? `✅${fs.opportunity.length} ${fs.risk.length}` : "—"}</td>
                      <td className="sizing-actions-cell"><span className="actions-row">
                        {nextStepActions(o, setStatus, showSketch, sketchOf)}
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
                        {o.project_id && (
                          <Link
                            href={`/projects/${o.project_id}/business-case`}
                            className="btn-ghost btn-sm"
                            title="승격된 프로젝트의 S8 사업성 분석(Business Case) 화면으로 이동"
                          >
                            S8 사업성 분석
                          </Link>
                        )}
                        {o.project_id && (
                          <Link
                            href={`/projects/${o.project_id}/dd`}
                            className="btn-ghost btn-sm"
                            title="승격된 프로젝트의 S9 실사·검증(DD 체크리스트 판정) 화면으로 이동"
                          >
                            S9 실사·검증
                          </Link>
                        )}
                        {o.project_id && (
                          <Link
                            href={`/projects/${o.project_id}/ic-review`}
                            className="btn-ghost btn-sm"
                            title="승격된 프로젝트의 S11 투자심사·실행(IC 패키지·Entity/Group IC·설립 실행) 화면으로 이동"
                          >
                            S11 투자심사
                          </Link>
                        )}
                        {o.project_id && (
                          <Link
                            href={`/projects/${o.project_id}/portfolio`}
                            className="btn-ghost btn-sm"
                            title="승격된 프로젝트의 S12 사후 관리(포트폴리오 스코어카드·전환 결정) 화면으로 이동"
                          >
                            S12 사후 관리
                          </Link>
                        )}
                      </span></td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6}>
                          <div className="text-[0.78rem] py-1">
                            <div className="chart-pair">
                              <div className="chart-half sizing-grade-card">
                                <h4 className="text-[0.8rem] mb-1">✅ 기회 요인</h4>
                                <ul className="sizing-note-list">
                                  {(fs?.opportunity ?? []).map((f, i) => (
                                    <li key={i}>
                                      {f}
                                      <button type="button" className="btn-danger btn-sm ml-1" title="이 요인을 삭제합니다" onClick={() => removeFactor(o.id, "opportunity", i, f)}>삭제</button>
                                    </li>
                                  ))}
                                  {(!fs || fs.opportunity.length === 0) && <li className="text-[color:var(--muted-fg)]">자동 도출 또는 수동 등록하세요.</li>}
                                </ul>
                              </div>
                              <div className="chart-half sizing-grade-card">
                                <h4 className="text-[0.8rem] mb-1">위험 요인</h4>
                                <ul className="sizing-note-list">
                                  {(fs?.risk ?? []).map((f, i) => (
                                    <li key={i}>
                                      {f}
                                      <button type="button" className="btn-danger btn-sm ml-1" title="이 요인을 삭제합니다" onClick={() => removeFactor(o.id, "risk", i, f)}>삭제</button>
                                    </li>
                                  ))}
                                  {(!fs || fs.risk.length === 0) && <li className="text-[color:var(--muted-fg)]">자동 도출 또는 수동 등록하세요.</li>}
                                </ul>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                disabled={factorState === "loading"}
                                title="산업 시장분석 근거에서 기회/위험 요인을 자동 도출합니다"
                                onClick={() => autoDeriveFactors(o.id)}
                              >
                                {factorState === "loading" ? "도출 중..." : "요인 자동 도출"}
                              </button>
                              <input
                                aria-label="기회 요인 수동 추가"
                                placeholder="기회 요인 추가"
                                value={factorDraft[o.id]?.type === "opportunity" ? factorDraft[o.id].text : ""}
                                onChange={(e) => setFactorDraft((prev) => ({ ...prev, [o.id]: { type: "opportunity", text: e.target.value } }))}
                                className="sizing-new-input sizing-new-input-sm"
                                style={{ flex: "1 1 12rem" }}
                              />
                              <button type="button" className="btn-ghost btn-sm" onClick={() => addFactor(o.id, "opportunity")}>추가</button>
                              <input
                                aria-label="위험 요인 수동 추가"
                                placeholder="위험 요인 추가"
                                value={factorDraft[o.id]?.type === "risk" ? factorDraft[o.id].text : ""}
                                onChange={(e) => setFactorDraft((prev) => ({ ...prev, [o.id]: { type: "risk", text: e.target.value } }))}
                                className="sizing-new-input sizing-new-input-sm"
                                style={{ flex: "1 1 12rem" }}
                              />
                              <button type="button" className="btn-ghost btn-sm" onClick={() => addFactor(o.id, "risk")}>추가</button>
                            </div>

                            {o.rationale && <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">{o.rationale}</p>}

                            {/* S3 — 시너지 분석·전략적 적합성 판단 (평가 단계 이상) */}
                            {o.status !== "identified" && (
                              <div className="mt-2 p-2 border border-[color:var(--border)] rounded">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-[0.8rem] !mb-0 font-semibold">S3 시너지·전략적 적합성</h4>
                                  {o.synergy_score !== null && o.fit_verdict && (
                                    <span className={`status-chip ${o.fit_verdict === "Go" && o.synergy_score >= 60 ? "status-green" : o.fit_verdict === "Kill" || o.synergy_score < 40 ? "status-red" : "status-amber"}`}>
                                      screening 권고: {o.fit_verdict === "Go" && o.synergy_score >= 60 ? "Go" : o.fit_verdict === "Kill" || o.synergy_score < 40 ? "Kill" : "Hold"}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1 mt-2">
                                  <button
                                    type="button"
                                    className="btn-ghost btn-sm"
                                    disabled={screeningBusy[o.id] !== undefined}
                                    title="자사 역량과의 시너지를 0-100 점과 근거로 산출합니다 (risk-officer)"
                                    onClick={() => runScreening(o.id, "synergy")}
                                  >
                                    {screeningBusy[o.id] === "synergy" ? "분석 중..." : "시너지 분석"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-ghost btn-sm"
                                    disabled={screeningBusy[o.id] !== undefined}
                                    title="전략적 적합성을 Go/Hold/Kill로 권고합니다 (process-governance-manager)"
                                    onClick={() => runScreening(o.id, "fit")}
                                  >
                                    {screeningBusy[o.id] === "fit" ? "평가 중..." : "적합성 평가"}
                                  </button>
                                </div>
                                {o.synergy_score !== null && (
                                  <p className="mt-2 mb-0 text-[0.75rem]">
                                    <strong>시너지 {o.synergy_score}점</strong> — {o.synergy_rationale ?? "근거 미기록"}
                                  </p>
                                )}
                                {o.fit_verdict && (
                                  <p className="mt-1 mb-0 text-[0.75rem]">
                                    <strong>적합성 {o.fit_verdict}</strong> — {o.fit_rationale ?? "근거 미기록"}
                                  </p>
                                )}
                                {o.status === "assessed" && (o.synergy_score === null || !o.fit_verdict) && (
                                  <p className="mt-1 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
                                    두 평가를 마쳐야 선별/제외(다음 단계)가 활성화됩니다.
                                  </p>
                                )}
                              </div>
                            )}
                            {o.status === "identified" && (
                              <div className="flex items-center gap-1 mt-2">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  aria-label="매력도"
                                  placeholder="매력도 0-100"
                                  value={attractDraft[o.id] ?? ""}
                                  onChange={(e) => setAttractDraft((prev) => ({ ...prev, [o.id]: e.target.value }))}
                                  className="sizing-new-input sizing-new-input-sm"
                                  style={{ width: "7.5rem" }}
                                />
                                <button type="button" className="btn-ghost btn-sm" onClick={() => evaluateAttractiveness(o.id)}>
                                  매력도 평가
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  title="S1 시장분석·요인을 근거로 점수 초안을 제안합니다"
                                  disabled={attractReco[o.id] === "loading"}
                                  onClick={() => void generateAttractDraft(o.id)}
                                >
                                  {attractReco[o.id] === "loading" ? "초안 생성 중..." : "LLM 초안"}
                                </button>
                                {attractReco[o.id] && attractReco[o.id] !== "loading" && (
                                  <span className="text-[0.7rem] text-[color:var(--muted-fg)]">
                                    {(attractReco[o.id] as AttractivenessReco).recommendation.rationale_draft.slice(0, 160) || "초안 없음"}
                                  </span>
                                )}
                                <span className="text-[0.72rem] text-[color:var(--muted-fg)]">평가 후 다음 단계(평가)로 이동할 수 있습니다.</span>
                              </div>
                            )}

                            <div className="flex flex-wrap items-center gap-1 mt-2">
                              {o.status === "identified" && (
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  disabled={o.attractiveness_score === null}
                                  title={o.attractiveness_score === null ? "먼저 매력도를 평가하세요" : undefined}
                                  onClick={() => setStatus(o.id, "assessed")}
                                >
                                  평가로 이동
                                </button>
                              )}
                              {o.status === "assessed" && (
                                <>
                                  <button type="button" className="btn-ghost" onClick={() => setStatus(o.id, "selected", o.synergy_score ?? o.attractiveness_score ?? 50)}>선별</button>
                                  <button type="button" className="btn-ghost" onClick={() => setStatus(o.id, "dropped", o.synergy_score ?? o.attractiveness_score ?? 50)}>제외</button>
                                </>
                              )}
                              {o.status === "selected" && (
                                <Link
                                  className="btn-ghost"
                                  href={`/route-decision?opportunity=${encodeURIComponent(o.id)}`}
                                  title="진출방식 결정(S4) 화면으로 이동합니다"
                                >
                                  S4 평가 진행 — 진출방식 결정
                                </Link>
                              )}
                              {(o.status === "assessed" || o.status === "selected") && (
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  onClick={() => showSketch(o.id)}
                                  disabled={sketchOf[o.id] === "loading"}
                                >
                                  {sketchOf[o.id] === "loading" ? "스케치 생성 중..." : sketchOf[o.id] ? "스케치 보기" : "비즈니스 모델 스케치"}
                                </button>
                              )}
                            </div>

                            {sketchOf[o.id] && sketchOf[o.id] !== "loading" && (() => {
                              const sk = sketchOf[o.id] as { sketch: Sketch; source: string | null };
                              return (
                                <details className="mt-2 text-[0.75rem]">
                                  <summary className="cursor-pointer text-[color:var(--muted-fg)]">
                                    비즈니스 모델 스케치 ({sk.source === "llm" ? "LLM" : "결정론 합성"})
                                    <button type="button" className="btn-ghost btn-sm ml-2" onClick={(e) => { e.preventDefault(); void showSketch(o.id, true); }}>재생성</button>
                                  </summary>
                                  <SketchCanvas sketch={sk.sketch as unknown as Record<string, unknown>} />
                                </details>
                              );
                            })()}

                            {/* S7→S8 승격 표면 (ADR-0095) — 선별된 기회의 행 펼침 패널에서 승격 */}
                            {o.status === "selected" && !o.project_id && (
                              <div className="mt-2 -mx-2">
                                <PromotionPanel
                                  opportunityId={o.id}
                                  heading={`${o.name} — 프로젝트로 승격 (S7 → S8)`}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
