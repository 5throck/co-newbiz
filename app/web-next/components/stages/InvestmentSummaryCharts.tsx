"use client";

import { useChartTheme } from "../../lib/echarts-theme.ts";
import { buildInvestmentChartData, type InvestmentSummary } from "../../lib/capability-cost-lines.ts";
import { EChart } from "../EChart.tsx";
import { useTranslations } from "next-intl";

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const UNIT_KEY = "common.krwMillionUnit";
const CAT_ICON = { labor: "●", opex: "▲", capex: "■" } as const;

// 투자비 요약 charts (read-only, decision support). The summary tables below stay the source of truth.
// Colours come from the --chart-N tokens; decals (patterns), direct data labels and a data table keep
// colour from being the only carrier. Mounted only while the 투자비 tab is active (0-width safe).
export function InvestmentSummaryCharts({ summary }: { summary: InvestmentSummary }) {const tr = useTranslations();const t = useTranslations("stages.s5.investmentSummaryCharts"); const tc = useTranslations("common");
  const ct = useChartTheme();
  const d = buildInvestmentChartData(summary);
  if (!d.hasData) {
    return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-chart-empty">{t("noInvestmentItemsToChart")}</p>;
  }
  const cats = [
    { key: "labor", name: tc("laborCost"), data: d.stacks.labor, color: ct.color[0] },
    { key: "opex", name: tc("opex"), data: d.stacks.opex, color: ct.color[1] },
    { key: "capex", name: tc("capex"), data: d.stacks.capex, color: ct.color[2] },
  ] as const;
  const axisBase = { axisLabel: { color: ct.muted }, nameTextStyle: { color: ct.muted } };
  const yearOption = {
    aria: { enabled: true, decal: { show: true } },
    grid: { left: 8, right: 24, top: 48, bottom: 28, containLabel: true },
    legend: { top: 0, type: "scroll" as const, textStyle: { color: ct.muted } },
    tooltip: { trigger: "axis" as const, valueFormatter: (v: unknown) => `${fmt(Number(v))} ${tr(UNIT_KEY)}` },
    xAxis: { type: "category" as const, data: d.years, name: tc("tenure"), nameLocation: "middle" as const, nameGap: 24, ...axisBase },
    yAxis: { type: "value" as const, name: t("amountP1", { p1: tr(UNIT_KEY) }), axisLabel: { color: ct.muted, formatter: (v: number) => fmt(v) }, nameTextStyle: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    series: [
      ...cats.map((c) => ({ name: c.name, type: "bar" as const, stack: "invest", data: [...c.data], itemStyle: { color: c.color }, barMaxWidth: 40 })),
      { name: t("cumulativeInvestment"), type: "line" as const, data: d.cumulative, symbol: "circle", symbolSize: 7, itemStyle: { color: ct.text }, lineStyle: { color: ct.text, width: 2 }, label: { show: true, color: ct.text, position: "top" as const, formatter: (p: { value?: unknown }) => fmt(Number(p.value)) } },
      { name: t("revenueExcludingInvestment"), type: "line" as const, data: d.revenue, symbol: "diamond", symbolSize: 8, itemStyle: { color: ct.color[3] }, lineStyle: { color: ct.color[3], type: "dashed" as const, width: 2 } },
      { name: t("governmentRDExcludingInvestment"), type: "line" as const, data: d.govRnd, symbol: "triangle", symbolSize: 8, itemStyle: { color: ct.color[4] }, lineStyle: { color: ct.color[4], type: "dotted" as const, width: 2 } },
    ],
  };
  const compOption = {
    aria: { enabled: true, decal: { show: true } },
    grid: { left: 8, right: 120, top: 8, bottom: 28, containLabel: true },
    tooltip: { trigger: "item" as const, formatter: (p: { name?: string; dataIndex?: number }) => { const c = d.composition[p.dataIndex ?? 0]; return `${p.name}: ${fmt(c.totalKrwM)} ${tr(UNIT_KEY)} (${c.percent}%)`; } },
    xAxis: { type: "value" as const, name: tr(UNIT_KEY), nameLocation: "middle" as const, nameGap: 24, ...axisBase, axisLabel: { color: ct.muted, formatter: (v: number) => fmt(v) }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: d.composition.map((c) => c.label), inverse: true, ...axisBase },
    series: [{
      type: "bar" as const,
      barMaxWidth: 28,
      data: d.composition.map((c, i) => ({ value: c.totalKrwM, itemStyle: { color: ct.color[i] } })),
      label: { show: true, position: "right" as const, color: ct.text, formatter: (p: { dataIndex?: number }) => { const c = d.composition[p.dataIndex ?? 0]; return `${fmt(c.totalKrwM)} (${c.percent}%)`; } },
    }],
  };
  return (
    <div className="mb-3" data-testid="invest-charts">
      <h5 className="text-[length:var(--fs-caption)] mb-1">{t("investmentByYearKrwMillions")}</h5>
      <EChart option={yearOption as never} ariaLabel={t("yearlyInvestmentCumulativeBarsReview", { p1: d.years.length, p2: fmt(d.totalKrwM), p3: tr(UNIT_KEY) })} height={300} />
      <h5 className="text-[length:var(--fs-caption)] mb-1">{t("compositionByClassificationReviewPeriod")}</h5>
      <EChart option={compOption as never} ariaLabel={t("investmentCompositionByClassificationP1", { p1: d.composition.map((c) => `${c.label} ${fmt(c.totalKrwM)} ${tr(UNIT_KEY)} ${c.percent}%`).join(", ") })} height={150} />
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="invest-chart-notes">
        {t("revenueAndGovernmentRD")}
        {d.staffingLaborKrwM > 0 && <> {t("theLaborCostIncludesThe")} {fmt(d.staffingLaborKrwM)} {tr(UNIT_KEY)}{t("isIncluded")}</>}
      </p>
      {d.excludedNeedsConfirm > 0 && <p className="text-[length:var(--fs-caption)] mb-1" data-testid="invest-chart-excluded">{tc("needsCheck")} {d.excludedNeedsConfirm}{t("itemSExcludedFromThe")}</p>}
      <details className="mb-1" data-testid="invest-chart-table">
        <summary className="text-[length:var(--fs-caption)] cursor-pointer">{t("viewDataTable")}</summary>
        <div className="table-scroll">
          <table className="data-table invest-summary-table">
            <caption className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] text-left">{t("graphDataUnit")} {tr(UNIT_KEY)})</caption>
            <thead>
              <tr><th scope="col">{tc("tenure")}</th>{cats.map((c) => <th scope="col" className="col-num" key={c.key}><span aria-hidden="true">{CAT_ICON[c.key]}</span> {c.name}</th>)}<th scope="col" className="col-num">{t("cumulativeInvestment2")}</th><th scope="col" className="col-num">{t("revenueExcludingInvestment2")}</th><th scope="col" className="col-num">{t("governmentRDExcludingInvestment2")}</th></tr>
            </thead>
            <tbody>
              {d.years.map((y, i) => (
                <tr key={y}>
                  <th scope="row">{y}</th>
                  {cats.map((c) => <td className="col-num mono-num" key={c.key}>{fmt(c.data[i])}</td>)}
                  <td className="col-num mono-num">{fmt(d.cumulative[i])}</td>
                  <td className="col-num mono-num">{fmt(d.revenue[i])}</td>
                  <td className="col-num mono-num">{fmt(d.govRnd[i])}</td>
                </tr>
              ))}
              <tr><th scope="row">{t("composition")}</th>{d.composition.map((c) => <td className="col-num mono-num" key={c.category}>{fmt(c.totalKrwM)} ({c.percent}%)</td>)}<td colSpan={3} /></tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
