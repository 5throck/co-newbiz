"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { type SizingMatrix, regionTotal } from "../../../lib/market-sizing.ts";
import { useChartTheme } from "../../../lib/echarts-theme.ts";
import { EChart } from "../../EChart.tsx";
import { r3 } from "./marketFormat.ts";
import { useTranslations } from "next-intl";

// 라벨은 카탈로그 키 — 렌더 시 TranslatorFn으로 푼다.
export const SCENARIOS_META = [
  { key: "down" as const, label: "stages.s1.sizingScenarioCharts.pessimistic" },
  { key: "base" as const, label: "common.defaultLabel" },
  { key: "up" as const, label: "stages.s1.sizingScenarioCharts.optimistic" },
];

export function RegionScenarioChart({ matrix }: { matrix: SizingMatrix }) {const tr = useTranslations(); const t = useTranslations("stages.s1.sizingScenarioCharts");
  const ct = useChartTheme();
  const option = {
    grid: { left: 110, right: 40, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `$${Number(v)}`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: SCENARIOS_META.map((s) => ({
      name: tr(s.label),
      type: "bar" as const,
      data: [...matrix.regions].reverse().map((r) => r3(regionTotal(matrix, r.code, 4, s.key))),
      itemStyle: {
        color: s.key === "base" ? ct.color[0] : s.key === "up" ? ct.color[3] : ct.color[1],
        opacity: s.key === "base" ? 1 : 0.6,
        borderRadius: [0, 3, 3, 0],
      },
      barMaxWidth: 12,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel={t("scenarioCagrByRegionAnd")} height={280} />;
}

export function RegionScenarioTable({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingScenarioCharts"); const tc = useTranslations("common");
  const globals = SCENARIOS_META.map((s) => matrix.regions.reduce((a, r) => a + regionTotal(matrix, r.code, 4, s.key), 0));
  return (
    <table className="data-table" aria-label={t("n2030OutlookByScenarioAnd")}>
      <caption className="sr-only">{t("n2030OutlookByScenarioAnd2")}</caption>
      <thead><tr><th scope="col">{tc("region")}</th><th scope="col">{t("pessimistic2")}</th><th scope="col">{tc("defaultLabel")}</th><th scope="col">{t("optimistic2")}</th></tr></thead>
      <tbody>
        {matrix.regions.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            {SCENARIOS_META.map((s) => (
              <td key={s.key} className="tabular-nums">{r3(regionTotal(matrix, r.code, 4, s.key)).toFixed(3)}</td>
            ))}
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">{t("global")}</td>
          {globals.map((g, i) => (
            <td key={i} className="tabular-nums font-semibold">{r3(g).toFixed(2)}</td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/* ── 4-A 연도별 시장점유율 (기본 시나리오, 셀 CAGR 연간 복리) ── */
export const YEARS = [2026, 2027, 2028, 2029, 2030];

export function yearlyShareMatrix(matrix: SizingMatrix): { years: number[]; shares: Record<string, number[]>; totals: number[] } {
  const shares: Record<string, number[]> = {};
  const totals = YEARS.map(() => 0);
  for (const r of matrix.regions) {
    shares[r.code] = YEARS.map((_, y) => regionTotal(matrix, r.code, y));
    totals.forEach((_, y) => { totals[y] += shares[r.code][y]; });
  }
  for (const r of matrix.regions) {
    shares[r.code] = shares[r.code].map((v, y) => Math.round((v / totals[y]) * 1000) / 10);
  }
  return { years: YEARS, shares, totals: totals.map((t) => Math.round(t * 100) / 100) };
}

export function YearlyShareAreaChart({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingScenarioCharts");
  const ct = useChartTheme();
  const { shares } = yearlyShareMatrix(matrix);
  const option = {
    grid: { left: 48, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "category" as const, data: YEARS.map(String), boundaryGap: false, axisLabel: { color: ct.muted } },
    yAxis: { type: "value" as const, max: 100, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    series: matrix.regions.map((r, i) => ({
      name: r.label,
      type: "line" as const,
      stack: "share",
      data: shares[r.code],
      areaStyle: { opacity: 0.75 },
      lineStyle: { width: 1 },
      itemStyle: { color: ct.color[i % ct.color.length] },
      symbol: "none" as const,
    })),
    tooltip: { trigger: "axis" as const, valueFormatter: (v: unknown) => `${Number(v)}%` },
  };
  return <EChart option={option} ariaLabel={t("regionalShareTrendByYear")} height={300} />;
}

export function YearlySizeStackedBar({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingScenarioCharts");
  const ct = useChartTheme();
  const option = {
    grid: { left: 48, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "category" as const, data: YEARS.map(String), axisLabel: { color: ct.muted } },
    yAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    series: matrix.regions.map((r, i) => ({
      name: r.label,
      type: "bar" as const,
      stack: "size",
      data: YEARS.map((_, y) => Math.round(regionTotal(matrix, r.code, y) * 100) / 100),
      itemStyle: { color: ct.color[i % ct.color.length] },
      barMaxWidth: 42,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel={t("regionalMarketSizeByYear")} height={300} />;
}

export function YearlyShareTable({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingScenarioCharts"); const tc = useTranslations("common");
  const { years, shares, totals } = yearlyShareMatrix(matrix);
  return (
    <table className="data-table mt-3" aria-label={t("regionalShareByYear")}>
      <caption className="sr-only">{t("regionalShareByYearAnd")}</caption>
      <thead>
        <tr>
          <th scope="col">{tc("region")}</th>
          {years.map((y) => <th key={y} scope="col">{y} {t("marketShare")}</th>)}
        </tr>
      </thead>
      <tbody>
        {matrix.regions.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            {years.map((_, y) => (
              <td key={y} className="tabular-nums">{shares[r.code][y].toFixed(1)}%</td>
            ))}
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">{t("globalTotalMarket")}</td>
          {totals.map((t, y) => <td key={y} className="tabular-nums font-semibold">{t.toFixed(2)}</td>)}
        </tr>
      </tbody>
    </table>
  );
}

export function ConsistencyChart({ matrix }: { matrix: SizingMatrix }) {const t = useTranslations("stages.s1.sizingScenarioCharts");
  const ct = useChartTheme();
  // 축 상한은 데이터에서 뽑는다 — 8 고정이면 CAGR이 8%를 넘는 딜에서 막대가 축을
  // 넘어 잘려 꽉 찬 형태로 렌더링됐다(2026-09-15 사용자 리포트). 유효 CAGR 최댓값의
  // 1.1배를 5% 단위로 올림해 라벨 여유를 확보하고, 작은 값에서는 기존처럼 8을 하한으로.
  const cagrs = [matrix.consistency.bottomUpCagr, matrix.consistency.topDownCagr]
    .filter((v) => Number.isFinite(v) && v > 0);
  const axisMax = cagrs.length > 0 ? Math.max(8, Math.ceil((Math.max(...cagrs) * 1.1) / 5) * 5) : 8;
  const option = {
    grid: { left: 130, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, min: 0, max: axisMax, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [t("matrix"), matrix.consistency.topDownCagr > 0 ? t("consensus") : t("consensusNotEntered")], axisLabel: { color: ct.muted, fontSize: 10 } },
    series: [{
      type: "bar" as const,
      data: [
        { value: matrix.consistency.bottomUpCagr, itemStyle: { color: ct.color[0], borderRadius: [0, 4, 4, 0] } },
        { value: matrix.consistency.topDownCagr, itemStyle: { color: ct.color[2], opacity: 0.6, borderRadius: [0, 4, 4, 0] } },
      ],
      barMaxWidth: 26,
      label: { show: true, position: "right" as const, formatter: "{c}%", color: ct.muted, fontSize: 11 },
    }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} ariaLabel={t("assumptionConsistencyDiagnostics")} height={140} />;
}