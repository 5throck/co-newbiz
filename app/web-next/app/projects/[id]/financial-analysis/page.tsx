"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { api } from "../../../../lib/api.ts";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface FinancialRow { id: string; value: number; account_name: string; ifrs_code: string; fiscal_year: number; period_type: string; source_code: string | null }
interface CompRow { id: string; job_family: string; grade: string; headcount: number; gap_pct: number; annual_cost_delta: number; evidence_ref: string | null }
interface ValuationRow { id: string; scenario: string; percentile: string; npv_krw_m: number; irr: number | null; model_name: string }
interface View { company_id: string | null; financials: FinancialRow[]; compBenchmarks: CompRow[]; valuations: ValuationRow[] }

function fmt(n: number | null | undefined) { return typeof n === "number" ? n.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "—"; }

export default function FinancialAnalysisPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/financial-analysis`)
      .then((r) => setView(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "재무분석 데이터를 불러오지 못했습니다."));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const chartOption = useMemo(() => ({
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: (view?.valuations ?? []).map((v) => `${v.scenario}/${v.percentile}`) },
    yAxis: { type: "value", name: "NPV (백만 KRW)" },
    series: [{ type: "bar", data: (view?.valuations ?? []).map((v) => v.npv_krw_m) }],
  }), [view]);

  return (
    <main className="market-page">
      <ProjectSubNav projectId={projectId} />
      <StageFrame stageId="S8" heading="재무분석 — 재무실적 · 보상 벤치마크 · 밸류에이션">
        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[0.82rem]">✕ {error}</p>}
        {!view ? <p>불러오는 중...</p> : <>
          <section className="market-section sizing-step"><h3 className="sizing-step-title">밸류에이션 시뮬레이션</h3><ReactECharts option={chartOption} style={{ height: 280 }} /></section>
          <section className="market-section sizing-step mt-3"><h3 className="sizing-step-title">재무실적</h3>{view.financials.length === 0 ? <p className="text-[color:var(--muted-fg)]">회사 연결 또는 재무 fact가 없습니다.</p> : <table className="data-table"><thead><tr><th>연도</th><th>계정</th><th>값</th><th>출처</th></tr></thead><tbody>{view.financials.map((r) => <tr key={r.id}><td>{r.fiscal_year}</td><td>{r.account_name} ({r.ifrs_code})</td><td className="tabular-nums">{fmt(r.value)}</td><td>{r.source_code ?? "—"}</td></tr>)}</tbody></table>}</section>
          <section className="market-section sizing-step mt-3"><h3 className="sizing-step-title">보상 벤치마크</h3>{view.compBenchmarks.length === 0 ? <p className="text-[color:var(--muted-fg)]">보상 벤치마크가 없습니다.</p> : <table className="data-table"><thead><tr><th>직군</th><th>등급</th><th>표본</th><th>gap%</th><th>연간 영향</th></tr></thead><tbody>{view.compBenchmarks.map((r) => <tr key={r.id}><td>{r.job_family}</td><td>{r.grade}</td><td>{r.headcount}</td><td>{fmt(r.gap_pct)}</td><td>{fmt(r.annual_cost_delta)}</td></tr>)}</tbody></table>}</section>
        </>}
      </StageFrame>
    </main>
  );
}