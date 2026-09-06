"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import { useChartTheme } from "../lib/echarts-theme.ts";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// SSR-safe ECharts wrapper (echarts-for-react is client-only). Applies the
// Onyx dark theme defaults; callers pass the chart-specific option.
// The rendered chart is exposed to assistive technology as a single image:
// `ariaLabel` wins when provided, otherwise the chart title text (if any) is
// used as the accessible name.
export function EChart({
  option,
  height = 280,
  ariaLabel,
}: {
  option: EChartsOption;
  height?: number;
  ariaLabel?: string;
}) {
  const ct = useChartTheme();
  const titleText = Array.isArray(option.title)
    ? option.title[0]?.text
    : typeof option.title === "string"
      ? option.title
      : option.title?.text;
  const label = ariaLabel ?? (typeof titleText === "string" ? titleText : undefined);
  return (
    <div role="img" aria-label={label ?? "차트"} style={{ height, width: "100%" }}>
      <ReactECharts
        option={{ ...ct.defaults, ...option }}
        style={{ height, width: "100%" }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
