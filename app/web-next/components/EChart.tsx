"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import { useChartTheme } from "../lib/echarts-theme.ts";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// SSR-safe ECharts wrapper (echarts-for-react is client-only). Applies the
// Onyx dark theme defaults; callers pass the chart-specific option.
export function EChart({ option, height = 280 }: { option: EChartsOption; height?: number }) {
  const ct = useChartTheme();
  return (
    <ReactECharts
      option={{ ...ct.defaults, ...option }}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}
