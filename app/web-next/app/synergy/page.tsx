"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api.ts";
import { useConfirm } from "../../components/crud.tsx";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import dynamic from "next/dynamic";
import { useChartTheme } from "../../lib/echarts-theme.ts";

const EChartsCore = dynamic(() => import("echarts-for-react"), { ssr: false });

// S3 시너지 정합성 (/synergy) — Long List(S1 시장분석 + S2 기회발굴)를
// 회사 단위 Short List로 좁히는 단계. S1 시장분석과 동일 패턴:
// ① 분석 대상 회사 테이블(등록·재분석) → ② 회사 선택 시 탭 구조 리포트.
// 재분석 시 같은 분석 행을 재사용하고 새 버전(append-only)을 쌓는다.

interface SynergyStepSummary { step: number; title: string; summary: string; source: string }
interface SynergySourceRef { title: string; url: string; snippet?: string }
interface SynergyPayload {
  company: { name: string; dartCorpCode: string | null };
  dartFinancials: { available: boolean; year?: string; items?: Array<{ name: string; value: number; year?: string }>; reportUrl?: string; error?: string; fsDivLabel?: string; integrity?: string | null; integrityNotes?: string[] };
  /** 재무 데이터 출처 — DART / 신용평가자료 / 외부 검색 (구형 버전에는 없음) */
  dataSources?: { dart: boolean; dartYear: string | null; creditReport: string | null; webResearchCount: number };
  researchSources: SynergySourceRef[];
  financialStrengths: string[];
  financialWeaknesses: string[];
  businessAssessment: string;
  marketLinkage: {
    marketSummaries: Array<{ industry: string; cagrPct: number | null; gapPct: number | null; newDrivers: string[] }>;
    synergyAreas: Array<{ area: string; synergyType: string; rationale: string; opportunity: string; risk: string; sources: string[] }>;
  };
  shortList: Array<{ rank: number; area: string; verdict: string; reason: string }>;
  stepSummaries: SynergyStepSummary[];
  target?: { type: "affiliate" | "group"; name: string };
  opportunity?: { id: string; name: string } | null;
  synergyScore?: number | null;
  synergyRationale?: string | null;
}
interface SynergyAnalysis {
  id: string; status: "in_progress" | "completed"; current_step: number;
  company_name: string; dart_corp_code: string | null; source_ref?: string | null;
  created_at: string; completed_at: string | null; latest_version: number | null;
  target_type?: "affiliate" | "group" | null;
  member_name?: string | null; group_name?: string | null;
  opportunity_id?: string | null; opportunity_name?: string | null;
  versions?: Array<{ version_no: number; payload: SynergyPayload | null; changelog: string | null; created_by: string; created_at: string }>;
}
/** 분석 대상 표기 — 신규(레지스트리)는 계열사/그룹명, legacy는 md_company 회사명 */
function targetLabel(a: Pick<SynergyAnalysis, "target_type" | "member_name" | "group_name" | "company_name">): string {
  if (a.target_type === "affiliate") return a.member_name ?? a.company_name;
  if (a.target_type === "group") return a.group_name ?? "그룹 전체";
  return a.company_name;
}

const STEP_TITLES = ["DART 재무 입수", "외부 리서치", "재무 강/약점 분석", "S1·S2 연계 시너지", "Short List 정리"];

const TABS = [
  ["finance", "재무 현황"],
  ["swot", "강/약점"],
  ["linkage", "연계 시너지"],
  ["shortlist", "Short List"],
  ["refs", "출처·노트"],
] as const;

type TabKey = (typeof TABS)[number][0];

export function SynergyView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [analyses, setAnalyses] = useState<SynergyAnalysis[] | null>(null);
  const [selected, setSelected] = useState<SynergyAnalysis | null>(null);
  const [detail, setDetail] = useState<SynergyAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [corpCode, setCorpCode] = useState("");
  // 새 분석 폼 — 대상(그룹/계열사 레지스트리) + 기회 연결 (ADR-0090)
  const [showNewForm, setShowNewForm] = useState(false);
  const [targets, setTargets] = useState<Array<{ kind: "affiliate" | "group"; id: string; label: string; groupName: string; hasProfile: boolean }>>([]);
  const [targetSel, setTargetSel] = useState<{ kind: "affiliate" | "group"; id: string } | null>(null);
  const [opps, setOpps] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [oppSel, setOppSel] = useState("");
  const [creating, setCreating] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useState<TabKey>("finance");

  const selectedId = searchParams.get("company");

  const refresh = useCallback(() => {
    loadTargets(); // 대상(그룹/계열사 프로파일) 목록 갱신 — ADR-0090
    return api.get<{ analyses: SynergyAnalysis[] }>("/api/synergy/analyses")
      .then((r) => { setAnalyses(r.data.analyses); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // URL(?company=) 기반 선택 — 상단 바 뒤로 가기와 연동
  useEffect(() => {
    if (!selectedId) {
      // 뒤로 가기(목록 복귀) — 선택 상태를 해제한다
      setSelected(null);
      setDetail(null);
      return;
    }
    if (analyses === null) return;
    const found = analyses.find((a) => a.id === selectedId) ?? null;
    setSelected(found);
    if (!found) { setDetail(null); return; }
    if (found.status === "completed") {
      api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(found.id)}`)
        .then((r) => setDetail(r.data))
        .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
    } else {
      setDetail(null);
    }
  }, [selectedId, analyses]);

  const hasInProgress = analyses?.some((a) => a.status === "in_progress") ?? false;
  useEffect(() => {
    if (!hasInProgress) return;
    const t = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [hasInProgress, refresh]);

  // 선택한 회사의 분석이 완료되면 상세 리포트를 자동으로 활성화한다
  useEffect(() => {
    if (!selectedId || selected?.status !== "in_progress") return;
    const t = setInterval(async () => {
      try {
        const r = await api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(selectedId)}`);
        if (r.data.status === "completed") { setDetail(r.data); setSelected(r.data); }
      } catch { /* 다음 폴링에서 재시도 */ }
    }, 4000);
    return () => clearInterval(t);
  }, [selectedId, selected?.status]);

  const openDetail = useCallback((a: SynergyAnalysis) => {
    router.replace(`/synergy?company=${encodeURIComponent(a.id)}`);
    setSelected(a);
    setDetail(null);
    if (a.status === "completed") {
      api.get<SynergyAnalysis>(`/api/synergy/analyses/${encodeURIComponent(a.id)}`)
        .then((r) => setDetail(r.data))
        .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
    }
  }, []);

  const loadTargets = useCallback(() => {
    api.get<{ groups: Array<{ id: string; name: string; member_count: number }> }>("/api/our-company/groups")
      .then(async (gr) => {
        const out: Array<{ kind: "affiliate" | "group"; id: string; label: string; groupName: string; hasProfile: boolean }> = [];
        for (const g of gr.data.groups) {
          const detail = await api.get<{ members: Array<{ id: string; company_name: string; latest_version: number | null }> }>(`/api/our-company/groups/${encodeURIComponent(g.id)}`);
          out.push({ kind: "group", id: g.id, label: `그룹 전체 (${g.name})`, groupName: g.name, hasProfile: detail.data.members.some((m) => m.latest_version !== null) });
          for (const m of detail.data.members) {
            out.push({ kind: "affiliate", id: m.id, label: m.company_name, groupName: g.name, hasProfile: m.latest_version !== null });
          }
        }
        setTargets(out);
      })
      .catch(() => setTargets([]));
    api.get<{ rows: Array<{ id: string; name: string; status: string }> }>("/api/opportunities")
      .then((r) => setOpps(r.data.rows.map((o) => ({ id: o.id, name: o.name, status: o.status }))))
      .catch(() => setOpps([]));
  }, []);

  async function createAnalysis() {
    if (!targetSel || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<{ analysis_id: string }>("/api/synergy/analyses", {
        targetType: targetSel.kind,
        memberId: targetSel.kind === "affiliate" ? targetSel.id : undefined,
        groupId: targetSel.kind === "group" ? targetSel.id : undefined,
        opportunityId: oppSel || undefined,
      });
      const list = await api.get<{ analyses: SynergyAnalysis[] }>("/api/synergy/analyses");
      setAnalyses(list.data.analyses);
      setShowNewForm(false);
      const created = list.data.analyses.find((x) => x.id === res.data.analysis_id);
      if (created) openDetail({ ...created, status: "in_progress" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 시작 실패");
    } finally {
      setCreating(false);
    }
  }

  function removeAnalysis(a: SynergyAnalysis) {
    confirm(
      `${a.company_name} 시너지 분석 삭제`,
      async () => {
        setError(null);
        try {
          await api.delete(`/api/synergy/analyses/${encodeURIComponent(a.id)}`);
          if (selected?.id === a.id) backToList();
          refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "시너지 분석 삭제 실패");
        }
      },
      { body: "이 분석과 버전 전체가 삭제됩니다. 회사 마스터(그룹/계열사·프로젝트 연결)는 유지됩니다." },
    );
  }

  const backToList = useCallback(() => {
    router.replace("/synergy");
    setSelected(null);
    setDetail(null);
    void refresh();
  }, [refresh]);




  async function rerun(a: SynergyAnalysis) {
    setError(null);
    try {
      const res = await api.post<{ analysis_id: string }>("/api/synergy/analyses", {
        targetType: a.target_type ?? undefined,
        memberId: a.target_type === "affiliate" ? undefined : undefined,
        groupId: a.target_type === "group" ? undefined : undefined,
      });
      // legacy(company_id 기반) 재분석은 별도 경로가 없어 서버가 target_type 오류로 거부할 수 있다 — 안내로 처리
      void res;
      // 최신 목록에서 해당 분석을 in_progress 상태로 가져와 상세 진입 → 완료 폴링이 자동 활성화된다
      const list = await api.get<{ analyses: SynergyAnalysis[] }>("/api/synergy/analyses");
      setAnalyses(list.data.analyses);
      const updated = list.data.analyses.find((x) => x.id === res.data.analysis_id);
      if (updated) openDetail({ ...updated, status: "in_progress" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "재분석 시작 실패");
    }
  }

  // ── 상세 (회사 선택 시) ──
  if (selected) {
    const selectedAnalysis = detail ?? selected;
    return (
      <main>
        {confirmDialog}
        <SynergyResult
          analysis={selectedAnalysis}
          tab={tab}
          onTab={(k) => setTab(k)}
          onBack={backToList}
          onRerun={() => rerun(selected)}
        />
      </main>
    );
  }

  // ── 목록 (분석 대상 회사) ──
  return (
    <main>
      {confirmDialog}
      
      <StageFrame stageId="S3">
        <strong>그룹/계열사 × 기회 시너지 검증</strong> — 그룹/계열사 분석에서 만든 자사 프로파일(특정 계열사 또는 그룹 전체)을
        S1 시장분석·S2 기회발굴 결과와 연결해 시너지 영역을 도출하고 Short List로 좁힙니다.
        기회를 연결하면 완료 시 해당 기회에 synergy_score 권고가 기록됩니다 (ADR-0090).
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      <section aria-label="분석 대상 회사" className="market-section">
        <SectionToolbar
          title="시너지 분석 목록"
          icon="🗂"
          count={analyses?.length ?? 0}
          actions={
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowNewForm((v) => !v)}
              aria-expanded={showNewForm}
            >
              ＋ 새 분석
            </button>
          }
        />

        {analyses === null ? (
          <p>불러오는 중...</p>
        ) : analyses.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 시너지 분석이 없습니다. "회사 등록"으로 시작하세요.</p>
        ) : (
          <table className="data-table" aria-label="분석 대상 회사 목록">
            <caption className="sr-only">분석 대상 회사 목록</caption>
            <thead>
              <tr>
                <th scope="col">회사명</th>
                <th scope="col">DART 고유번호</th>
                <th scope="col">분석 상태</th>
                <th scope="col">분석일</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a) => {
                const inProgress = a.status === "in_progress";
                return (
                  <tr key={a.id} className={selectedId === a.id ? "row-selected" : undefined}>
                    <td className="cell-primary">
                      <button
                        type="button"
                        className="font-semibold text-left underline-offset-2 hover:underline"
                        title="시너지 정합성 리포트 열기"
                        onClick={() => openDetail(a)}
                      >
                        {targetLabel(a)}
                      </button>
                      {a.opportunity_name && <span className="block text-[0.7rem] text-[color:var(--muted-fg)]">기회: {a.opportunity_name}</span>}
                    </td>
                    <td>{a.target_type ? <span className="status-chip status-not-started">{a.target_type === "group" ? "그룹" : "계열사"}</span> : <span className="status-chip status-amber" title="기존 별도 등록 분석(legacy)">legacy</span>}</td>
                    <td>
                      {inProgress ? (
                        <span className="status-chip status-amber">분석 중 ({a.current_step}/5단계)</span>
                      ) : (
                        <span className="status-chip status-green">분석 완료 (v{a.latest_version ?? 1})</span>
                      )}
                    </td>
                    <td className="tabular-nums">{(a.completed_at ?? a.created_at).slice(0, 10)}</td>
                    <td className="sizing-actions-cell"><span className="actions-row">
                      <button type="button" className="btn-ghost btn-sm" disabled={inProgress} onClick={() => openDetail(a)}>
                        {inProgress ? "분석 중" : "열기"}
                      </button>
                      {!inProgress && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={!a.target_type}
                          title={a.target_type ? "같은 분석 행을 재사용해 새 버전으로 재실행합니다" : "기존 별도 등록(legacy) 분석은 재실행할 수 없습니다 — 레지스트리 대상 새 분석을 생성하세요"}
                          onClick={() => rerun(a)}
                        >
                          재분석
                        </button>
                      )}
                      <button type="button" className="btn-danger btn-sm" title="이 시너지 분석을 삭제합니다" onClick={() => removeAnalysis(a)}>
                        삭제
                      </button>
                    </span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {hasInProgress && <p className="mt-2 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]" role="status">분석이 진행 중입니다 — 완료되면 목록이 자동으로 갱신됩니다.</p>}
      </section>

      {/* ── 새 분석 폼 (대상 = 그룹/계열사 레지스트리 · 기회 연결 — ADR-0090) ── */}
      {showNewForm && (
        <div className="sizing-new-form mb-3">
          <div className="mb-2">
            <span className="text-label block mb-1">① 분석 대상 — 그룹/계열사 분석에서 프로파일을 만든 대상</span>
            {targets.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic text-[0.85rem] mb-0">그룹/계열사 분석 화면에서 회사를 등록·분석하면 여기에 표시됩니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {targets.map((t) => (
                  <button
                    key={`${t.kind}-${t.id}`}
                    type="button"
                    aria-pressed={targetSel?.kind === t.kind && targetSel?.id === t.id}
                    disabled={!t.hasProfile}
                    title={t.hasProfile ? `${t.groupName} 그룹 · 프로파일 있음` : "프로파일이 없는 대상 — 그룹/계열사 분석을 먼저 실행하세요"}
                    className={`sizing-industry-chip ${targetSel?.kind === t.kind && targetSel?.id === t.id ? "sizing-industry-chip-active" : ""} ${!t.hasProfile ? "opacity-40" : ""}`}
                    onClick={() => { if (t.hasProfile) setTargetSel({ kind: t.kind, id: t.id }); }}
                  >
                    <span className="font-semibold">{t.kind === "group" ? "🏢 전체" : "🏭"} {t.label}</span>
                    <span className="sizing-chip-meta">{t.hasProfile ? "프로파일 준비됨" : "프로파일 없음"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mb-2">
            <span className="text-label block mb-1">② 연결 기회 (선택) — S2에서 발굴한 기회를 선택하면 완료 시 synergy_score 권고가 기록됩니다</span>
            <select value={oppSel} onChange={(e) => setOppSel(e.target.value)} className="sizing-new-input" style={{ width: "100%" }}>
              <option value="">기회 없이 분석 (시장 연계만)</option>
              {opps.filter((o) => o.status !== "dropped").map((o) => (
                <option key={o.id} value={o.id}>[{o.status}] {o.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setShowNewForm(false)}>취소</button>
            <button type="button" className="btn-ghost" disabled={creating || !targetSel} onClick={() => void createAnalysis()}>
              {creating ? "분석 시작 중..." : "분석 시작"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function SynergyResult({ analysis, tab, onTab, onBack, onRerun }: {
  analysis: SynergyAnalysis;
  tab: TabKey;
  onTab: (k: TabKey) => void;
  onBack: () => void;
  onRerun: () => void;
}) {
  const latest = analysis.versions?.[0] ?? null;
  const p = latest?.payload ?? null;
  const inProgress = analysis.status === "in_progress";
  const ct = useChartTheme(); // 리포트 차트 테마 — 훅은 컴포넌트 최상위에서 1회
  const analysisDate = latest?.created_at?.slice(0, 10) ?? analysis.created_at.slice(0, 10);
  const router = useRouter();
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // S3 Short List -> S4 route-decision handoff: mark the linked opportunity
  // "selected" and hand the synergy rationale to /route-decision as a
  // pre-fill starting point (editable, not locked).
  const opportunityId = p?.opportunity?.id ?? analysis.opportunity_id ?? null;
  const advanceToRouteDecision = useCallback(async () => {
    if (!opportunityId || advancing) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      await api.put(`/api/opportunities/${encodeURIComponent(opportunityId)}`, { status: "selected" });
      const rationale = p?.synergyRationale ?? "";
      router.push(`/route-decision?opportunity=${encodeURIComponent(opportunityId)}&rationale=${encodeURIComponent(rationale)}`);
    } catch (err) {
      setAdvanceError(err instanceof Error ? err.message : "S4 진행 실패");
    } finally {
      setAdvancing(false);
    }
  }, [opportunityId, advancing, p?.synergyRationale, router]);
  return (
    <section aria-label="시너지 정합성 리포트" className="market-section sizing-step">
      <SectionToolbar
        title={`${targetLabel(analysis)} 시너지 정합성 분석`}
        icon="🏢"
        summary={
          <span className="flex items-center gap-1">
            <span className="section-meta">S3 Long List → Short List · 분석일 {analysisDate} · v{latest?.version_no ?? analysis.latest_version ?? 1}</span>
            {analysis.opportunity_name && <span className="status-chip status-in-progress" title={`연결 기회: ${analysis.opportunity_name}`}>기회: {analysis.opportunity_name}</span>}
            {(() => {
              const score = latest?.payload?.synergyScore;
              return typeof score === "number" ? <span className="status-chip status-green">synergy 권고 {score}</span> : null;
            })()}
          </span>
        }
        actions={
          <button type="button" className="btn-ghost" disabled={inProgress} onClick={onRerun}>
            재분석
          </button>
        }
      />

      {inProgress && (
        <p className="text-[0.85rem]" role="status">
          분석 중 ({analysis.current_step}/5단계) — {STEP_TITLES[analysis.current_step] ?? ""} 진행 중입니다. 완료되면 자동 갱신됩니다.
        </p>
      )}
      {!p && !inProgress && <p className="text-[color:var(--muted-fg)] italic">분석 결과가 없습니다.</p>}

      {p && (
        <>
          <div className="library-tabs" role="tablist" aria-label="리포트 섹션">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`library-tab ${tab === key ? "library-tab-active" : ""}`} onClick={() => onTab(key)}>
                {label}
              </button>
            ))}
          </div>

          {tab === "finance" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">1</span> 재무 현황 (DART {p.dartFinancials.available ? `${p.dartFinancials.year}년 사업보고서` : "미입수"})</h3>
              {p.dartFinancials.available && p.dartFinancials.items ? (
                (() => {
                  const items = p.dartFinancials.items;
                  const years = [...new Set(items.map((i) => i.year ?? ""))].filter(Boolean).sort().reverse();
                  const accounts = [...new Set(items.map((i) => i.name))];
                  const byKey = new Map(items.map((i) => [`${i.year}|${i.name}`, i.value]));
                  const fmtEok = (v: number) => (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 });
                  
                  const chartOption = {
                    tooltip: { trigger: "axis" as const },
                    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                    grid: { left: 60, right: 16, top: 32, bottom: 28 },
                    xAxis: { type: "category" as const, data: accounts, axisLabel: { color: ct.muted, fontSize: 11, interval: 0, rotate: accounts.length > 6 ? 20 : 0 } },
                    yAxis: { type: "value" as const, axisLabel: { color: ct.muted, formatter: (v: number) => `${fmtEok(v)}억` }, splitLine: { lineStyle: { color: ct.split } } },
                    series: years.map((y, i) => ({
                      name: y,
                      type: "bar" as const,
                      data: accounts.map((a) => byKey.get(`${y}|${a}`) ?? null),
                      itemStyle: { color: ct.color[i % ct.color.length], borderRadius: [4, 4, 0, 0] },
                    })),
                  };
                  return (
                    <>
                      {/* 시계열 비교 — 차트 우선 (ADR-0088 데이터 표현 표준) */}
                      <div className="report-chart-card">
                        <EChartsCore option={chartOption} style={{ height: 300 }} />
                        <p className="mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">단위: 억원 · 출처: DART 사업보고서{p.dartFinancials.fsDivLabel ? ` · ${p.dartFinancials.fsDivLabel}` : ""}</p>
                      </div>
                      {/* 피벗 테이블 — 계정(행) × 연도(열, 최신순) */}
                      <div className="table-scroll">
                        <table className="data-table report-table" aria-label="DART 재무 요약 (계정 × 연도)">
                          <caption className="sr-only">DART 재무 요약 (계정 × 연도)</caption>
                          <thead>
                            <tr><th scope="col" className="col-label">계정</th>{years.map((y) => <th key={y} scope="col" className="col-num">{y}</th>)}</tr>
                          </thead>
                          <tbody>
                            {accounts.map((a) => (
                              <tr key={a}>
                                <td className="font-semibold">{a}</td>
                                {years.map((y) => {
                                  const v = byKey.get(`${y}|${a}`);
                                  return <td key={y} className="tabular-nums">{v !== undefined ? `${fmtEok(v)} 억원` : "—"}</td>;
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {p.dartFinancials.integrity === "warning" && (
                        <p role="alert" className="text-[0.78rem] text-[color:var(--amber-fg)] mt-1">
                          ⚠ 재무 합산 검증 불일치 — {(p.dartFinancials.integrityNotes ?? []).join(" / ")} (출처 원본 대조 권장)
                        </p>
                      )}
                      <p className="text-[0.72rem] text-[color:var(--muted-fg)]">출처: <span className="status-chip status-green">DART</span> 전자공시 사업보고서{p.dartFinancials.reportUrl ? <> — <a href={p.dartFinancials.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문 보기</a></> : null}</p>
                    </>
                  );
                })()
              ) : (
                <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">DART 미입수 — {p.dartFinancials.error ?? "사유 없음"} (웹 리서치로 보완)</p>
              )}
              {/* 재무 데이터 출처 — DART / 신용평가자료 / 외부 검색 */}
              <div className="sizing-grade-card mt-3">
                <h4 className="text-[0.85rem] mb-2">🔎 재무 데이터 출처</h4>
                <ul className="sizing-note-list">
                  <li>
                    {p.dataSources?.dart ? "✅" : "⚠️"} DART 전자공시 — {p.dataSources?.dart ? `${p.dataSources.dartYear ?? ""} 사업보고서 재무제표` : "미입수 (비상장 또는 미구성)"}
                  </li>
                  <li>
                    {p.dataSources?.creditReport ? "✅" : "⚪"} 신용평가자료 — {p.dataSources?.creditReport ?? "미첨부 (비상장 회사 등록 시 업로드 가능)"}
                  </li>
                  <li>
                    {(p.dataSources?.webResearchCount ?? 0) > 0 ? "✅" : "⚪"} 외부 검색·리서치 — {(p.dataSources?.webResearchCount ?? 0)}건 (기관·증권사·뉴스, 출처는 "출처·노트" 탭)
                  </li>
                </ul>
                <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
                  재무 수치는 DART 공시 기준(최근 3년 연도별)이며, DART 고유번호를 모르면 "DART 고유번호 입력" 후 재분석하면 연도별 재무제표를 직접 조회합니다. 비상장 회사는 신용평가자료·외부 리서치로 보강됩니다(출처 명기).
                </p>
              </div>
            </div>
          )}

          {tab === "swot" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">2</span> 재무·사업 강/약점 분석</h3>
              <div className="chart-pair">
                <div className="chart-half sizing-grade-card report-bullet-card">
                  <h4>💪 강점</h4>
                  <ul className="report-bullet-list">{p.financialStrengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
                <div className="chart-half sizing-grade-card report-bullet-card">
                  <h4>🩹 약점</h4>
                  <ul className="report-bullet-list">{p.financialWeaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              </div>
              <p className="mt-3 mb-0 text-[0.88rem]"><strong>종합 평가:</strong> {p.businessAssessment}</p>
            </div>
          )}

          {tab === "linkage" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge">3</span> S1·S2 연계 시너지 영역 (Long List → 분석)</h3>
              <p className="mb-2 text-[0.8rem] text-[color:var(--muted-fg)]">
                연계 시장: {p.marketLinkage.marketSummaries.map((m) => `${m.industry} (CAGR ${m.cagrPct ?? "?"}%${m.gapPct !== null ? `, 격차 ${m.gapPct > 0 ? "+" : ""}${m.gapPct}%` : ""})`).join(" · ") || "없음"}
              </p>
              <div className="table-scroll">
              <table className="data-table report-table" aria-label="시너지 영역">
                <caption className="sr-only">시너지 영역</caption>
                <thead>
                  <tr><th scope="col">영역</th><th scope="col">유형</th><th scope="col">근거</th><th scope="col">기회</th><th scope="col">위험</th></tr>
                </thead>
                <tbody>
                  {p.marketLinkage.synergyAreas.map((a) => (
                    <tr key={a.area}>
                      <td className="font-semibold col-label">{a.area}</td>
                      <td className="text-[0.8rem] col-type">{a.synergyType}</td>
                      <td className="text-[0.85rem] col-text">{a.rationale}{a.sources.length > 0 && <span className="text-[color:var(--muted-fg)]"> (출처: {a.sources.join(", ")})</span>}</td>
                      <td className="text-[0.85rem] col-text">{a.opportunity}</td>
                      <td className="text-[0.85rem] col-text">{a.risk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {tab === "shortlist" && (
            <div className="text-[0.88rem]">
              <h3 className="sizing-step-title text-[0.95rem]"><span className="sizing-step-badge sizing-step-badge-deep">4</span> Short List — 시너지 영역 선별</h3>
              <table className="data-table" aria-label="시너지 Short List">
                <caption className="sr-only">시너지 Short List</caption>
                <thead><tr><th scope="col">순위</th><th scope="col">영역</th><th scope="col">판정</th><th scope="col">사유</th></tr></thead>
                <tbody>
                  {p.shortList.map((s) => (
                    <tr key={s.rank}>
                      <td className="tabular-nums font-semibold">{s.rank}</td>
                      <td className="font-semibold">{s.area}</td>
                      <td><span className={`status-chip ${s.verdict.includes("Short") ? "status-green" : "status-not-started"}`}>{s.verdict}</span></td>
                      <td className="text-[0.85rem]">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Short List -> S4 route-decision handoff (opportunity.status -> selected,
                  rationale carried over as an editable starting point). */}
              {opportunityId ? (
                <div className="flex items-center gap-2 mt-2">
                  <button type="button" className="btn-ghost" disabled={advancing} onClick={() => void advanceToRouteDecision()}>
                    {advancing ? "S4로 진행 중..." : "S4로 진행"}
                  </button>
                  <span className="text-[0.78rem] text-[color:var(--muted-fg)]">연결 기회를 &quot;selected&quot;로 표시하고 트랙 결정(/route-decision)으로 이동합니다.</span>
                </div>
              ) : (
                <p className="mt-2 mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">
                  S4로 진행하려면 이 분석에 연결된 기회(S2)가 필요합니다 — 새 분석 시 "연결 기회"를 선택하세요.
                </p>
              )}
              {advanceError && <p role="alert" className="text-[0.78rem] text-[color:var(--red-fg)] mt-1">{advanceError}</p>}
            </div>
          )}

          {tab === "refs" && (
            <div className="text-[0.88rem]">
              {p.researchSources.length > 0 && (
                <details className="market-section" open>
                  <summary className="cursor-pointer text-[0.85rem]">📚 입수 출처 ({p.researchSources.length}건 — 출처 명기·교차검증)</summary>
                  <ul className="sizing-note-list mt-2">
                    {p.researchSources.map((s, i) => (
                      <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a><span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span></li>
                    ))}
                  </ul>
                </details>
              )}
              <details className="market-section" open>
                <summary className="cursor-pointer text-[0.85rem]">📝 파이프라인 단계별 노트 ({p.stepSummaries.length}단계)</summary>
                <ol className="mt-3 space-y-2 text-[0.85rem]">
                  {p.stepSummaries.map((s) => (
                    <li key={s.step}><strong>{s.step}. {s.title}</strong> <span className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}>{s.source === "llm" ? "LLM" : "시스템"}</span><br />{s.summary}</li>
                  ))}
                </ol>
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function SynergyPage() {
  return (
    <Suspense fallback={null}>
      <SynergyView />
    </Suspense>
  );
}
