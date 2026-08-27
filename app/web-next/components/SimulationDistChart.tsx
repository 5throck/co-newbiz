"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import { ONYX_CHART_DEFAULTS, ONYX_CHART_THEME } from "../lib/echarts-theme.ts";

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

// Illustrative reconstruction: raw simulation draws are archived, not stored
// (simulation_draw is never read — only the quantile summary persists). We
// fit a normal from the reported mean/std and sample it deterministically so
// the shape is stable across renders. Clearly labelled illustrative, not data.
export function SimulationDistChart({ results, seed }: { results: SimMetric[]; seed?: number | string }) {
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
    ...ONYX_CHART_DEFAULTS,
    tooltip: { ...ONYX_CHART_DEFAULTS.tooltip, trigger: "axis" },
    legend: { data: ["빈도(illustrative)", "CDF(illustrative)"], textStyle: { color: "#9aa1ad" } },
    grid: { ...ONYX_CHART_DEFAULTS.grid, left: 48, right: 48 },
    xAxis: { type: "value", axisLabel: { color: "#9aa1ad", fontSize: 11 } },
    yAxis: [
      { type: "value", name: "빈도", axisLabel: { color: "#9aa1ad", fontSize: 11 } },
      { type: "value", name: "CDF", max: 1, axisLabel: { color: "#9aa1ad", fontSize: 11 } },
    ],
    series: [
      {
        name: "빈도(illustrative)",
        type: "bar",
        data: centers.map((c, i) => [c, hist[i]]),
        itemStyle: { color: ONYX_CHART_THEME.color[0] },
        barWidth: "90%",
      },
      {
        name: "CDF(illustrative)",
        type: "line",
        yAxisIndex: 1,
        data: centers.map((c, i) => [c, cdf[i]]),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: ONYX_CHART_THEME.color[1] },
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
