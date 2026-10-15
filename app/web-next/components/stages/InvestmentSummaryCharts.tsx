"use client";

import { useChartTheme } from "../../lib/echarts-theme.ts";
import { buildInvestmentChartData, type InvestmentSummary } from "../../lib/capability-cost-lines.ts";
import { EChart } from "../EChart.tsx";

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const UNIT = "백만원";
const CAT_ICON = { labor: "●", opex: "▲", capex: "■" } as const;

// 투자비 요약 charts (read-only, decision support). The summary tables below stay the source of truth.
// Colours come from the --chart-N tokens; decals (patterns), direct data labels and a data table keep
// colour from being the only carrier. Mounted only while the 투자비 tab is active (0-width safe).
export function InvestmentSummaryCharts({ summary }: { summary: InvestmentSummary }) {
  const ct = useChartTheme();
  const d = buildInvestmentChartData(summary);
  if (!d.hasData) {
    return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="invest-chart-empty">그래프로 표시할 투자비 항목이 없습니다</p>;
  }
  const cats = [
    { key: "labor", name: "인건비", data: d.stacks.labor, color: ct.color[0] },
    { key: "opex", name: "운영비", data: d.stacks.opex, color: ct.color[1] },
    { key: "capex", name: "설비투자", data: d.stacks.capex, color: ct.color[2] },
  ] as const;
  const axisBase = { axisLabel: { color: ct.muted }, nameTextStyle: { color: ct.muted } };
  const yearOption = {
    aria: { enabled: true, decal: { show: true } },
    grid: { left: 64, right: 16, top: 40, bottom: 28 },
    legend: { top: 0, textStyle: { color: ct.muted } },
    tooltip: { trigger: "axis" as const, valueFormatter: (v: unknown) => `${fmt(Number(v))} ${UNIT}` },
    xAxis: { type: "category" as const, data: d.years, ...axisBase },
    yAxis: { type: "value" as const, name: UNIT, ...axisBase, splitLine: { lineStyle: { color: ct.split } } },
    series: [
      ...cats.map((c) => ({ name: c.name, type: "bar" as const, stack: "invest", data: [...c.data], itemStyle: { color: c.color }, barMaxWidth: 40 })),
      { name: "누적 투자비", type: "line" as const, data: d.cumulative, symbol: "circle", symbolSize: 7, itemStyle: { color: ct.text }, lineStyle: { color: ct.text, width: 2 }, label: { show: true, color: ct.text, position: "top" as const, formatter: (p: { value?: unknown }) => fmt(Number(p.value)) } },
      { name: "매출 (투자비 제외)", type: "line" as const, data: d.revenue, symbol: "diamond", symbolSize: 8, itemStyle: { color: ct.color[3] }, lineStyle: { color: ct.color[3], type: "dashed" as const, width: 2 } },
      { name: "정부 R&D (투자비 제외)", type: "line" as const, data: d.govRnd, symbol: "triangle", symbolSize: 8, itemStyle: { color: ct.color[4] }, lineStyle: { color: ct.color[4], type: "dotted" as const, width: 2 } },
    ],
  };
  const compOption = {
    aria: { enabled: true, decal: { show: true } },
    grid: { left: 72, right: 150, top: 8, bottom: 28 },
    tooltip: { trigger: "item" as const, formatter: (p: { name?: string; dataIndex?: number }) => { const c = d.composition[p.dataIndex ?? 0]; return `${p.name}: ${fmt(c.totalKrwM)} ${UNIT} (${c.percent}%)`; } },
    xAxis: { type: "value" as const, name: UNIT, ...axisBase, splitLine: { lineStyle: { color: ct.split } } },
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
      <h5 className="text-[length:var(--fs-caption)] mb-1">연도별 투자비 (백만원, 인건비·운영비·설비투자 누적 막대)</h5>
      <EChart option={yearOption as never} ariaLabel={`연도별 투자비 누적 막대 그래프, 검토 기간 ${d.years.length}년, 총 ${fmt(d.totalKrwM)} ${UNIT}`} height={300} />
      <h5 className="text-[length:var(--fs-caption)] mb-1">분류별 구성 (검토 기간 합계, 백만원 및 %)</h5>
      <EChart option={compOption as never} ariaLabel={`분류별 투자비 구성: ${d.composition.map((c) => `${c.label} ${fmt(c.totalKrwM)} ${UNIT} ${c.percent}%`).join(", ")}`} height={150} />
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1" data-testid="invest-chart-notes">
        매출과 정부 R&D는 투자비 제외 선(점선/점점선)이며 누적 막대에 포함되지 않습니다.
        {d.staffingLaborKrwM > 0 && <> 인건비에는 인력 운영 계획 연동분 {fmt(d.staffingLaborKrwM)} {UNIT}이 포함됩니다.</>}
      </p>
      {d.excludedNeedsConfirm > 0 && <p className="text-[length:var(--fs-caption)] mb-1" data-testid="invest-chart-excluded">확인 필요 {d.excludedNeedsConfirm}건은 그래프에서 제외됨</p>}
      <details className="mb-1" data-testid="invest-chart-table">
        <summary className="text-[length:var(--fs-caption)] cursor-pointer">데이터 표 보기</summary>
        <div className="overflow-x-auto">
          <table className="sizing-table">
            <caption className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] text-left">그래프 데이터 (단위: {UNIT})</caption>
            <thead>
              <tr><th scope="col">연차</th>{cats.map((c) => <th scope="col" key={c.key}><span aria-hidden="true">{CAT_ICON[c.key]}</span> {c.name}</th>)}<th scope="col">누적 투자비</th><th scope="col">매출 (투자비 제외)</th><th scope="col">정부 R&D (투자비 제외)</th></tr>
            </thead>
            <tbody>
              {d.years.map((y, i) => (
                <tr key={y}>
                  <th scope="row">{y}</th>
                  {cats.map((c) => <td className="mono-num" key={c.key}>{fmt(c.data[i])}</td>)}
                  <td className="mono-num">{fmt(d.cumulative[i])}</td>
                  <td className="mono-num">{fmt(d.revenue[i])}</td>
                  <td className="mono-num">{fmt(d.govRnd[i])}</td>
                </tr>
              ))}
              <tr><th scope="row">구성비</th>{d.composition.map((c) => <td className="mono-num" key={c.category}>{fmt(c.totalKrwM)} ({c.percent}%)</td>)}<td colSpan={3} /></tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
