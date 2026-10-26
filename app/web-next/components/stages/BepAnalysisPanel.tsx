"use client";

// BepAnalysisPanel — S8 재무분석 탭 (2026-10-19 decider ask): 해당 투자에 따른
// BEP Analysis(손익분기)와 연도별 재무 명세(재무제표 요약)를 시나리오별로 표시한다.
// 데이터는 business-case 입력에서 계산한 결정론적 연도 명세(GET /business-case/bep,
// 비저장·읽기 전용)이며 결정 기록은 아니다. ECharts 차트는 가독성 보조 수단이고
// 표가 원천이다 (InvestmentSummaryCharts와 같은 규칙).
import { TranslatorFn, resolveLabels } from "../../i18n/config.ts";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { EChartsOption } from "echarts";
import { api } from "../../lib/api.ts";
import { useChartTheme } from "../../lib/echarts-theme.ts";
import { formatNumber } from "../../lib/format.ts";
import { EChart } from "../EChart.tsx";

interface YearRow {
  year: number;
  revenue: number;
  utilization: number;
  /** MERGED operating cost (labor + pure opex) — the fcf row's basis. */
  opex: number;
  /** The labor part of opex (S5 staffing + labor lines); opex − labor = 운영비. */
  labor: number;
  capex: number;
  fcf: number;
  discountedFcf: number;
  cumulativeDiscountedFcf: number;
  breakEvenRevenue: number | null;
}
interface ScenarioTable {
  basis: "ratio" | "s5_plan" | "s5_pnl";
  wacc: number;
  horizon: number;
  initialInvestment: number;
  exitValue: number;
  rows: YearRow[];
  npv: number;
  irrValue: number | null;
  bepYear: number | null;
}
type ScenarioKey = "base" | "downside" | "upside";
interface BepPayload {
  wacc: number;
  /** Brownfield (M&A): the year-0 outflow is the acquisition EV, not a build-out investment. */
  acquisition: { evRevenue: number; source: string } | null;
  /** Brownfield analysis subject (selected company or rank-1 shortlist target). */
  subject: { id: string; name: string } | null;
  scenarios: Record<ScenarioKey, ScenarioTable>;
}
const SCENARIO_LABEL = (tr: TranslatorFn): Record<ScenarioKey, string> => resolveLabels(tr, { base: "stages.s8.bepAnalysis.base", downside: "stages.s8.bepAnalysis.conservativeDownside", upside: "stages.s8.bepAnalysis.optimisticUpside" });
const BASIS_LABEL = (tr: TranslatorFn): Record<ScenarioTable["basis"], string> => resolveLabels(tr, { ratio: "stages.s8.bepAnalysis.ratioBasis", s5_plan: "stages.s8.bepAnalysis.s5InvestmentPlanBasis", s5_pnl: "stages.s8.bepAnalysis.s5PLPlanBasis" });

export function BepAnalysisPanel({ projectId }: { projectId: string }) {const tr = useTranslations(); const t = useTranslations("stages.s8.bepAnalysis"); const tc = useTranslations("common");
  const locale = useLocale();
  const fmt = (n: number) => formatNumber(n, locale, { maximumFractionDigits: 1 });
  const ct = useChartTheme();
  const [data, setData] = useState<Record<ScenarioKey, ScenarioTable> | null>(null);
  const [acquisition, setAcquisition] = useState<{ evRevenue: number; source: string } | null>(null);
  const [subject, setSubject] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioKey>("base");

  useEffect(() => {
    let alive = true;
    api.get<BepPayload>(`/api/projects/${encodeURIComponent(projectId)}/business-case/bep`)
      .then((r) => {
        if (!alive) return;
        setData(r.data?.scenarios ?? null);
        setAcquisition(r.data?.acquisition ?? null);
        setSubject(r.data?.subject ?? null);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : tc("errors.loadFailed")); });
    return () => { alive = false; };
  }, [projectId]);

  const table = data?.[scenario] ?? null;
  const years = table?.rows.filter((r) => r.year > 0) ?? [];
  // Y0 exists only for pre-launch (start_year 0) spend; a plan-year-aligned case has none.
  const showY0 = table != null && table.rows.some((r) => r.year === 0 && (r.capex !== 0 || r.opex !== 0 || r.fcf !== 0));
  const firstPosYear = years.find((r) => r.cumulativeDiscountedFcf >= 0) ?? null;
  const brepRevYear = years.find((r) => r.breakEvenRevenue !== null && r.revenue > 0) ?? null;
  const safetyMargin = brepRevYear && brepRevYear.breakEvenRevenue !== null
    ? (brepRevYear.revenue - brepRevYear.breakEvenRevenue) / brepRevYear.revenue
    : null;

  const option = useMemo<EChartsOption | null>(() => {
    if (!table) return null;
    // Columns follow the table: Y0 only for pre-launch spend, otherwise plan years 1..H.
    const chartRows = showY0 ? table.rows : table.rows.filter((r) => r.year > 0);
    const yrs = chartRows.map((r) => `Y${r.year}`);
    // M&A keeps the price and operating capex as separate bars (2026-10-19 decider direction).
    const capexSeries: Array<{ name: string; type: "bar"; data: number[]; itemStyle: { color: string } }> = acquisition
      ? [
          { name: tc("acquisitionPrice"), type: "bar", data: chartRows.map((r) => (r.year === 0 ? Math.round(r.capex * 100) / 100 : 0)), itemStyle: { color: ct.color[3] } },
          { name: tc("capexOperating"), type: "bar", data: chartRows.map((r) => (r.year === 0 ? 0 : Math.round(r.capex * 100) / 100)), itemStyle: { color: ct.color[5] ?? ct.color[2] } },
        ]
      : [{ name: tc("capex"), type: "bar", data: chartRows.map((r) => Math.round(r.capex * 100) / 100), itemStyle: { color: ct.color[3] } }];
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      legend: {
        data: acquisition
          ? [tc("revenue"), tc("laborCost"), tc("opex"), tc("acquisitionPrice"), tc("capexOperating"), tc("netCashFlow"), tc("cumulativeDiscountedCf")]
          : [tc("revenue"), tc("laborCost"), tc("opex"), tc("capex"), tc("netCashFlow"), tc("cumulativeDiscountedCf")],
        textStyle: { color: ct.muted },
      },
      xAxis: { type: "category", data: yrs, axisLabel: { color: ct.muted } },
      yAxis: [
        { type: "value", name: tc("krwMillionPerYear"), axisLabel: { color: ct.muted }, nameTextStyle: { color: ct.muted }, splitLine: { lineStyle: { color: ct.muted, opacity: 0.15 } } },
        { type: "value", name: t("cumulativeKrwMillions"), axisLabel: { color: ct.muted }, nameTextStyle: { color: ct.muted }, splitLine: { show: false } },
      ],
      series: [
        { name: tc("revenue"), type: "bar", data: chartRows.map((r) => Math.round(r.revenue * 100) / 100), itemStyle: { color: ct.color[0] } },
        { name: tc("laborCost"), type: "bar", data: chartRows.map((r) => Math.round(r.labor * 100) / 100), itemStyle: { color: ct.color[1] } },
        { name: tc("opex"), type: "bar", data: chartRows.map((r) => Math.round((r.opex - r.labor) * 100) / 100), itemStyle: { color: ct.color[2] } },
        ...capexSeries,
        { name: tc("netCashFlow"), type: "line", data: chartRows.map((r) => Math.round(r.fcf * 100) / 100), itemStyle: { color: ct.color[4] } },
        { name: tc("cumulativeDiscountedCf"), type: "line", yAxisIndex: 1, data: chartRows.map((r) => r.cumulativeDiscountedFcf), itemStyle: { color: ct.color[5] ?? ct.color[0] } },
      ],
    };
  }, [table, ct, showY0]);

  if (error) return <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{error}</p>;
  if (!table) return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("loadingEllipsis")}</p>;

  return (
    <div className="text-[length:var(--fs-body)]" data-testid="bep-analysis">
      <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label={t("scenarioSelection")}>
        {(Object.keys(SCENARIO_LABEL) as ScenarioKey[]).map((k) => (
          <button key={k} type="button" className={k === scenario ? "btn-primary btn-sm" : "btn-ghost btn-sm"} aria-pressed={k === scenario} onClick={() => setScenario(k)}>
            {SCENARIO_LABEL(tr)[k]}
          </button>
        ))}
      </div>

      <div className="sizing-grade-card mb-3">
        <h4 className="text-[length:var(--fs-caption)] font-semibold mb-1">
          BEP Analysis — {acquisition ? t("acquisitionPriceRecovery") : t("item")} ({SCENARIO_LABEL(tr)[scenario]}, {BASIS_LABEL(tr)[table.basis]})
        </h4>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
          {t("yearTheFirstYearCumulative")} {(table.wacc * 100).toFixed(1)}{t("discountBasis")}
        </p>
        <div className="flex flex-wrap gap-2" aria-label={t("bepSummary")}>
          <span className={`status-chip ${table.bepYear != null ? "status-green" : "status-amber"}`}>
            {t("paybackYear")} {table.bepYear != null ? t("yearP1", { p1: table.bepYear.toFixed(2) }) : t("notReachedWithinTheReview")}
          </span>
          {acquisition ? (
            <span className="status-chip status-not-started">
              {t("acquisitionPriceEv")} {fmt(table.initialInvestment)}{t("krwMillions")}{acquisition.evRevenue.toFixed(1)}×)
            </span>
          ) : (
            table.initialInvestment > 0 && (
              <span className="status-chip status-not-started">{t("investment")} {fmt(table.initialInvestment)}{tc("krwMillionUnit")}</span>
            )
          )}
          {subject && <span className="status-chip status-not-started">{t("target")} {subject.name}</span>}
          {table.exitValue > 0 && <span className="status-chip status-not-started">{t("exitValue")} {fmt(table.exitValue)}{tc("krwMillionUnit")}</span>}
          <span className="status-chip status-not-started">NPV: {fmt(table.npv)}{tc("krwMillionUnit")}</span>
          {table.irrValue != null && <span className="status-chip status-not-started">IRR: {(table.irrValue * 100).toFixed(1)}%</span>}
        </div>
        {brepRevYear ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0" data-testid="bep-rev-note">
            {brepRevYear.year}{t("revenueByYear")} {fmt(brepRevYear.breakEvenRevenue ?? 0)}{tc("krwMillionUnit")}{safeMarginText(safetyMargin, t)}
            {" "}{t("revenueForYearsWithFixed")}
          </p>
        ) : (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
            {t("thisCaseSOperatingCost")}
          </p>
        )}
      </div>

      <div className="table-scroll" role="region" aria-label={t("financialStatementsByYear")} tabIndex={0}>
        <table className="data-table" aria-label={t("financialStatementsByYearKrw")}>
          <caption className="sr-only">{t("financialStatementsByYearKrw2")}</caption>
          <thead>
            <tr>
              <th scope="col">{tc("division")}</th>
              {/* 연차 = S5 투자비 표와 같은 계획 연차 (2026-10-19 decider direction).
                  Y0 shows only PRE-LAUNCH (start_year 0) spend, so it appears only when
                  such a line exists; plan-year capex sits in its own column. */}
              {showY0 && <th scope="col" className="num">Y0</th>}
              {years.map((r) => <th scope="col" key={r.year} className="num">Y{r.year}</th>)}
              <th scope="col" className="num">{tc("total")}</th>
            </tr>
          </thead>
          <tbody>
            {([
              [tc("revenue"), (r: YearRow) => r.revenue],
              // 인건비 only where the case separates it (S5 plan); a ratio case folds labor into 운영비.
              ...(table.rows.some((r) => r.labor > 0) ? [[tc("laborCost"), (r: YearRow) => r.labor] as [string, (r: YearRow) => number]] : []),
              [tc("opex"), (r: YearRow) => r.opex - r.labor],
              // 2026-10-19 decider direction: an M&A case pays the acquisition price at
              // year 0 and only then spends operating capex — one mixed `설비투자` row
              // mislabelled the price, so an acquisition case splits them.
              ...(acquisition
                ? ([
                    [tc("acquisitionPrice"), (r: YearRow) => (r.year === 0 ? r.capex : 0)],
                    [tc("capexOperating"), (r: YearRow) => (r.year === 0 ? 0 : r.capex)],
                  ] as Array<[string, (r: YearRow) => number]>)
                : ([[tc("capex"), (r: YearRow) => r.capex]] as Array<[string, (r: YearRow) => number]>)),
              [tc("netCashFlow"), (r: YearRow) => r.fcf],
              [tc("cumulativeDiscountedCf"), (r: YearRow) => r.cumulativeDiscountedFcf],
            ] as Array<[string, (r: YearRow) => number]>).map(([label, get]) => (
              <tr key={label}>
                <td className="font-semibold">{label}</td>
                {showY0 && <td className="num mono-num">{fmt(table.rows[0] ? get(table.rows[0]) : 0)}</td>}
                {years.map((r) => <td key={r.year} className="num mono-num">{fmt(get(r))}</td>)}
                <td className="num mono-num font-semibold">{fmt(table.rows.reduce((s, r) => s + get(r), 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
        {acquisition
          ? t("thisIsAnMA")
          : t("costRowsShareTheS5")}{" "}
        {t("theBalanceSheetIsNot")}
      </p>

      {option && (
        <div className="mt-3">
          <EChart option={option} height={320} ariaLabel={t("p1ScenarioYearlyFinancialStatement", { p1: SCENARIO_LABEL(tr)[scenario] })} />
        </div>
      )}
    </div>
  );
}

function safeMarginText(m: number | null, t: TranslatorFn): string {
  return m !== null && Number.isFinite(m) ? t("safetyMarginP1", { p1: (m * 100).toFixed(1) }) : "";
}
