"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type SimulationResultsResponse } from "../../lib/api.ts";
import { SimulationDistChart, type SimMetric } from "../../components/SimulationDistChart.tsx";

// 수익성 분석 (/profitability) — 시뮬레이션 기반 수익성. 포트폴리오 요약(각
// 딜의 최신 시뮬레이션 NPV 분위수)과 프로젝트 상세(실행 히스토리 + 분포 차트).
// 모든 수치는 DB에 영속 저장된 simulation_result / simulation 집계에서 읽는다 —
// 요청 시 재계산하지 않는다(원시 드로우는 API 미노출 계약 유지).

interface NpvSummary {
  p05: number;
  p50: number;
  p95: number;
  mean: number;
  std: number;
}

interface ProfitabilityRow {
  project_id: string;
  project_no: string;
  rag_overall: string | null;
  simulation_id: string | null;
  run_label: string | null;
  iterations: number | null;
  discount_rate: number | null;
  simulated_at: string | null;
  simulated_by: string | null;
  npv: NpvSummary | null;
}

interface PortfolioData {
  projects: ProfitabilityRow[];
  portfolio: {
    projects_with_simulation: number;
    projects_total: number;
    npv_mean_sum_krw_m: number;
    npv_p05_sum_krw_m: number;
    npv_p95_sum_krw_m: number;
  } | null;
}

interface HistoryRow {
  simulation_id: string;
  run_id: string;
  run_label: string | null;
  created_by: string;
  iterations: number;
  discount_rate: number;
  created_at: string;
  p05: number | null;
  p50: number | null;
  p95: number | null;
  mean: number | null;
  std: number | null;
}

interface ProjectProfitability {
  project_id: string;
  project_no: string;
  latest_simulation_id: string | null;
  history: HistoryRow[];
}

const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

function NpvCell({ npv }: { npv: NpvSummary | null }) {
  if (!npv) return <span className="text-[color:var(--muted-fg)]">—</span>;
  return (
    <span className="tabular-nums">
      {nf.format(npv.p05)} / <strong>{nf.format(npv.p50)}</strong> / {nf.format(npv.p95)}
    </span>
  );
}

export function ProfitabilityView() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProfitabilityRow | null>(null);
  const [detail, setDetail] = useState<ProjectProfitability | null>(null);
  const [simResults, setSimResults] = useState<SimulationResultsResponse | null>(null);

  useEffect(() => {
    api
      .get<PortfolioData>("/api/profitability")
      .then((res) => setData(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setSimResults(null);
      return;
    }
    api
      .get<ProjectProfitability>(`/api/projects/${selected.project_id}/profitability`)
      .then((res) => setDetail(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [selected]);

  useEffect(() => {
    if (!detail?.latest_simulation_id) {
      setSimResults(null);
      return;
    }
    api
      .get<SimulationResultsResponse>(`/api/simulations/${detail.latest_simulation_id}/results`)
      .then((res) => setSimResults(res.data))
      .catch(() => setSimResults(null));
  }, [detail]);

  return (
    <main>
      <h1>수익성 분석</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        몬테카를로 시뮬레이션에 저장된 NPV 분위수(단위: 십억원 ≈ KRM) 기준 수익성 요약입니다. 딜을 선택하면 실행
        히스토리와 분포 차트가 열립니다.
      </p>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {data?.portfolio && (
        <div className="summary-cards">
          <div className="summary-card glass">
            <span className="summary-value mono-num">{data.portfolio.projects_with_simulation}</span>
            <span className="text-label">시뮬레이션 보유 딜 / 전체 {data.portfolio.projects_total}</span>
          </div>
          <div className="summary-card glass">
            <span className="summary-value mono-num">{nf.format(data.portfolio.npv_mean_sum_krw_m)}</span>
            <span className="text-label">포트폴리오 NPV 평균 합계 (KRM)</span>
          </div>
          <div className="summary-card glass">
            <span className="summary-value mono-num">{nf.format(data.portfolio.npv_p05_sum_krw_m)}</span>
            <span className="text-label">보수적 합계 (P05, KRM)</span>
          </div>
          <div className="summary-card glass">
            <span className="summary-value mono-num">{nf.format(data.portfolio.npv_p95_sum_krw_m)}</span>
            <span className="text-label">낙관적 합계 (P95, KRM)</span>
          </div>
        </div>
      )}
      {data === null ? (
        <p>불러오는 중...</p>
      ) : data.projects.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">열람 가능한 딜이 없습니다.</p>
      ) : (
        <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left" aria-label="딜별 수익성 요약">
          <caption className="sr-only">딜별 시뮬레이션 기반 수익성 요약</caption>
          <thead>
            <tr>
              <th scope="col">딜</th>
              <th scope="col">RAG</th>
              <th scope="col">NPV P05 / 중앙 / P95</th>
              <th scope="col">반복수</th>
              <th scope="col">실행</th>
            </tr>
          </thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.project_id} className={selected?.project_id === p.project_id ? "row-selected" : undefined}>
                <td className="cell-primary">
                  <button type="button" className="border-0 bg-transparent p-0 text-[color:var(--accent)] underline cursor-pointer" onClick={() => setSelected(p)}>
                    {p.project_no}
                  </button>
                </td>
                <td>{p.rag_overall ? <span className={`status-chip status-${p.rag_overall === "green" ? "green" : p.rag_overall === "amber" ? "amber" : "red"}`}>{p.rag_overall.toUpperCase()}</span> : "—"}</td>
                <td><NpvCell npv={p.npv} /></td>
                <td className="tabular-nums">{p.iterations ?? "—"}</td>
                <td className="cell-sub">{p.simulated_at ? `${p.simulated_at.slice(0, 10)} · ${p.simulated_by}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <section className="mt-8" aria-label={`${selected.project_no} 상세`}>
          <h2>
            {selected.project_no} 실행 히스토리{" "}
            <Link href={`/projects/${selected.project_id}`} className="text-[0.85rem] text-[color:var(--accent)] underline">
              딜 열기 →
            </Link>
          </h2>
          {detail === null ? (
            <p>불러오는 중...</p>
          ) : detail.history.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">
              저장된 시뮬레이션이 없습니다. 딜 상세의 시뮬레이션 탭에서 실행하면 이곳에 기록됩니다.
            </p>
          ) : (
            <>
              <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left" aria-label="시뮬레이션 히스토리">
                <caption className="sr-only">시뮬레이션 실행 히스토리</caption>
                <thead>
                  <tr>
                    <th scope="col">실행일시</th>
                    <th scope="col">런</th>
                    <th scope="col">실행자</th>
                    <th scope="col">반복수</th>
                    <th scope="col">할인율</th>
                    <th scope="col">NPV 평균</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.history.map((h) => (
                    <tr key={h.simulation_id}>
                      <td className="tabular-nums">{h.created_at.slice(0, 16).replace("T", " ")}</td>
                      <td>{h.run_label ?? h.run_id.slice(0, 8)}</td>
                      <td>{h.created_by}</td>
                      <td className="tabular-nums">{h.iterations}</td>
                      <td className="tabular-nums">{(h.discount_rate * 100).toFixed(1)}%</td>
                      <td className="tabular-nums">{h.mean !== null ? nf.format(h.mean) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {simResults && (
                <div className="mt-6">
                  <SimulationDistChart
                    results={simResults.results as SimMetric[]}
                    distribution={simResults.distribution}
                    seed={simResults.simulation?.seed}
                  />
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

export default ProfitabilityView;
