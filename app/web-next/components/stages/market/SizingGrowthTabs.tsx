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
import {
  CONVERGENCE_GOAL_PCT,
  consensusCitesSupersededReference,
  referenceNewerThanVersion,
  rerunCtaMode,
} from "../../../lib/market-reference-staleness.ts";
import { GrowthStalenessCard, ReferenceChip, RerunAction } from "./GrowthBannerViews.tsx";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function SizingGrowthTab({ ctx }: { ctx: SizingReportState }) {
  const t = useTranslations("stages.s1.sizingGrowthTabs");
  const tc = useTranslations("common");
  const { tab, matrix, rerunStarted, canCurate, analysisId, setRerunError, setRerunStarted, rerunError, detail } = ctx;
  // C1 — CalibrationPanel과 같은 외부 참조 엔드포인트를 live GET한다(행 원문이므로
  // created_at 포함). GET 페이로드는 additive { reference, latest }(design
  // 2026-11-13 §3.3b): reference는 유효 참조(기존 계약), latest는 폐기 무관 최신
  // 행 — 표시 버전이 폐기된 참조를 인용하는 배너 판정에 쓴다.
  interface RefRow {
    source_label: string;
    source_url: string | null;
    target_year: number;
    external_cagr_pct: number;
    external_size_b: number | null;
    captured_from: string;
    created_at: string;
    superseded_at: string | null;
  }
  const [reference, setReference] = useState<RefRow | null>(null);
  const [latest, setLatest] = useState<RefRow | null>(null);
  // A1 (addendum 2026-11-12b) — a reference saved in CalibrationPanel during the
  // same mount must raise the banner without a remount. CalibrationPanel calls
  // onReferenceSaved after a successful save; bumping the counter re-runs this
  // GET. The comparator and its inputs stay the same, so the banner cannot
  // false-positive: it still requires reference.created_at > version.created_at.
  const [referenceRefresh, setReferenceRefresh] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: referenceRefresh is an intentional trigger (A1, addendum 2026-11-12b) — the effect reads no state from it
  useEffect(() => {
    api
      .get<{ reference: RefRow | null; latest: RefRow | null }>(
        `/api/market-overview/industry/${encodeURIComponent(detail.industry.id)}/external-reference`,
      )
      .then((r) => {
        setReference(r.data.reference);
        setLatest(r.data.latest);
      })
      .catch(() => {});
  }, [detail.industry.id, referenceRefresh]);
  const referenceNewer = referenceNewerThanVersion(reference?.created_at, detail.versions[0]?.created_at);
  // C1b (design 2026-11-13 §3.3b) — 표시 버전이 폐기된 참조를 인용: 유효 참조
  // 없음(폐기로 reference=null) + 최신 행 폐기 + 표시 버전이 폐기 시각 이전
  // (폐기 이후 버전은 폴백 사다리로 재산출되므로 제외).
  const citesSuperseded =
    reference === null &&
    latest?.superseded_at != null &&
    consensusCitesSupersededReference(latest.superseded_at, detail.versions[0]?.created_at);
  // C2 — 재분석 CTA를 격차 게이트와 분리: 참조가 표시 버전보다 최신이면
  // 격차와 무관하게 재분석이 유효하다.
  const ctaMode = rerunCtaMode(matrix.externalForecast?.gapPct, referenceNewer);
  const rerunHandler = async () => {
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
  };
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
            {/* 3a (design 2026-11-13 §3.3a) — 컨센서스 참조 칩: 표시 topDownCagr의
                출처를 노출한다. 데이터는 위 live GET(reference)에 이미 있다. */}
            {reference && (
              <ReferenceChip
                sourceLabel={reference.source_label}
                sourceUrl={reference.source_url}
                targetYear={reference.target_year}
                externalCagrPct={reference.external_cagr_pct}
                capturedFrom={reference.captured_from}
                createdAt={reference.created_at}
              />
            )}
            {referenceNewer && (
              <GrowthStalenessCard
                variant="newer"
                showCta={ctaMode === "staleness"}
                rerunStarted={rerunStarted}
                canCurate={canCurate}
                onRerun={rerunHandler}
                rerunError={rerunError}
              />
            )}
            {/* 3b (design 2026-11-13 §3.3b) — 폐기 참조 인용 배너: C1 배너(유효
                참조 존재)와 조건이 상호 배타적이다. 격차 카드가 이미 CTA를
                소유하지 않는 한 재분석 CTA를 함께 보여준다. */}
            {citesSuperseded && (
              <GrowthStalenessCard
                variant="superseded"
                showCta={ctaMode !== "gap"}
                rerunStarted={rerunStarted}
                canCurate={canCurate}
                onRerun={rerunHandler}
                rerunError={rerunError}
              />
            )}
            {matrix.externalForecast ? (
              <div className="chart-half sizing-grade-card mt-4">
                <h4 className="text-[length:var(--fs-body)] mb-2">
                  {t("gapAnalysisVsExternalFuture")}
                  {matrix.externalForecast.targetYear}
                  {t("yrExtrapolatedPastGrowthVs")}

                  {(() => {
                    const gap = matrix.externalForecast.gapPct;
                    if (gap === undefined || Math.abs(gap) < CONVERGENCE_GOAL_PCT) return null;
                    return (
                      <div className="sizing-grade-card mt-2" role="note">
                        <p className="m-0 text-[length:var(--fs-caption)]">
                          <span className="status-chip status-red mr-1">{t("reviewNeeded")}</span>
                          {t("theGapBetweenOurEstimate")} <strong>{Math.abs(gap).toFixed(1)}%</strong>
                          {t("deviatesByMoreThanThe")}
                        </p>
                        <RerunAction rerunStarted={rerunStarted} canCurate={canCurate} onRerun={rerunHandler} />
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
            <CalibrationPanel
              industryId={detail.industry.id}
              matrix={matrix}
              onReferenceSaved={() => setReferenceRefresh((n) => n + 1)}
            />
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
