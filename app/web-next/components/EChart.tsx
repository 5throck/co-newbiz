"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import { ONYX_CHART_DEFAULTS } from "../lib/echarts-theme.ts";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// SSR-safe ECharts wrapper (echarts-for-react is client-only). Applies the
// Onyx dark theme defaults; callers pass the chart-specific option.
export function EChart({ option, height = 280 }: { option: EChartsOption; height?: number }) {
  return (
    <ReactECharts
      option={{ ...ONYX_CHART_DEFAULTS, ...option }}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
    />
  );
}
