"use client";

// BepAnalysisPanel — S8 재무분석 탭 (2026-10-19 decider ask): 해당 투자에 따른
// BEP Analysis(손익분기)와 연도별 재무 명세(재무제표 요약)를 시나리오별로 표시한다.
// 데이터는 business-case 입력에서 계산한 결정론적 연도 명세(GET /business-case/bep,
// 비저장·읽기 전용)이며 결정 기록은 아니다. ECharts 차트는 가독성 보조 수단이고
// 표가 원천이다 (InvestmentSummaryCharts와 같은 규칙).
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { api } from "../../lib/api.ts";
import { useChartTheme } from "../../lib/echarts-theme.ts";
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
const SCENARIO_LABEL: Record<ScenarioKey, string> = { base: "기본(Base)", downside: "보수(Downside)", upside: "낙관(Upside)" };
const BASIS_LABEL: Record<ScenarioTable["basis"], string> = { ratio: "비율 기준", s5_plan: "S5 투자 계획 기준", s5_pnl: "S5 손익 계획 기준" };
const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

export function BepAnalysisPanel({ projectId }: { projectId: string }) {
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
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "불러오기 실패"); });
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
          { name: "인수가격", type: "bar", data: chartRows.map((r) => (r.year === 0 ? Math.round(r.capex * 100) / 100 : 0)), itemStyle: { color: ct.color[3] } },
          { name: "설비투자 (운영)", type: "bar", data: chartRows.map((r) => (r.year === 0 ? 0 : Math.round(r.capex * 100) / 100)), itemStyle: { color: ct.color[5] ?? ct.color[2] } },
        ]
      : [{ name: "설비투자", type: "bar", data: chartRows.map((r) => Math.round(r.capex * 100) / 100), itemStyle: { color: ct.color[3] } }];
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      legend: {
        data: acquisition
          ? ["매출", "인건비", "운영비", "인수가격", "설비투자 (운영)", "순현금흐름", "누적 할인 현금흐름"]
          : ["매출", "인건비", "운영비", "설비투자", "순현금흐름", "누적 할인 현금흐름"],
        textStyle: { color: ct.muted },
      },
      xAxis: { type: "category", data: yrs, axisLabel: { color: ct.muted } },
      yAxis: [
        { type: "value", name: "백만원/년", axisLabel: { color: ct.muted }, nameTextStyle: { color: ct.muted }, splitLine: { lineStyle: { color: ct.muted, opacity: 0.15 } } },
        { type: "value", name: "누적 (백만원)", axisLabel: { color: ct.muted }, nameTextStyle: { color: ct.muted }, splitLine: { show: false } },
      ],
      series: [
        { name: "매출", type: "bar", data: chartRows.map((r) => Math.round(r.revenue * 100) / 100), itemStyle: { color: ct.color[0] } },
        { name: "인건비", type: "bar", data: chartRows.map((r) => Math.round(r.labor * 100) / 100), itemStyle: { color: ct.color[1] } },
        { name: "운영비", type: "bar", data: chartRows.map((r) => Math.round((r.opex - r.labor) * 100) / 100), itemStyle: { color: ct.color[2] } },
        ...capexSeries,
        { name: "순현금흐름", type: "line", data: chartRows.map((r) => Math.round(r.fcf * 100) / 100), itemStyle: { color: ct.color[4] } },
        { name: "누적 할인 현금흐름", type: "line", yAxisIndex: 1, data: chartRows.map((r) => r.cumulativeDiscountedFcf), itemStyle: { color: ct.color[5] ?? ct.color[0] } },
      ],
    };
  }, [table, ct, showY0]);

  if (error) return <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{error}</p>;
  if (!table) return <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">불러오는 중…</p>;

  return (
    <div className="text-[length:var(--fs-body)]" data-testid="bep-analysis">
      <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label="시나리오 선택">
        {(Object.keys(SCENARIO_LABEL) as ScenarioKey[]).map((k) => (
          <button key={k} type="button" className={k === scenario ? "btn-primary btn-sm" : "btn-ghost btn-sm"} aria-pressed={k === scenario} onClick={() => setScenario(k)}>
            {SCENARIO_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="sizing-grade-card mb-3">
        <h4 className="text-[length:var(--fs-caption)] font-semibold mb-1">
          BEP Analysis — {acquisition ? "인수가격 회수" : "손익분기"} ({SCENARIO_LABEL[scenario]}, {BASIS_LABEL[table.basis]})
        </h4>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
          손익분기 연도 = 누적 할인 현금흐름이 0을 넘는 해 (WACC {(table.wacc * 100).toFixed(1)}% 할인 기준).
        </p>
        <div className="flex flex-wrap gap-2" aria-label="BEP 요약">
          <span className={`status-chip ${table.bepYear != null ? "status-green" : "status-amber"}`}>
            손익분기(회수) 연도: {table.bepYear != null ? `${table.bepYear.toFixed(2)}년차` : "검토 기간 내 미도달"}
          </span>
          {acquisition ? (
            <span className="status-chip status-not-started">
              인수가격(EV): {fmt(table.initialInvestment)}백만원 ({acquisition.evRevenue.toFixed(1)}×)
            </span>
          ) : (
            table.initialInvestment > 0 && (
              <span className="status-chip status-not-started">출시 전 투자: {fmt(table.initialInvestment)}백만원</span>
            )
          )}
          {subject && <span className="status-chip status-not-started">대상: {subject.name}</span>}
          {table.exitValue > 0 && <span className="status-chip status-not-started">처분 가치: {fmt(table.exitValue)}백만원</span>}
          <span className="status-chip status-not-started">NPV: {fmt(table.npv)}백만원</span>
          {table.irrValue != null && <span className="status-chip status-not-started">IRR: {(table.irrValue * 100).toFixed(1)}%</span>}
        </div>
        {brepRevYear ? (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0" data-testid="bep-rev-note">
            {brepRevYear.year}연차 기준 손익분기 매출: {fmt(brepRevYear.breakEvenRevenue ?? 0)}백만원{safeMarginText(safetyMargin)}
            {" "}- 계획 고정 운영비가 있는 해의 매출 손익분기입니다.
          </p>
        ) : (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">
            이 케이스의 운영비는 매출 비례(고정비 미분리)라 고정비 기반 손익분기 매출은 계산되지 않습니다 — 회수 연도를 기준으로 판단하세요.
          </p>
        )}
      </div>

      <div className="table-scroll" role="region" aria-label="연도별 재무 명세" tabIndex={0}>
        <table className="data-table" aria-label="연도별 재무 명세 (백만원)">
          <caption className="sr-only">연도별 재무 명세 (백만원)</caption>
          <thead>
            <tr>
              <th scope="col">구분</th>
              {/* 연차 = S5 투자비 표와 같은 계획 연차 (2026-10-19 decider direction).
                  Y0 shows only PRE-LAUNCH (start_year 0) spend, so it appears only when
                  such a line exists; plan-year capex sits in its own column. */}
              {showY0 && <th scope="col" className="num">Y0</th>}
              {years.map((r) => <th scope="col" key={r.year} className="num">Y{r.year}</th>)}
              <th scope="col" className="num">합계</th>
            </tr>
          </thead>
          <tbody>
            {([
              ["매출", (r: YearRow) => r.revenue],
              // 인건비 only where the case separates it (S5 plan); a ratio case folds labor into 운영비.
              ...(table.rows.some((r) => r.labor > 0) ? [["인건비", (r: YearRow) => r.labor] as [string, (r: YearRow) => number]] : []),
              ["운영비", (r: YearRow) => r.opex - r.labor],
              // 2026-10-19 decider direction: an M&A case pays the acquisition price at
              // year 0 and only then spends operating capex — one mixed `설비투자` row
              // mislabelled the price, so an acquisition case splits them.
              ...(acquisition
                ? ([
                    ["인수가격", (r: YearRow) => (r.year === 0 ? r.capex : 0)],
                    ["설비투자 (운영)", (r: YearRow) => (r.year === 0 ? 0 : r.capex)],
                  ] as Array<[string, (r: YearRow) => number]>)
                : ([["설비투자", (r: YearRow) => r.capex]] as Array<[string, (r: YearRow) => number]>)),
              ["순현금흐름", (r: YearRow) => r.fcf],
              ["누적 할인 현금흐름", (r: YearRow) => r.cumulativeDiscountedFcf],
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
          ? "인수(M&A) 케이스입니다 — year-0 지출은 인수가격(EV)이며, 비용은 비율 가정으로 모델링되고 잔여 지분은 종료 연도 매출 × 진입 배수로 회수합니다."
          : "비용 행은 S5 투자비 표와 같은 연차·같은 구조·같은 기준 금액(연 환산, 성장률 미반영)입니다."}{" "}
        재무상태표(대차대조표)는 감가상각·자산/부채 모델이 없어 제공하지 않습니다 — 이 명세는 현금흐름 기반 요약입니다. 결정 기록은 '결정' 탭에서 합니다.
      </p>

      {option && (
        <div className="mt-3">
          <EChart option={option} height={320} ariaLabel={`시나리오 ${SCENARIO_LABEL[scenario]} 연도별 재무 명세 차트`} />
        </div>
      )}
    </div>
  );
}

function safeMarginText(m: number | null): string {
  return m !== null && Number.isFinite(m) ? ` · 안전마진 ${(m * 100).toFixed(1)}%` : "";
}
