"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type ObservationRow } from "../../lib/api.ts";
import { EChart } from "../../components/EChart.tsx";
import { useChartTheme } from "../../lib/echarts-theme.ts";

// S1 시장분석 (/market) — 사이드바 페이즈 흐름의 첫 실행 화면. 수집된 시장
// 시계열(관측치)을 조회해 관심 시장을 파악하고, 기회 발굴(S2)로 이어진다.
// 데이터는 fact_market_observation의 영속 관측치다(요청 시 재수집 없음).

interface SeriesRow {
  series_id: string;
  unit_id: string;
  source_id: string;
  observation_count: number;
  min_period_id: string;
  max_period_id: string;
  last_fetched_at: string | null;
  days_since_fetch: number | null;
  stale: boolean;
}

export function MarketView() {
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [observations, setObservations] = useState<ObservationRow[] | null>(null);
  const ct = useChartTheme();

  const load = useCallback(() => {
    const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    api.get<SeriesRow[]>(`/api/series${qs}`).then((r) => setSeries(r.data)).catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setObservations(null);
      return;
    }
    api
      .get<ObservationRow[]>(`/api/series/${encodeURIComponent(selected)}/observations`)
      .then((r) => setObservations(r.data))
      .catch(() => setObservations([]));
  }, [selected]);

  const chartOption = useMemo(() => {
    if (!observations || observations.length === 0) return null;
    const sorted = [...observations].sort((a, b) => a.period_id.localeCompare(b.period_id));
    return {
      grid: { left: 56, right: 24, top: 24, bottom: 32 },
      xAxis: { type: "category" as const, data: sorted.map((o) => o.period_id), axisLabel: { color: ct.muted } },
      yAxis: { type: "value" as const, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
      series: [
        {
          type: "line" as const,
          smooth: true,
          data: sorted.map((o) => o.value),
          itemStyle: { color: ct.color[0] },
          areaStyle: { color: ct.color[0], opacity: 0.12 },
        },
      ],
    };
  }, [observations, ct]);

  return (
    <main>
      <h1>시장 분석</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        프로세스 스테이지 S1 — 수집된 시장 시계열을 조회해 관심 시장과 수요 구조를 파악합니다. 분석된 시장에서 기회를
        발굴하려면 <Link href="/opportunities" className="text-[color:var(--accent)] underline">기회 발굴(S2)</Link>으로
        이어가세요.
      </p>
      <input
        type="search"
        aria-label="시계열 검색"
        placeholder="시계열 ID 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-3"
      />
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {series === null ? (
        <p>불러오는 중...</p>
      ) : series.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">등록된 시장 시계열이 없습니다.</p>
      ) : (
        <div className="market-layout">
          <div className="market-list-pane">
            <p className="mb-1 text-[color:var(--muted-fg)] text-[0.8rem]">총 {series.length}개 시계열</p>
            <ul className="market-series-list">
              {series.map((s) => (
                <li key={s.series_id}>
                  <button
                    type="button"
                    className={`library-doc-item ${selected === s.series_id ? "library-doc-item-active" : ""}`}
                    onClick={() => setSelected(s.series_id)}
                  >
                    <span className="library-doc-title">{s.series_id}</span>
                    <span className="library-doc-meta">
                      <span>{s.observation_count} 관측</span>
                      <span>{s.min_period_id}~{s.max_period_id}</span>
                      <span className="library-doc-lang">{s.unit_id}</span>
                      {s.stale && <span className="status-chip status-amber">stale</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="market-chart-pane">
            {!selected ? (
              <p className="text-[color:var(--muted-fg)] italic">왼쪽에서 시계열을 선택하면 추이가 표시됩니다.</p>
            ) : observations === null ? (
              <p>불러오는 중...</p>
            ) : observations.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic">관측치가 없습니다.</p>
            ) : (
              <>
                <h2 className="text-[1rem] mb-2">{selected}</h2>
                {chartOption && <EChart option={chartOption} height={320} />}
                <p className="mt-2 text-[color:var(--muted-fg)] text-[0.8rem]">
                  {(() => {
                    const meta = series.find((s) => s.series_id === selected);
                    return `출처 ${meta?.source_id ?? "—"} · 기간 ${meta?.min_period_id ?? ""}~${meta?.max_period_id ?? ""}`;
                  })()}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default MarketView;
