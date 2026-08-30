"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import { useChartTheme } from "../lib/echarts-theme.ts";
import type { SimulationDistribution } from "../lib/api.ts";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export interface SimMetric {
  metric: string;
  p05: number;
  p50: number;
  p95: number;
  mean: number;
  std: number;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Real-distribution path (simulation.ts 1.1.0): the server reduces the
// persisted simulation_draw rows to a fixed-bin histogram + CDF and this
// component renders it verbatim — clearly labelled as actual data. The
// illustrative quantile-reconstruction below remains ONLY as the fallback
// for simulations that predate draw persistence (distribution === null).
export function SimulationDistChart({
  results,
  seed,
  distribution,
}: {
  results: SimMetric[];
  seed?: number | string;
  distribution?: SimulationDistribution | null;
}) {
  if (results.length === 0) return null;
  return distribution && distribution.bins.length > 0 ? (
    <RealDistChart distribution={distribution} />
  ) : (
    <IllustrativeDistChart results={results} seed={seed} />
  );
}

function RealDistChart({ distribution }: { distribution: SimulationDistribution }) {
  const ct = useChartTheme();
  const option: EChartsOption = {
    ...ct.defaults,
    tooltip: { ...ct.defaults.tooltip, trigger: "axis" },
    legend: { data: ["빈도(실측)", "CDF(실측)"], textStyle: { color: ct.muted } },
    grid: { ...ct.defaults.grid, left: 48, right: 48 },
    xAxis: { type: "value", axisLabel: { color: ct.muted, fontSize: 11 } },
    yAxis: [
      { type: "value", name: "빈도", axisLabel: { color: ct.muted, fontSize: 11 } },
      { type: "value", name: "CDF", max: 1, axisLabel: { color: ct.muted, fontSize: 11 } },
    ],
    series: [
      {
        name: "빈도(실측)",
        type: "bar",
        data: distribution.bins.map((b) => [(b.start + b.end) / 2, b.count]),
        itemStyle: { color: ct.color[0] },
        barWidth: "90%",
      },
      {
        name: "CDF(실측)",
        type: "line",
        yAxisIndex: 1,
        data: distribution.cdf.map((c) => [c.value, c.p]),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: ct.color[1] },
      },
    ],
  };

  return (
    <div className="mt-6">
      <h3>NPV 분포 (실측)</h3>
      <ReactECharts option={option} style={{ height: 300, width: "100%" }} notMerge lazyUpdate />
      <p className="mt-2 text-[0.8rem] text-[color:var(--muted-fg)]">
        저장된 원시 드로우 {distribution.draws.toLocaleString("ko-KR")}개를 서버에서 {distribution.bins.length}개 구간으로 집계한 실측
        히스토그램/CDF입니다. 드로우 행 자체는 API로 노출되지 않으며(보존 정책상 N개월 후 아카이브 대상), 분위수 요약은 영구 보존됩니다.
      </p>
    </div>
  );
}

function IllustrativeDistChart({ results, seed }: { results: SimMetric[]; seed?: number | string }) {
  const ct = useChartTheme();
  if (results.length === 0) return null;
  const [selected, setSelected] = useState(results[0].metric);
  const row = results.find((r) => r.metric === selected) ?? results[0];
  const mean = row.mean;
  const std = row.std > 0 ? row.std : Math.max(Math.abs(row.p95 - row.p05) / 4, 1e-9);
  const rng = mulberry32(hashSeed(String(seed ?? "") + ":" + selected));
  const N = 2000;
  const samples: number[] = [];
  for (let i = 0; i < N; i++) samples.push(mean + std * gauss(rng));
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  const bins = 24;
  const width = (hi - lo) / bins || 1;
  const hist = new Array(bins).fill(0);
  for (const s of samples) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((s - lo) / width)));
    hist[idx]++;
  }
  const centers = hist.map((_, i) => lo + width * (i + 0.5));
  const sorted = [...samples].sort((a, b) => a - b);
  const cdf = centers.map((c) => sorted.filter((s) => s <= c).length / N);

  const option: EChartsOption = {
    ...ct.defaults,
    tooltip: { ...ct.defaults.tooltip, trigger: "axis" },
    legend: { data: ["빈도(illustrative)", "CDF(illustrative)"], textStyle: { color: ct.muted } },
    grid: { ...ct.defaults.grid, left: 48, right: 48 },
    xAxis: { type: "value", axisLabel: { color: ct.muted, fontSize: 11 } },
    yAxis: [
      { type: "value", name: "빈도", axisLabel: { color: ct.muted, fontSize: 11 } },
      { type: "value", name: "CDF", max: 1, axisLabel: { color: ct.muted, fontSize: 11 } },
    ],
    series: [
      {
        name: "빈도(illustrative)",
        type: "bar",
        data: centers.map((c, i) => [c, hist[i]]),
        itemStyle: { color: ct.color[0] },
        barWidth: "90%",
      },
      {
        name: "CDF(illustrative)",
        type: "line",
        yAxisIndex: 1,
        data: centers.map((c, i) => [c, cdf[i]]),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: ct.color[1] },
      },
    ],
  };

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2">
        <label htmlFor="sim-metric" className="text-sm text-[color:var(--muted-fg)]">
          지표
        </label>
        <select
          id="sim-metric"
          className="bg-[color:var(--surface)] border border-[color:var(--border)] rounded px-2 py-1 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {results.map((r) => (
            <option key={r.metric} value={r.metric}>
              {r.metric}
            </option>
          ))}
        </select>
      </div>
      <ReactECharts option={option} style={{ height: 300, width: "100%" }} notMerge lazyUpdate />
      <p className="mt-2 text-[0.8rem] text-[color:var(--muted-fg)] italic">
        ⚠️ illustrative: 원시 드로우(raw draws)는 아카이브되어 저장되지 않으므로, 분위수 요약(mean/std)으로부터
        정규분포를 재구성한 근사 시각화입니다. 실측 히스토그램/CDF가 아닙니다.
      </p>
    </div>
  );
}
