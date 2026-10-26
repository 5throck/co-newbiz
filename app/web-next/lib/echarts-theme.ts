"use client";

import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";

// Theme-aware ECharts palette — resolved from the runtime token SSOT
// (styles.css) via getComputedStyle, never re-declared here. The categorical
// series palette lives in the --chart-1..8 tokens (light + dark overrides);
// text/surface/border values map 1:1 to their semantic tokens, so a theme
// change flows to charts with zero code edits (ADR-0087: tokens are the only
// color source outside styles.css).
//
// useChartTheme() tracks the html[data-theme] attribute via MutationObserver
// so already-mounted charts re-render on toggle, and re-resolves once after
// first paint in case stylesheets finished loading after hydration.

export interface ChartTheme {
  color: string[];
  text: string;
  muted: string;
  tooltipBg: string;
  tooltipBorder: string;
  axis: string;
  split: string;
  /** Status-convention pairs (2026-10-26 UX review F7): success/failure must
   *  follow the green/red convention tokens (--chart-2 / --chart-4), never the
   *  categorical palette order. Canvas reads no CSS vars, so callers bind
   *  series itemStyle.color from these resolved values. */
  statusOk: string;
  statusFailed: string;
}

/** Neutral, theme-agnostic safety net used only before stylesheets resolve.
 *  Status pairs fall back to gray — never the wrong hue. */
const UNRESOLVED: ChartTheme = {
  color: ["#808080", "#6b7280", "#9ca3af", "#4b5563", "#6b7280", "#9ca3af", "#4b5563", "#6b7280"],
  text: "#808080",
  muted: "#808080",
  tooltipBg: "#ffffff",
  tooltipBorder: "#808080",
  axis: "#808080",
  split: "#808080",
  statusOk: "#808080",
  statusFailed: "#808080",
};

function readToken(name: string): string | null {
  if (typeof window === "undefined") return null;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || null;
}

function readTokenList(names: string[]): string[] | null {
  const values = names.map(readToken);
  return values.every(Boolean) ? (values as string[]) : null;
}

/** Resolve the ChartTheme for the CURRENTLY applied theme attribute. */
function resolveChartTheme(): ChartTheme {
  const color = readTokenList(["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6", "--chart-7", "--chart-8"]);
  const text = readToken("--fg");
  const muted = readToken("--muted-fg");
  const tooltipBg = readToken("--surface");
  const tooltipBorder = readToken("--border");
  const axis = readToken("--border-bright");
  const split = readToken("--border-subtle");
  const statusOk = readToken("--chart-2");
  const statusFailed = readToken("--chart-4");
  if (!color || !text || !muted || !tooltipBg || !tooltipBorder || !axis || !split || !statusOk || !statusFailed) return UNRESOLVED;
  return { color, text, muted, tooltipBg, tooltipBorder, axis, split, statusOk, statusFailed };
}

export function chartTokens(_isDark: boolean): ChartTheme {
  // The isDark parameter is retained for API compatibility — resolution is
  // theme-attribute-driven, so the parameter carries no information.
  void _isDark;
  return resolveChartTheme();
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
  // Re-resolve once after first paint — if hydration beat stylesheet load,
  // the first resolution fell back to UNRESOLVED and needs one retry.
  const [repaint, setRepaint] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.dataset.theme === "dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const raf = requestAnimationFrame(() => setRepaint((n) => n + 1));
    const onLoad = () => setRepaint((n) => n + 1);
    window.addEventListener("load", onLoad);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("load", onLoad);
    };
  }, []);
  return useMemo(
    () => ({ ...chartTokens(isDark), theme: getChartTheme(isDark), defaults: getChartDefaults(isDark) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repaint forces re-resolution after stylesheet load
    [isDark, repaint],
  );
}
