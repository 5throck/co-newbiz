"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { formatPctOrNa } from "../../../lib/synthetic-value.ts";
import { api } from "../../../lib/api.ts";
import { StepSection } from "./MarketReport.tsx";
import { CagrGroupedBar, ProjectionChart, ScenarioBandChart } from "./SizingCharts.tsx";
import {
  RegionScenarioChart,
  RegionScenarioTable,
  YearlyShareAreaChart,
  YearlySizeStackedBar,
  YearlyShareTable,
  ConsistencyChart,
} from "./SizingScenarioCharts.tsx";
import { CalibrationPanel } from "./CalibrationPanel.tsx";
import type { SizingReportState } from "./useSizingReport.ts";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// C1 (design 2026-09-18-s1-growth-gap-calibration, amendment 2026-11-12) — 기록된
// 외부 참조가 표시 중인 최신 분석 버전보다 나중에 기록됐는지(컨센서스 stale 여부).
// 순수 타임스탬프 비교이며, 한쪽이라도 없거나 파싱 불가면 stale 아님으로 판정한다.
export function referenceNewerThanVersion(
  referenceCreatedAt: string | null | undefined,
  versionCreatedAt: string | null | undefined,
): boolean {
  if (!referenceCreatedAt || !versionCreatedAt) return false;
  const ref = Date.parse(referenceCreatedAt);
  const ver = Date.parse(versionCreatedAt);
  if (Number.isNaN(ref) || Number.isNaN(ver)) return false;
  return ref > ver;
}

// C2 (amendment 2026-11-12) — 어디서 재분석 CTA가 보이는지 결정한다. "gap"은 기존
// 격차 게이트(externalForecast && |gap| >= 20) 블록, "staleness"는 참조 최신 스테일
// 배너 카드, "none"은 CTA 없음. 격차 게이트가 이미 CTA를 보여 주면 그쪽이 이긴다
// (중복 버튼 방지 — 기존 격차 CTA 동작 불변).
export function rerunCtaMode(gapPct: number | undefined, referenceNewer: boolean): "gap" | "staleness" | "none" {
  const gapVisible = gapPct !== undefined && Math.abs(gapPct) >= 20;
  if (gapVisible) return "gap";
  return referenceNewer ? "staleness" : "none";
}

export function SizingGrowthTab({ ctx }: { ctx: SizingReportState }) {
  const t = useTranslations("stages.s1.sizingGrowthTabs");
  const tc = useTranslations("common");
  const { tab, matrix, rerunStarted, canCurate, analysisId, setRerunError, setRerunStarted, rerunError, detail } = ctx;
  // C1 — CalibrationPanel과 같은 외부 참조 엔드포인트를 이 탭에서도 live GET한다.
  // 버전 페이로드가 참조 기록 이전에 만들어졌어도 staleness가 보이도록 하는 것이
  // 목적이며, 라우트가 행을 그대로(SELECT *) 돌려주므로 created_at이 실려 온다.
  interface RefRow {
    source_label: string;
    source_url: string | null;
    target_year: number;
    external_cagr_pct: number;
    external_size_b: number | null;
    captured_from: string;
    created_at: string;
  }
  const [reference, setReference] = useState<RefRow | null>(null);
  useEffect(() => {
    api
      .get<{ reference: RefRow | null }>(
        `/api/market-overview/industry/${encodeURIComponent(detail.industry.id)}/external-reference`,
      )
      .then((r) => setReference(r.data.reference))
      .catch(() => {});
  }, [detail.industry.id]);
  const referenceNewer = referenceNewerThanVersion(reference?.created_at, detail.versions[0]?.created_at);
  // C2 — 재분석 CTA를 격차 게이트(externalForecast && |gap| >= 20)와 분리한다.
  // 참조가 표시 버전보다 최신이면 격차와 무관하게 재분석이 유효하다.
  const ctaMode = rerunCtaMode(matrix.externalForecast?.gapPct, referenceNewer);
  const rerunCta = rerunStarted ? (
    <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--green-fg)] mt-1 mb-0">
      {t("startedTheListAnalysisDate")}
    </p>
  ) : canCurate ? (
    <button
      type="button"
      className="btn-ghost btn-sm mt-1"
      onClick={async () => {
        if (!analysisId) {
          setRerunError(t("analysisIdNotFoundFrom"));
          return;
        }
        try {
          await api.post(`/api/market-overview/analyses/${encodeURIComponent(analysisId)}/rerun`);
          setRerunStarted(true);
        } catch (e) {
          setRerunError(e instanceof Error ? e.message : tc("reanalyzeStartFailed"));
        }
      }}
    >
      {t("nowReflectingTheLatestExternal")}
    </button>
  ) : null;
  return (
    <>
      {tab === "growth" && (
        <>
          <StepSection n={4} id="step-4" title={t("cagrAndScenarioBandPer")}>
            <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
              {t("eachRegionSegmentCellGets")} <strong>{t("onlyCellsWithDocumentedMismatch")}</strong>{" "}
              {t("replacedWithAWiderBand")}
            </p>
            <div className="chart-pair">
              <div className="chart-half">
                <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                  {t("baseScenarioCagrGroupedBars")}
                </h4>
                <CagrGroupedBar matrix={matrix} />
              </div>
              <div className="chart-half">
                <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                  {t("n20262030OutlookRegionTotal")}
                </h4>
                <ProjectionChart matrix={matrix} />
              </div>
            </div>
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-4 mb-1">
              {t("scenarioBandPessimisticToOptimistic")}
            </h4>
            <ScenarioBandChart matrix={matrix} />
            <div className="chart-pair">
              <div className="chart-half">
                <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                  {t("n2030OutlookByScenarioRegion")}
                </h4>
                <RegionScenarioChart matrix={matrix} />
              </div>
              <div className="chart-half">
                <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                  {t("n2030OutlookByScenarioRegion2")}
                </h4>
                <RegionScenarioTable matrix={matrix} />
              </div>
            </div>
            <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("scenariosApplyEachRegionSegment")}
            </p>
          </StepSection>

          {/* 4-A: 방법론 8단계 번호는 유지하고 별도 영역으로 표시 */}
          <section
            id="yearly-share"
            aria-label={t("marketShareTrendByYear")}
            className="market-section sizing-step sizing-step-deep"
          >
            <h3 className="sizing-step-title text-[length:var(--fs-body)]">
              <span className="sizing-step-badge sizing-step-badge-deep">4-A</span> {t("marketShareTrendByYear2")}
            </h3>
            <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
              {t("compoundsEachRegionSegmentCell")}
            </p>
            <div className="chart-pair">
              <div className="chart-half">
                <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                  {t("shareTrendByRegionStacked")}
                </h4>
                <YearlyShareAreaChart matrix={matrix} />
              </div>
              <div className="chart-half">
                <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                  {t("marketSizeTrendByRegion")}
                </h4>
                <YearlySizeStackedBar matrix={matrix} />
              </div>
            </div>
            <YearlyShareTable matrix={matrix} />
          </section>

          <StepSection n={5} id="step-5" title={t("growthRateConsistencyCheckVs")}>
            <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
              {t("comparesTheImpliedGlobalCagr")}
              <strong> {t("internalConsistencyCheck")}</strong>
              {t("onlyBothAreExtrapolatedFrom")}
            </p>
            <ConsistencyChart matrix={matrix} />
            <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {matrix.consistency.tolerance}
            </p>
            {referenceNewer && (
              <div className="sizing-grade-card mt-4" role="status">
                <p className="m-0 text-[length:var(--fs-caption)]">
                  {t("recordedExternalReferenceNewerThanTheLatestAnalysis")}
                </p>
                {ctaMode === "staleness" && rerunCta}
                {ctaMode === "staleness" && rerunError && (
                  <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0">
                    {rerunError}
                  </p>
                )}
              </div>
            )}
            {matrix.externalForecast ? (
              <div className="chart-half sizing-grade-card mt-4">
                <h4 className="text-[length:var(--fs-body)] mb-2">
                  {t("gapAnalysisVsExternalFuture")}
                  {matrix.externalForecast.targetYear}
                  {t("yrExtrapolatedPastGrowthVs")}

                  {(() => {
                    const gap = matrix.externalForecast.gapPct;
                    if (gap === undefined || Math.abs(gap) < 20) return null;
                    return (
                      <div className="sizing-grade-card mt-2" role="note">
                        <p className="m-0 text-[length:var(--fs-caption)]">
                          <span className="status-chip status-red mr-1">{t("reviewNeeded")}</span>
                          {t("theGapBetweenOurEstimate")} <strong>{Math.abs(gap).toFixed(1)}%</strong>
                          {t("deviatesByMoreThanThe")}
                        </p>
                        {rerunCta}
                        {rerunError && (
                          <p
                            role="alert"
                            className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0"
                          >
                            {rerunError}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </h4>
                <table className="data-table" aria-label={t("gapVsExternalOutlook")}>
                  <caption className="sr-only">{t("gapVsExternalOutlook2")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{tc("division")}</th>
                      <th scope="col">
                        {matrix.externalForecast.targetYear}
                        {t("yrMarketSize")}
                      </th>
                      <th scope="col">{tc("notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="font-semibold">{t("ourEstimateGrowthExtrapolation")}</td>
                      <td className="tabular-nums">${(matrix.externalForecast.ourMarketSize ?? 0).toFixed(2)}B</td>
                      <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                        {t("cagr")} {formatPctOrNa(matrix.consistency.bottomUpCagr)} {tc("apply")}
                      </td>
                    </tr>
                    <tr>
                      <td className="font-semibold">{t("externalOutlook")}</td>
                      <td className="tabular-nums">${matrix.externalForecast.marketSize.toFixed(2)}B</td>
                      <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                        {matrix.externalForecast.sourceLabel}
                        {matrix.externalForecast.cagr
                          ? ` · CAGR ${(matrix.externalForecast.cagr * 100).toFixed(1)}%`
                          : ""}
                      </td>
                    </tr>
                    <tr className="row-selected">
                      <td className="font-semibold">{tc("gap")}</td>
                      <td className="tabular-nums font-semibold">
                        {matrix.externalForecast.gapPct !== undefined
                          ? `${matrix.externalForecast.gapPct > 0 ? "+" : ""}${matrix.externalForecast.gapPct}%`
                          : "—"}
                      </td>
                      <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                        {t("theExternalOutlookIs")}{" "}
                        {matrix.externalForecast.gapPct !== undefined && matrix.externalForecast.gapPct > 0
                          ? t("highNewOrStrengthenedDrivers")
                          : matrix.externalForecast.gapPct !== undefined && matrix.externalForecast.gapPct < 0
                            ? t("lowExistingDriversLikelyTo")
                            : t("same")}{" "}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 mb-0 text-[length:var(--fs-body)] whitespace-pre-line">
                  {matrix.externalForecast.gapAnalysis}
                </p>
                {matrix.externalForecast.newDrivers && matrix.externalForecast.newDrivers.length > 0 && (
                  <p className="mt-2 mb-0 text-[length:var(--fs-caption)]">
                    <strong>{t("newOrStrengthenedDriversVs")}</strong>{" "}
                    {matrix.externalForecast.newDrivers.map((d) => (
                      <span key={d} className="status-chip status-in-progress mr-1">
                        {d}
                      </span>
                    ))}
                  </p>
                )}
                <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {matrix.externalForecast.note}
                </p>
              </div>
            ) : (
              <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("noExternalFutureOutlookObtained")}
              </p>
            )}
            <CalibrationPanel industryId={detail.industry.id} matrix={matrix} />
          </StepSection>
        </>
      )}
    </>
  );
}

export function SizingQualitativeTab({ ctx }: { ctx: SizingReportState }) {
  const t = useTranslations("stages.s1.sizingGrowthTabs");
  const { tab, matrix } = ctx;
  return (
    <>
      {tab === "qualitative" && (
        <section
          aria-label={t("qualitativeAnalysisOpportunityAndRisk")}
          className="market-section sizing-step sizing-step-deep"
        >
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge sizing-step-badge-deep">5-A</span>{" "}
            {t("qualitativeAnalysisOpportunityAndRisk2")}
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            {t("aQuantitativeMatrixAloneCannot")}
          </p>
          <div className="chart-pair">
            <div className="chart-half sizing-grade-card">
              <h4 className="text-[length:var(--fs-body)] mb-2">{t("opportunityFactor")}</h4>
              <ul className="sizing-note-list">
                {matrix.qualitative.opportunityFactors.map((f, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: factor strings have no id and the list is static per report render
                  <li key={`${f}-${i}`}>{f}</li>
                ))}
              </ul>
            </div>
            <div className="chart-half sizing-grade-card">
              <h4 className="text-[length:var(--fs-body)] mb-2">{t("riskFactor")}</h4>
              <ul className="sizing-note-list">
                {matrix.qualitative.riskFactors.map((f, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: factor strings have no id and the list is static per report render
                  <li key={`${f}-${i}`}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
          {matrix.externalForecast?.newDrivers && matrix.externalForecast.newDrivers.length > 0 && (
            <div className="sizing-grade-card mt-3">
              <h4 className="text-[length:var(--fs-body)] mb-2">{t("newOrStrengthenedDriversVs2")}</h4>
              <div className="flex flex-wrap gap-1 mb-2">
                {matrix.externalForecast.newDrivers.map((d) => (
                  <span key={d} className="status-chip status-in-progress">
                    {d}
                  </span>
                ))}
              </div>
              {matrix.externalForecast.gapAnalysis && (
                <p className="mb-0 text-[length:var(--fs-body)] whitespace-pre-line">
                  {matrix.externalForecast.gapAnalysis}
                </p>
              )}
            </div>
          )}
          {matrix.qualitative.sources && matrix.qualitative.sources.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[length:var(--fs-body)] text-[color:var(--accent)]">
                {t("acquisitionSource")}
                {matrix.qualitative.sources.length}
                {t("itemSSourcesMustBe")}
              </summary>
              <ul className="sizing-note-list mt-2">
                {matrix.qualitative.sources.map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: source urls may repeat across excerpts and the list is static per report render
                  <li key={`${s.url}-${i}`}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">
                      {s.title}
                    </a>
                    {s.snippet && <span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  );
}
