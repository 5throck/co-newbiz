"use client";

// ValuationMethodology — S8 기업가치 계산 방법의 사용자 공개 (사용자 요청,
// 2026-10-10). "기업가치가 어떻게 나오는지 알 수 있어야 한다" — 계산 사슬
// (앵커 → 성장/변동성 → 손익 → 인수가 → 할인/처분 → 몬테카를로 → 교차검증)을
// 현재 파라미터와 최신 케이스의 실측값으로 단계별 설명하고, 두 관점(시장/과거
// 기반) 값 차이의 원인(성장률 가정 + 인수가 레버리지)을 함께 공개한다.
// 모든 금액은 백만 원(KRW-M)으로 저장·계산된다(migration 0134 단위 계약).

import { TranslatorFn } from "../../i18n/config.ts";
import { fmtNpvEok } from "@/lib/npv-format";
import { irrGuardBand, IRR_GUARD_CHIP_LABEL, IRR_GUARD_DIAGNOSTIC } from "@/lib/irr-guard";
import { ANCHOR_SCOPE_CONFIDENCE_NOTE, type AnchorScopeFlag } from "@/lib/anchor-scope";
import { captureSourceLabel, isShareUnsourced } from "@/lib/share-guard";
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { KRW_MILLIONS_UNIT } from "../../lib/format.ts";
import { noteNumber, parseSimNote } from "../../lib/sim-note.ts";
import { s5ParamLinkage, type S5ParamKey } from "../../lib/s5-linkage-labels.ts";
import { useTranslations } from "next-intl";

interface MethodCase {
  id: string;
  variant: "market_forward" | "historical";
  created_at: string;
  lines: Array<{ category: string; name: string; annual_amount_krw_m: number }>;
  simulations: Array<{ percentile: string; npv_krw_m: number; irr: number | null; note: string | null }>;
}

interface ResolvedParams {
  captureRate: number; captureSource: string;
  opexRatio: number; opexSource: string;
  capexRatio: number; capexSource: string;
  initialInvestmentRatio: number; initialInvestmentSource: string;
  investmentBasis: "ratio" | "s5_plan" | "s5_plan_full" | "s5_pnl";
  s5PlanHorizonYears: number | null;
  acquisitionEvRevenue: number | null; acquisitionEvRevenueSource: string;
  rampUp: number[]; rampSource: string;
  horizonYears: number; horizonSource: string;
  iterations: number; iterationsSource: string;
  fadeHorizonYears: number; fadeHorizonSource: string;
  growthTerminal: number | null; growthTerminalSource: string;
  irrFlagThreshold?: number; irrFlagThresholdSource?: string;
  irrCautionThreshold?: number; irrCautionThresholdSource?: string;
}

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const eok = (krwM: number, t: TranslatorFn) => t("p1HundredMillionKrw", { p1: (krwM / 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) });

export function ValuationMethodology({
  projectId,
  marketCase,
  historicalCase,
  greenfield = false,
}: {
  projectId: string;
  marketCase: MethodCase | null;
  historicalCase: MethodCase | null;
  /** Green Field has no target company, so no past-based perspective exists. */
  greenfield?: boolean;
}) {const t = useTranslations("stages.s8.valuationMethodology"); const tc = useTranslations("common");
  const [params, setParams] = useState<ResolvedParams | null>(null);
  const [s5Run, setS5Run] = useState<{ drawCount: number } | null>(null);
  const [anchorScope, setAnchorScope] = useState<AnchorScopeFlag | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ params: ResolvedParams; s5_connect?: { run: { drawCount: number } | null } | null; anchor_scope?: AnchorScopeFlag | null }>(`/api/projects/${encodeURIComponent(projectId)}/business-case/params`)
      .then((r) => { setParams(r.data.params); setS5Run(r.data.s5_connect?.run ?? null); setAnchorScope(r.data.anchor_scope ?? null); })
      .catch(() => setError(t("failedToLoadParameters")));
  }, [projectId]);

  if (error) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">{error}</p>;

  const mf = marketCase?.simulations.find((s) => s.percentile === "p50");
  const n = parseSimNote(mf?.note);
  const hist = historicalCase?.simulations.find((s) => s.percentile === "p50");
  const hn = parseSimNote(hist?.note);
  const revLine = marketCase?.lines.find((l) => l.category === "revenue");
  const acqEv = noteNumber(n.acq_ev);
  const exitEv = noteNumber(n.exit_ev);
  const isAcquisition = acqEv !== null && revLine != null;
  const wacc = noteNumber(n.wacc);
  const sigma = noteNumber(n.sigma);
  const xTerminal = noteNumber(n.xcheck_terminal_growth);
  const xNpv = noteNumber(n.xcheck_fade_npv);
  const iterations = noteNumber(n.iterations) ?? params?.iterations ?? null;
  const horizon = params?.horizonYears ?? (noteNumber(n.horizon) || 5);
  // ADR-0174 — 투자비 기준이 S5 투자 계획이면 year-0 투자와 연도별 capex가 S5
  // 스케줄로 대체됩니다 (OD-3: 계획 Y1 집행액은 year-0 유출로 계상).
  const s5Basis = params?.investmentBasis != null && params.investmentBasis !== "ratio";
  const pnlBasis = params?.investmentBasis === "s5_pnl";
  // ADR-0178 slice 2 - s5_pnl honesty labels: pre-tax proxy + terminal-margin flag (flag only).
  const preTaxNote = pnlBasis ? t("cashApproximationTaxesNotReflected") : "";
  const termFlag = pnlBasis ? t("exitMultipleAndPlannedMargin") : "";
  const preLaunchKrwM = noteNumber(n.prelaunch_krw_m);
  const horizonMismatch = params?.s5PlanHorizonYears != null && params.s5PlanHorizonYears !== horizon;

  // 두 관점 차이의 원인 수치 — 같은 앵커·인수가·마진에서 성장률만 다르다.
  const gMf = noteNumber(n.growth);
  const gHist = noteNumber(hn.growth);
  const terminalMultipleMf = gMf != null && horizon > 1 ? Math.pow(1 + gMf, horizon - 1) : null;
  const terminalMultipleHist = gHist != null && horizon > 1 ? Math.pow(1 + gHist, horizon - 1) : null;

  // Green Field only: is this value an S5 amount or an assumption? Same wording as the `S5 연결` block;
  // display only, describes only rules in force today.
  const s5Tag = (key: S5ParamKey) => {
    if (!greenfield || !params) return null;
    const cell = s5ParamLinkage(key, { basis: params.investmentBasis, run: s5Run, s8Iterations: params.iterations });
    return (
      <div data-testid={`s8-method-s5-${key}`} className="text-[length:var(--fs-caption)]">
        <span className={`status-chip whitespace-nowrap ${cell.kind === "s5" ? "status-green" : "status-amber"}`}>{cell.kind === "s5" ? t("s5Value") : t("assumptionValue")}</span> {cell.detail}
      </div>
    );
  };

  return (
    <section className="market-section sizing-step mb-3" aria-label={t("enterpriseValueCalculationMethod")}>
      <h3 className="sizing-step-title">{t("enterpriseValueCalculationMethod2")} <span className="status-chip status-info">{t("showCalculationChain")}</span></h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        {t("theNpvAndIrrOn")} <b>{t("krwMillions")}</b> {t("unitAndEachRowS")}
      </p>
      {!marketCase ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("noCasesGeneratedYetAfter")}</p>
      ) : (
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}><table className="data-table">
          <caption className="sr-only">{t("enterpriseValueCalculationChainSteps")}</caption>
          <thead><tr><th scope="col">{tc("stage")}</th><th scope="col">{t("content")}</th><th scope="col">{t("currentValue")}</th></tr></thead>
          <tbody>
            <tr>
              <td>{t("revenueAnchor")}</td>
              <td>
                {isAcquisition ? t("theTargetCompanySLatest") : t("revenueComputedAsMarketSize")}
                {anchorScope && anchorScope.status !== "ok" && (
                  <div className="mt-1">
                    <span className="status-chip status-amber" data-testid="methodology-anchor-scope-flag" title={`${anchorScope.reason} — ${ANCHOR_SCOPE_CONFIDENCE_NOTE}`}>
                      {anchorScope.label}
                    </span>{" "}
                    <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{anchorScope.reason}</span>
                  </div>
                )}
                {params && isShareUnsourced(params.captureSource) && (
                  <div className="mt-1">
                    <span className="status-chip status-amber" data-testid="methodology-share-unsourced-flag" title={t("p1NotAMarketShare", { p1: captureSourceLabel(params.captureSource, params.captureRate) })}>
                      {captureSourceLabel(params.captureSource, params.captureRate)}
                    </span>
                  </div>
                )}
              </td>
              <td className="num mono-num">{revLine ? eok(revLine.annual_amount_krw_m, t) : "—"}{isAcquisition ? ` (${n.revenue_anchor ?? ""})` : ""}</td>
            </tr>
            <tr>
              <td>{t("growthAssumption")}</td>
              <td>{greenfield ? t("marketGrowthMarketSizeShare") : t("marketBasisMarketGrowthRate")}</td>
              <td className="num mono-num">
                {gMf != null ? t("marketP1", { p1: pct1(gMf) }) : "—"}{greenfield ? "" : ` · ${gHist != null ? t("pastP1", { p1: pct1(gHist) }) : "—"}`}
              </td>
            </tr>
            <tr>
              <td>{t("volatilitySigma")}</td>
              <td>{t("stdDeviationOfYearlyRevenue")}</td>
              <td className="num mono-num">{sigma != null ? pct1(sigma) : "—"} ({n.sigma_source ?? ""}){s5Tag("sigma")}</td>
            </tr>
            <tr>
              <td>{t("pLStructure")}</td>
              <td>
                {pnlBasis
                  ? t("fcfRevenueUtilizationS5Planned")
                  : s5Basis
                    ? t("fcfRevenueOperatingCostUtilization")
                    : t("fcfRevenue1OpexRatio")}
              </td>
              <td className="num mono-num">
                {pnlBasis
                  ? t("s5PlannedPnlAppliedUtilizationOnRevenueOnlyP1P2P3", { p1: n.pnl_fallback ? t("ratioFallbackP1Yr", { p1: n.pnl_fallback }) : "", p2: preLaunchKrwM != null ? t("investmentP1", { p1: eok(preLaunchKrwM, t) }) : "", p3: preLaunchKrwM === 0 ? t("preLaunchInvestmentNotSpecifiedParens") : "" })
                  : s5Basis
                  ? t("s5InvestmentPlanScheduleApplied", { p1: params?.investmentBasis === "s5_plan_full" ? t("plannedValuesUsedForLabor") : params?.investmentBasis === "s5_plan" ? t("laborOperatingCostAsRatios") : "" }) + (params ? t("utilizationP1", { p1: params.rampUp.map((v) => v.toFixed(1)).join("→") }) : "")
                  : <>
                    {tc("opex")} {params ? pct1(params.opexRatio) : "—"} {t("capex")} {params ? pct1(params.capexRatio) : "—"} {t("utilization")} {params ? params.rampUp.map((v) => v.toFixed(1)).join("→") : "—"}
                  </>}
                {s5Tag("opex")}
                {s5Tag("capex")}
                {s5Tag("ramp")}
                {(preTaxNote || termFlag) && (
                  <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{preTaxNote}{termFlag}</div>
                )}
              </td>
            </tr>
            <tr>
              <td>{t("investment")}</td>
              <td>
                {isAcquisition
                  ? t("acquisitionEvRevenueAnchorEv")
                  : pnlBasis
                    ? t("initialInvestment0InvestmentSum")
                    : s5Basis
                      ? t("initialInvestmentS5PlanY1")
                      : t("initialInvestmentRevenueRatio")}
              </td>
              <td className="num mono-num">
                {isAcquisition
                  ? t("p1XP2", { p1: acqEv!.toFixed(2), p2: fmtNpvEok(revLine!.annual_amount_krw_m * acqEv!) })
                  : pnlBasis
                    ? (preLaunchKrwM != null ? t("p1P2", { p1: eok(preLaunchKrwM, t), p2: preLaunchKrwM === 0 ? t("investmentNotSpecified") : "" }) : t("investmentTotal"))
                    : s5Basis
                      ? t("s5PlanDeployment")
                      : params ? t("p1OfRevenue", { p1: (params.initialInvestmentRatio * 100).toFixed(0) }) : "—"}
                {s5Tag("initial")}
              </td>
            </tr>
            <tr>
              <td>{t("discountingAndExit")}</td>
              <td>{horizon}{t("yrOfFcfDiscountedAt")}{isAcquisition ? t("exitInTheFinalYear") : ""}</td>
              <td className="num mono-num">WACC {wacc != null ? pct1(wacc) : "—"} ({n.wacc_source ?? ""}){exitEv != null ? t("exitP1X", { p1: exitEv.toFixed(2) }) : ""}</td>
            </tr>
            <tr>
              <td>{t("distributionOutput")}</td>
              <td>{t("monteCarloReproducibleWithThe")}</td>
              <td className="num mono-num">{iterations != null ? iterations.toLocaleString() + tc("timesUnit") : "—"} {t("bottomMedianTopAndIrr")}</td>
            </tr>
            <tr>
              <td>{t("structure")}</td>
              <td>{t("revaluesTheSameCaseWith")}</td>
              <td className="num mono-num">
                {n.xcheck === "fade-dcf"
                  ? t("p1YrP2NpvP3", { p1: n.xcheck_horizon, p2: xTerminal != null ? pct1(xTerminal) : "—", p3: xNpv != null ? fmtNpvEok(xNpv) : "—" })
                  : t("acquisitionPriceCaseOnly")}
              </td>
            </tr>
          </tbody>
        </table></div>
      )}

      {(() => {
        const band = irrGuardBand(mf?.irr, params?.irrFlagThreshold, params?.irrCautionThreshold);
        if (!band) return null;
        return (
          <div role="status" data-testid="methodology-irr-guard" className="mt-2 p-3 border border-[color:var(--border)] rounded-[length:var(--radius)]">
            <span className="status-chip status-amber">
              IRR {(mf!.irr! * 100).toFixed(1)}% — {IRR_GUARD_CHIP_LABEL[band]} {t("base")} {((band === "extreme" ? params?.irrFlagThreshold ?? 1.0 : params?.irrCautionThreshold ?? 0.5) * 100).toFixed(0)}%)
            </span>{" "}
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{IRR_GUARD_DIAGNOSTIC}</span>
          </div>
        );
      })()}

      {horizonMismatch && (
        <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-2">
          {t("s5ReviewPeriod")}{params?.s5PlanHorizonYears}{t("yrAndTheHorizon")}{horizon}{t("yrDiffer")}
        </p>
      )}

      {!greenfield && marketCase && historicalCase && mf && hist && gMf != null && gHist != null && (
        <div className="mt-2 p-3 border border-[color:var(--border)] rounded-[length:var(--radius)]" aria-label={t("whyTheTwoPerspectivesDiffer")}>
          <p className="text-[length:var(--fs-body)] font-semibold mb-1">{t("whyDoTheTwoPerspectives")}</p>
          <p className="text-[length:var(--fs-caption)] mb-2">
            {t("theTwoPerspectives")} <b>{t("sameRevenueAnchorSameAcquisition")}</b>{t("andUse")} <b>{t("onlyTheGrowthRateDiffers")}</b>
            {t("market")} {pct1(gMf)} {t("vsPast")} {pct1(gHist)}). {horizon}{t("yrOfCompoundingTheRevenue")}{" "}
            {terminalMultipleMf ? terminalMultipleMf.toFixed(2) : "—"}{t("xVs")} {terminalMultipleHist ? terminalMultipleHist.toFixed(2) : "—"}{t("xApartEnterpriseValueIs")}
            <b> {t("howManyTimesTheGrowth")}</b>{t("currentMedian")} {fmtNpvEok(mf.npv_krw_m)} vs {fmtNpvEok(hist.npv_krw_m)}{t("aLargeDifferenceMeansPrecisely")} <b>{t("highUncertaintyInTheGrowth")}</b>{t("isTheSignalWhetherThe")}
          </p>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("marketBasisGrowthSourceComparison", { p1: pct1(gMf), p2: n.growth_source, p3: pct1(gHist), p4: hn.growth_source })}
          </p>
        </div>
      )}

      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">
        {t("unitContractDartActualsAre")}{KRW_MILLIONS_UNIT}{t("unitChainConsistencyIsChecked")}
      </p>
    </section>
  );
}
