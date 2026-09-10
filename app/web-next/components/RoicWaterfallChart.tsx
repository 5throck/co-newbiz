"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import { useChartTheme } from "../lib/echarts-theme.ts";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface WfStep {
  step: string;
  value: number;
  kind: "total" | "delta" | "subtotal" | "pct";
}

// ROIC margin-bridge waterfall (Revenue -> -OpCost -> -Tax -> NOPAT).
// The pct step (ROIC%) is excluded from the bar chart because it lives on a
// different scale; it is already surfaced as a KPI above the chart.
// numberFormat="percent" (ADR-0115 WACC build-up) switches labels/tooltips
// to rates — values stay raw decimals, axis and tooltip render ×100 + "%".
export function RoicWaterfallChart({
  steps,
  numberFormat = "amount",
}: {
  steps: WfStep[];
  numberFormat?: "amount" | "percent";
}) {
  const ct = useChartTheme();
  const bars = steps.filter((s) => s.kind !== "pct");
  const base: number[] = [];
  const vals: number[] = [];
  const colors: string[] = [];
  const palette = ct.color;
  let running = 0;
  for (const s of bars) {
    if (s.kind === "total" || s.kind === "subtotal") {
      base.push(0);
      vals.push(s.value);
      colors.push(s.kind === "total" ? palette[1] : palette[0]);
      running = s.value;
    } else {
      const start = running;
      base.push(Math.min(start, start + s.value));
      vals.push(Math.abs(s.value));
      colors.push(s.value < 0 ? palette[3] : palette[1]);
      running = start + s.value;
    }
  }

  const option: EChartsOption = {
    ...ct.defaults,
    tooltip: {
      ...ct.defaults.tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const p = (params as { name: string; value: number; dataIndex: number }[])[0];
        const raw = bars[p.dataIndex];
        const display =
          numberFormat === "percent" || raw.kind === "pct"
            ? `${(raw.value * 100).toFixed(2)}%`
            : raw.value.toLocaleString("ko-KR");
        return `${p.name}<br/>${display}`;
      },
    },
    grid: { ...ct.defaults.grid, left: 56 },
    xAxis: {
      type: "category",
      data: bars.map((b) => b.step),
      axisLabel: { color: ct.muted, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: ct.muted,
        fontSize: 11,
        formatter: numberFormat === "percent" ? (v: number) => `${(v * 100).toFixed(1)}%` : undefined,
      },
    },
    series: [
      {
        type: "bar",
        stack: "wf",
        itemStyle: { color: "transparent" },
        data: base,
        silent: true,
      },
      {
        type: "bar",
        stack: "wf",
        data: vals.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [3, 3, 0, 0] } })),
        barWidth: "55%",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 280, width: "100%" }} notMerge lazyUpdate />;
}
