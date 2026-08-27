import type { EChartsOption } from "echarts";

export const ONYX_CHART_THEME = {
  color: ["#7c9dff", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#f472b6", "#38bdf8", "#fb923c"],
  backgroundColor: "transparent",
  textStyle: {
    color: "#9aa1ad",
    fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
    fontSize: 12,
  },
  title: {
    textStyle: { color: "#eceef2", fontWeight: 600, fontSize: 14 },
  },
  legend: {
    textStyle: { color: "#9aa1ad" },
  },
  tooltip: {
    backgroundColor: "#1a1f2a",
    borderColor: "#3a4150",
    textStyle: { color: "#eceef2" },
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: "#2b303b" } },
    axisTick: { lineStyle: { color: "#2b303b" } },
    axisLabel: { color: "#9aa1ad", fontSize: 11 },
    splitLine: { lineStyle: { color: "#1a1f2a" } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: "#2b303b" } },
    axisTick: { lineStyle: { color: "#2b303b" } },
    axisLabel: { color: "#9aa1ad", fontSize: 11 },
    splitLine: { lineStyle: { color: "#1a1f2a" } },
  },
} as const;

export const ONYX_CHART_DEFAULTS: Partial<EChartsOption> = {
  backgroundColor: "transparent",
  textStyle: {
    fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
  },
  grid: {
    left: 48,
    right: 24,
    top: 40,
    bottom: 32,
    containLabel: false,
  },
  tooltip: {
    backgroundColor: "#1a1f2a",
    borderColor: "#3a4150",
    textStyle: { color: "#eceef2", fontSize: 12 },
  },
} as const;
