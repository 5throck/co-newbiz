"use client";

import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";

// Theme-aware ECharts palette. Light is the default; [data-theme="dark"] on
// <html> flips the axis/tooltip/text colors to the Onyx dark palette.
// useChartTheme() tracks the attribute via MutationObserver so already-mounted
// charts re-render on toggle.

export interface ChartTheme {
  color: string[];
  text: string;
  muted: string;
  tooltipBg: string;
  tooltipBorder: string;
  axis: string;
  split: string;
}

const LIGHT: ChartTheme = {
  color: ["#3d66f5", "#0c9d6c", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#0284c7", "#ea580c"],
  text: "#171a21",
  muted: "#5d6572",
  tooltipBg: "#ffffff",
  tooltipBorder: "rgba(16, 22, 34, 0.16)",
  axis: "rgba(16, 22, 34, 0.24)",
  split: "rgba(16, 22, 34, 0.08)",
};

const DARK: ChartTheme = {
  color: ["#7c9dff", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#f472b6", "#38bdf8", "#fb923c"],
  text: "#eceef2",
  muted: "#9aa1ad",
  tooltipBg: "#1a1f2a",
  tooltipBorder: "#3a4150",
  axis: "#2b303b",
  split: "#1a1f2a",
};

export function chartTokens(isDark: boolean): ChartTheme {
  return isDark ? DARK : LIGHT;
}

export function getChartTheme(isDark: boolean): Required<Pick<EChartsOption, "color">> & Record<string, unknown> {
  const t = chartTokens(isDark);
  return {
    color: t.color,
    backgroundColor: "transparent",
    textStyle: { color: t.muted, fontFamily: "ui-monospace, 'JetBrains Mono', monospace", fontSize: 12 },
    title: { textStyle: { color: t.text, fontWeight: 600, fontSize: 14 } },
    legend: { textStyle: { color: t.muted } },
    tooltip: { backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, textStyle: { color: t.text } },
    categoryAxis: {
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: t.split } },
    },
    valueAxis: {
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { lineStyle: { color: t.axis } },
      axisLabel: { color: t.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: t.split } },
    },
  } as const;
}

export function getChartDefaults(isDark: boolean): Partial<EChartsOption> {
  const t = chartTokens(isDark);
  return {
    backgroundColor: "transparent",
    textStyle: { color: t.muted, fontFamily: "ui-monospace, 'JetBrains Mono', monospace" },
    grid: { left: 48, right: 24, top: 40, bottom: 32, containLabel: false },
    tooltip: { backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, textStyle: { color: t.text, fontSize: 12 } },
  };
}

/** Tracks the html[data-theme] attribute; returns the current palette + merged defaults. */
export function useChartTheme() {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark",
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.dataset.theme === "dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return useMemo(
    () => ({ ...chartTokens(isDark), theme: getChartTheme(isDark), defaults: getChartDefaults(isDark) }),
    [isDark],
  );
}

// Back-compat aliases (light palette) — new code should use useChartTheme().
export const ONYX_CHART_THEME = chartTokens(false);
export const ONYX_CHART_DEFAULTS = getChartDefaults(false);
