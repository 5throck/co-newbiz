"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type ObservationRow } from "../../lib/api.ts";
import { EChart } from "../../components/EChart.tsx";
import { useChartTheme } from "../../lib/echarts-theme.ts";

// S1 시장분석 (/market) — 산업 리스트(테이블) → 클릭 시 상세 분석 드릴다운.
// 드라이버 민감도 = 바 차트, 권역별 = 도넛(점유율) + 바(NPV), 시나리오 = 그룹 바 차트.

interface IndustryRow {
  id: string; name_ko: string; name_en: string | null;
  ksic_code: string | null; naics_code: string | null; driver_count: number;
}
interface DriverRow { id: string; code: string; label_ko: string; description: string; }
interface MarketOverview {
  industries: IndustryRow[]; drivers: DriverRow[];
  stats: { value_chain_links: number; proxy_links: number; series_count: number; observation_count: number };
}
interface IndustryDetail {
  industry: { id: string; name_ko: string; name_en: string | null; ksic_code: string | null };
  driver_sensitivities: Array<{ driver_id: string; driver_label: string; sensitivity: number; lag_months: number | null; region_code: string | null }>;
  regions: Array<{ region: string; scenario_count: number; avg_p50: number | null }>;
  simulations: Array<{ scenario: string; region_code: string | null; metric: string; p05: number | null; p50: number | null; p95: number | null }>;
  series: Array<{ series_id: string; period_id: string; value: number; unit_id: string; source_id: string }>;
}
interface SeriesRow {
  series_id: string; unit_id: string; source_id: string; observation_count: number;
  min_period_id: string; max_period_id: string; last_fetched_at: string | null;
  days_since_fetch: number | null; stale: boolean;
}

const REGION_LABELS: Record<string, string> = {
  china: "중국", apac_ex_china: "아시아(중국 제외)", north_america: "북미",
  europe: "유럽", mea: "중동·아프리카", korea: "한국",
};

const DRIVER_ICONS: Record<string, string> = { rate: "📊", fx: "💱", commodity: "🏭", regulation: "📋" };

export function MarketView() {
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [detail, setDetail] = useState<IndustryDetail | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<MarketOverview>("/api/market-overview").then((r) => setOverview(r.data)).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const loadDetail = useCallback((industryId: string) => {
    setSelectedIndustry(industryId);
    setDetail(null);
    api.get<IndustryDetail>(`/api/market-overview/industry/${encodeURIComponent(industryId)}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "상세 불러오기 실패"));
  }, []);

  return (
    <main>
      <h1>시장분석</h1>
      <p className="mt-[0.15rem] mb-4 text-[color:var(--muted-fg)] text-[0.9rem]">
        프로세스 스테이지 S1 — 산업을 선택하면 가치사슬·드라이버·권역별 데이터가 차트로 표시됩니다.
        기회를 발굴하려면 <Link href="/opportunities" className="text-[color:var(--accent)] underline">기회 발굴(S2)</Link>으로 이어가세요.
      </p>
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── 산업 리스트 (테이블) ── */}
      <section aria-label="산업 리스트" className="market-section">
        <h2>🏭 분석 대상 산업</h2>
        {overview === null ? (
          <p>불러오는 중...</p>
        ) : overview.industries.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 산업이 없습니다.</p>
        ) : (
          <table className="data-table" aria-label="분석 대상 산업">
            <caption className="sr-only">분석 대상 산업 목록</caption>
            <thead>
              <tr>
                <th scope="col">산업명</th>
                <th scope="col">KSIC 코드</th>
                <th scope="col">연결 드라이버</th>
                <th scope="col">액션</th>
              </tr>
            </thead>
            <tbody>
              {overview.industries.map((ind) => (
                <tr key={ind.id} className={selectedIndustry === ind.id ? "row-selected" : undefined}>
                  <td className="cell-primary font-semibold">{ind.name_ko}</td>
                  <td><code className="dd-item-id">{ind.ksic_code ?? "—"}</code></td>
                  <td className="tabular-nums">{ind.driver_count}건</td>
                  <td>
                    <button type="button" className="btn-ghost text-[0.78rem]" onClick={() => loadDetail(ind.id)}>
                      분석 열기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── 산업 상세 (차트 중심) ── */}
      {detail && (
        <section aria-label="산업 상세 분석" className="market-section">
          <h2 className="mb-4">
            📊 {detail.industry.name_ko} 상세 분석
            {detail.industry.ksic_code && <code className="dd-item-id ml-2">{detail.industry.ksic_code}</code>}
          </h2>

          {/* ── 드라이버 민감도 (바 차트) ── */}
          <div className="market-sub-section">
            <h3>1️⃣ 드라이버 민감도 — 주요 드라이버 도출</h3>
            <p className="mb-2 text-[color:var(--muted-fg)] text-[0.78rem]">
              전체 드라이버의 민감도를 분석한 후, 민감도 절댓값이 0.3 이상인 드라이버를
              <strong className="text-[color:var(--primary)]"> 주요 드라이버</strong>로 도출합니다.
            </p>
            {detail.driver_sensitivities.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic text-[0.8rem]">기록된 드라이버 민감도가 없습니다.</p>
            ) : (
              <DriverSensitivityChart sensitivities={detail.driver_sensitivities} />
            )}
          </div>

          {/* ── 권역별 분석 (도넛 + 바 차트, 좌/우) ── */}
          <div className="market-sub-section">
            <h3>2️⃣ 권역별 분석</h3>
            {detail.regions.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic text-[0.8rem]">권역별 데이터가 없습니다. 구조 시뮬레이션을 실행하면 권역별 수요가 기록됩니다.</p>
            ) : (
              <div className="chart-pair">
                <div className="chart-half">
                  <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">시장점유율 (도넛)</h4>
                  <RegionalPieChart regions={detail.regions} />
                </div>
                <div className="chart-half">
                  <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">평균 NPV (바)</h4>
                  <RegionalBarChart regions={detail.regions} />
                </div>
              </div>
            )}
          </div>

          {/* ── 시나리오 시뮬레이션 결과 (그룹 바 차트 + 표) ── */}
          {detail.simulations.length > 0 && (
            <div className="market-sub-section">
              <h3>3️⃣ 시나리오 시뮬레이션 결과</h3>
              <div className="chart-pair">
                <div className="chart-half">
                  <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 시장점유율 추이 (선)</h4>
                  <ScenarioGroupChart simulations={detail.simulations} metric="share" />
                </div>
                <div className="chart-half">
                  <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 NPV 추이 (선)</h4>
                  <ScenarioGroupChart simulations={detail.simulations} metric="npv" />
                </div>
              </div>
              <SimulationTable simulations={detail.simulations} />
            </div>
          )}

          {/* ── 시계열 데이터 ── */}
          {detail.series.length > 0 && (
            <div className="market-sub-section">
              <h3>산업 시계열 데이터</h3>
              <p className="text-[color:var(--muted-fg)] text-[0.78rem]">{detail.series.length}건의 관측치</p>
            </div>
          )}
        </section>
      )}

      {/* ── 시장 시계열 (하단, 기존 유지) ── */}
      <TimeSeriesSection />
    </main>
  );
}

// ── 드라이버 민감도 바 차트 + 주요 드라이버 도출 프로세스 ──
const KEY_DRIVER_THRESHOLD = 0.3;

function DriverSensitivityChart({ sensitivities }: { sensitivities: Array<{ driver_label: string; sensitivity: number; region_code: string | null }> }) {
  // 주요 드라이버 도출 프로세스 표시
  const aggProcess = new Map<string, number>();
  for (const ds of sensitivities) {
    aggProcess.set(ds.driver_label, Math.abs(ds.sensitivity));
  }
  const sortedDrivers = [...aggProcess.entries()].sort((a, b) => b[1] - a[1]);
  const keyCount = sortedDrivers.filter(([, v]) => v >= KEY_DRIVER_THRESHOLD).length;
  const keyNames = sortedDrivers.filter(([, v]) => v >= KEY_DRIVER_THRESHOLD).map(([k]) => k);
  const ct = useChartTheme();
  // Deduplicate by driver_label, aggregate sensitivity
  const agg = new Map<string, { total: number; count: number; regions: string[] }>();
  for (const ds of sensitivities) {
    if (!agg.has(ds.driver_label)) agg.set(ds.driver_label, { total: 0, count: 0, regions: [] });
    const entry = agg.get(ds.driver_label)!;
    entry.total += Math.abs(ds.sensitivity);
    entry.count++;
    if (ds.region_code) entry.regions.push(ds.region_code);
  }
  const labels = [...agg.keys()];
  const values = labels.map((l) => {
    const e = agg.get(l)!;
    return Math.round((e.total / e.count) * 100) / 100;
  });

  const option = {
    grid: { left: 140, right: 40, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: labels, axisLabel: { color: ct.muted, width: 120, overflow: "truncate" as const } },
    series: [{
      type: "bar" as const, data: values,
      itemStyle: { color: ct.color[0], borderRadius: [0, 4, 4, 0] },
      barMaxWidth: 24,
    }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };

  return (
    <div>
      {/* 주요 드라이버 도출 프로세스 */}
      <div className="driver-derivation">
        <div className="driver-derivation-step">
          <span className="status-chip status-in-progress">Step 1</span>
          <span>전체 드라이버 {sortedDrivers.length}개 분석</span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-amber">Step 2</span>
          <span>민감도 절댓값 ≥ {KEY_DRIVER_THRESHOLD} 필터링</span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-green">주요 드라이버 {keyCount}개</span>
          <span>{keyNames.join(", ") || "없음"}</span>
        </div>
      </div>
      <EChart option={option} height={Math.max(160, labels.length * 40 + 48)} />
    </div>
  );
}

// ── 권역별 도넛 차트 (시장점유율) ──
function RegionalPieChart({ regions }: { regions: Array<{ region: string; avg_p50: number | null }> }) {
  const ct = useChartTheme();
  const valid = regions.filter((r) => r.avg_p50 !== null && r.avg_p50 > 0);
  if (valid.length === 0) return null;
  const total = valid.reduce((a, r) => a + (r.avg_p50 ?? 0), 0);
  const option: Record<string, unknown> = {
    tooltip: { trigger: "item", formatter: (p: { name?: string; value?: number; percent?: number }) => `${p.name}: ${p.value?.toLocaleString()} KRM (${p.percent}%)` },
    legend: { bottom: 0, textStyle: { color: ct.muted } },
    series: [{
      type: "pie" as const,
      radius: ["40%", "70%"],
      label: { color: ct.muted, formatter: "{b}\n{d}%" },
      data: valid.map((r) => ({ name: REGION_LABELS[r.region] ?? r.region, value: r.avg_p50 })),
    }],
  };
  return (
    <div>
      <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 시장점유율 (NPV P50 기준)</h4>
      <EChart option={option as never} height={280} />
    </div>
  );
}

// ── 권역별 바 차트 (평균 NPV) ──
function RegionalBarChart({ regions }: { regions: Array<{ region: string; avg_p50: number | null }> }) {
  const ct = useChartTheme();
  const labels = regions.map((r) => REGION_LABELS[r.region] ?? r.region);
  const values = regions.map((r) => r.avg_p50 ?? 0);
  const option = {
    grid: { left: 80, right: 24, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: labels, axisLabel: { color: ct.muted } },
    series: [{
      type: "bar" as const, data: values,
      itemStyle: { color: ct.color[1], borderRadius: [0, 4, 4, 0] },
      barMaxWidth: 28,
    }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return (
    <div className="mt-4">
      <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 평균 NPV (KRM)</h4>
      <EChart option={option} height={Math.max(160, regions.length * 44 + 48)} />
    </div>
  );
}

// ── 시나리오별 권역 데이터 선 그래프 (점유율 or NPV) ──
function ScenarioGroupChart({ simulations, metric }: {
  simulations: Array<{ scenario: string; region_code: string | null; p05: number | null; p50: number | null; p95: number | null }>;
  metric: "share" | "npv";
}) {
  const ct = useChartTheme();
  // Group by scenario → region → aggregate P50
  const byScenario = new Map<string, Map<string, number[]>>();
  for (const s of simulations) {
    const region = s.region_code ?? "기타";
    if (!byScenario.has(s.scenario)) byScenario.set(s.scenario, new Map());
    const byRegion = byScenario.get(s.scenario)!;
    if (!byRegion.has(region)) byRegion.set(region, []);
    if (s.p50 !== null) byRegion.get(region)!.push(s.p50);
  }

  const regionNames = [...new Set(simulations.map((s) => s.region_code).filter(Boolean))] as string[];
  const scenarioNames = [...byScenario.keys()];

  const seriesData = regionNames.map((region) => {
    const data = scenarioNames.map((sc) => {
      const regionData = byScenario.get(sc)?.get(region);
      if (!regionData || regionData.length === 0) return null;
      const avgP50 = regionData.reduce((a, b) => a + b, 0) / regionData.length;
      if (metric === "share") {
        const total = scenarioNames.reduce((sum, sc2) => {
          const rd = byScenario.get(sc2)?.get(region);
          return sum + (rd ? rd.reduce((a, b) => a + b, 0) / rd.length : 0);
        }, 0);
        return total > 0 ? Math.round((avgP50 / total) * 1000) / 10 : null;
      }
      return Math.round(avgP50 * 10) / 10;
    });
    return {
      name: REGION_LABELS[region] ?? region,
      type: "line" as const,
      data,
      smooth: true,
      symbol: "circle" as const,
      symbolSize: 6,
    };
  });

  const yAxisName = metric === "share" ? "점유율 (%)" : "NPV (KRM)";

  const option = {
    grid: { left: 56, right: 20, top: 36, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "category" as const, data: scenarioNames, axisLabel: { color: ct.muted, fontSize: 10 } },
    yAxis: {
      type: "value" as const, name: yAxisName, nameTextStyle: { color: ct.muted, fontSize: 10 },
      axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } },
    },
    series: seriesData,
    tooltip: { trigger: "axis" as const },
  };

  const title = metric === "share" ? "권역별 시장점유율 추이 (선)" : "권역별 NPV 추이 (선)";

  return (
    <div>
      <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">{title}</h4>
      <EChart option={option} height={260} />
    </div>
  );
}

// ── 시뮬레이션 상세 테이블 ──
function SimulationTable({ simulations }: { simulations: Array<{ scenario: string; region_code: string | null; metric: string; p05: number | null; p50: number | null; p95: number | null }> }) {
  return (
    <table className="data-table mt-4" aria-label="시나리오 시뮬레이션 상세">
      <caption className="sr-only">시나리오별 시뮬레이션 상세</caption>
      <thead>
        <tr>
          <th scope="col">시나리오</th>
          <th scope="col">권역</th>
          <th scope="col">P05</th>
          <th scope="col">P50</th>
          <th scope="col">P95</th>
        </tr>
      </thead>
      <tbody>
        {simulations.map((sim, i) => (
          <tr key={i}>
            <td>{sim.scenario}</td>
            <td>{sim.region_code ? (REGION_LABELS[sim.region_code] ?? sim.region_code) : "—"}</td>
            <td className="tabular-nums">{sim.p05 !== null ? sim.p05.toLocaleString("ko-KR") : "—"}</td>
            <td className="tabular-nums">{sim.p50 !== null ? sim.p50.toLocaleString("ko-KR") : "—"}</td>
            <td className="tabular-nums">{sim.p95 !== null ? sim.p95.toLocaleString("ko-KR") : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 시계열 섹션 (하단, 기존 로직 유지) ──
function TimeSeriesSection() {
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [observations, setObservations] = useState<ObservationRow[] | null>(null);
  const ct = useChartTheme();

  useEffect(() => {
    const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    api.get<SeriesRow[]>(`/api/series${qs}`).then((r) => setSeries(r.data)).catch(() => setSeries([]));
  }, [query]);

  useEffect(() => {
    if (!selected) { setObservations(null); return; }
    api.get<ObservationRow[]>(`/api/series/${encodeURIComponent(selected)}/observations`)
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
      series: [{
        type: "line" as const, smooth: true, data: sorted.map((o) => o.value),
        itemStyle: { color: ct.color[0] }, areaStyle: { color: ct.color[0], opacity: 0.12 },
      }],
    };
  }, [observations, ct]);

  return (
    <section aria-label="시장 시계열" className="market-section">
      <h2>📈 시장 시계열</h2>
      <input type="search" aria-label="시계열 검색" placeholder="시계열 ID 검색" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-3" />
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
                  <button type="button" className={`library-doc-item ${selected === s.series_id ? "library-doc-item-active" : ""}`} onClick={() => setSelected(s.series_id)}>
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
                <h3 className="text-[1rem] mb-2">{selected}</h3>
                {chartOption && <EChart option={chartOption} height={320} />}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default MarketView;
