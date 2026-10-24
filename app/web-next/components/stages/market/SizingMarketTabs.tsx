"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { segmentsOf } from "../../../lib/market-sizing.ts";
import { StepSection } from "./MarketReport.tsx";
import { competitiveColPct } from "./constants.ts";
import { ColGroup } from "../../ui.tsx";
import { CompetitiveInputForm } from "./CompetitiveInputForm.tsx";
import { AnchorChart, RegionWeightDonut, SegmentMixStack, RegionTable } from "./SizingCharts.tsx";
import type { SizingReportState } from "./useSizingReport.ts";
import { useState, useEffect } from "react";
import { formatPctOrNa, formatUsdBOrNa, isSyntheticSizing, SYNTHETIC_BADGE_TEXT } from "../../../lib/synthetic-value.ts";
import { useTranslations } from "next-intl";

/** ADR-0181 follow-up — the S1 analysis DECLARES its market-size unit at
 *  analysis time (person-settable, audited on the server). The declaration
 *  rides the version payload scope, so the entry-market unit resolution and
 *  the KRW gaesan need no S2-side re-declaration. */
function SizingUnitDeclaration({ ctx }: { ctx: SizingReportState }) {const t = useTranslations("stages.s1.sizingMarketTabs"); const tc = useTranslations("common");
  const [unit, setUnit] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!ctx.analysisId) return;
    fetch(`/api/market-overview/analyses/${encodeURIComponent(ctx.analysisId)}/unit`)
      .then((r) => r.json())
      .then((b) => { setUnit(b.data?.unit_basis ?? null); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [ctx.analysisId]);
  async function save(v: string) {
    setUnit(v === "" ? null : v);
    setBusy(true); setNotice(null);
    try {
      const r = await fetch(`/api/market-overview/analyses/${encodeURIComponent(ctx.analysisId!)}/unit`, {
        method: "PUT",
        headers: { "content-type": "application/json", "X-CSRF-Token": document.cookie.split("; ").find((c) => c.startsWith("co_newbiz_csrf="))?.split("=")[1] ?? "" },
        credentials: "include",
        body: JSON.stringify({ unit_basis: v === "" ? null : v }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => null);
        setNotice(b?.error?.message ?? tc("saveFailed"));
      } else {
        setNotice(t("marketSizeUnitDeclaredFrom"));
        await ctx.reload();
      }
    } finally { setBusy(false); }
  }
  if (!ctx.analysisId || !ctx.canCurate || !loaded) return null;
  return (
    <label className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] flex items-center gap-1" data-testid="sizing-unit-declaration">
      {t("declareMarketSizeUnit")}
      <select
        aria-label={t("declareMarketSizeUnit2")}
        className="sizing-new-input sizing-new-input-sm"
        value={unit ?? ""}
        disabled={busy}
        onChange={(e) => void save(e.target.value)}
      >
        <option value="">{t("conventionUsdBillionsYr")}</option>
        <option value="usd_b_year">{t("annualRevenueUsdBillionsYr")}</option>
        <option value="usd_m_year">{t("annualRevenueUsdMillionsYr")}</option>
        <option value="krw_m_year">{t("annualRevenueKrwMillionsYr")}</option>
        <option value="eur_b_year">{t("annualRevenueEurBillionsYr")}</option>
        <option value="eur_m_year">{t("annualRevenueEurMillionsYr")}</option>
        <option value="units_year">{t("unitsSoldUnitsYr")}</option>
      </select>
      {notice && <span>{notice}</span>}
    </label>
  );
}

export function SizingOverviewTab({ ctx }: { ctx: SizingReportState }) {const t = useTranslations("stages.s1.sizingMarketTabs"); const tc = useTranslations("common");
  const { tab, matrix, proj2030Total, stepSummaries } = ctx;
  const synthetic = isSyntheticSizing(stepSummaries);
  const badge = synthetic ? <span className="status-chip status-amber">{SYNTHETIC_BADGE_TEXT}</span> : null;
  return (
    <>{tab === "overview" && (
        <section aria-label={tc("overview")} className="market-section sizing-step">
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge"></span> {t("keySummary")}
          </h3>
          <div className="summary-cards">
            <div className="summary-card glass">
              <span className="summary-value mono-num">{formatUsdBOrNa(matrix.anchor.total)}</span>
              {badge}
              <span className="text-label">{t("baseMarketSize2026")}</span>
              <SizingUnitDeclaration ctx={ctx} />
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{formatPctOrNa(matrix.consistency.bottomUpCagr)}</span>
              {badge}
              <span className="text-label">{t("growthRateAnnualAverage")}</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{formatUsdBOrNa(proj2030Total)}</span>
              {badge}
              <span className="text-label">{t("n2030OutlookBaseScenario")}</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{matrix.chainGrade.grade}</span>
              <span className="text-label">{t("chainGradeStatisticalHops")} {matrix.chainGrade.statisticalHops}{tc("countSuffixParen")}</span>
            </div>
          </div>
          <ul className="sizing-note-list mt-3">
            <li>{t("analysisMethodV11")} {matrix.provenance === "frozen-research" ? t("manualAnalysisFromResearchDocuments") : t("pipelineOutputAiEstimatesIncluded")}</li>
            <li>{t("segment")} {segmentsOf(matrix).map((x) => x.label).join(" / ")} {t("region")} {matrix.regions.length}{t("itemS")}</li>
            <li>{t("scenarioPessimisticBaseOptimisticCagr")} <strong>{t("growth")}</strong> {t("tab")}</li>
            <li>{t("competitiveStructureDetailsIn")} <strong>{tc("competitiveStructure")}</strong> {t("tabOpportunityRiskFactors")} <strong>{t("qualitativeAnalysis")}</strong> {t("tab2")}</li>
          </ul>
        </section>
      )}</>
  );
}

export function SizingCompetitiveTab({ ctx }: { ctx: SizingReportState }) {const t = useTranslations("stages.s1.sizingMarketTabs"); const tc = useTranslations("common");
  const { tab, matrix, canCurate, analysisId } = ctx;
  return (
    <>{tab === "competitive" && (
        <section aria-label={tc("competitiveStructure")} className="market-section sizing-step">
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge">2-A</span> {t("competitiveStructureMarketConcentrationAnd")}
          </h3>
        {/* S1 competitive-intelligence 산출 — 산업 적응형 컬럼: (1) 레거시/시드 매트릭스의
            techType·용량·진행상태는 데이터가 있을 때만, (2) 파이프라인 신규 산출은
            산업별 attributes(라벨 자유)를 동적 컬럼으로 렌더링한다 (ADR-0092 optional). */}
        {matrix.competitive && (
          <>
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-4 mb-1">{tc("competitiveStructure")}</h4>
            <p className="mb-1 text-[length:var(--fs-body)]">{matrix.competitive.structure}</p>
            {matrix.competitive.players.length > 0 && (() => {
              const players = matrix.competitive.players;
              const hasTechType = players.some((pl) => pl.techType);
              const hasCapacity = players.some((pl) => pl.capacityMWe !== undefined);
              const hasProjectStatus = players.some((pl) => pl.projectStatus);
              // 동적 속성 컬럼 — player들이 공유하는 라벨의 합집합(최대 4개)
              const attrLabels: string[] = [];
              for (const pl of players) {
                for (const a of pl.attributes ?? []) {
                  if (!attrLabels.includes(a.label)) attrLabels.push(a.label);
                }
              }
              const attrOf = (pl: (typeof players)[number], label: string) =>
                pl.attributes?.find((a) => a.label === label)?.value ?? "—";
              return (
              <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table report-table table-fixed-pct tmin-80" aria-label={tc("competitiveStructureKeyCompanies")}>
                <caption className="sr-only">{t("competitiveStructureKeyCompanies")}</caption>
                <ColGroup widths={competitiveColPct(1 + (hasTechType ? 1 : 0) + (hasCapacity ? 1 : 0) + (hasProjectStatus ? 1 : 0) + Math.min(attrLabels.length, 4))} />
                <thead>
                  <tr>
                    <th scope="col" className="col-label">{t("company")}</th>
                    <th scope="col" className="col-type">{t("position")}</th>
                    {hasTechType && <th scope="col" className="col-type">{t("technologyType")}</th>}
                    {hasCapacity && <th scope="col" className="col-num">{t("capacityMwe")}</th>}
                    {hasProjectStatus && <th scope="col" className="col-type">{t("progressStatus")}</th>}
                    {attrLabels.slice(0, 4).map((label) => <th key={label} scope="col" className="col-type">{label}</th>)}
                    <th scope="col" className="col-text">{tc("notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((pl) => (
                    <tr key={pl.name}>
                      <td className="col-label font-semibold">{pl.name}</td>
                      <td className="col-type">
                        <span className={`status-chip ${pl.tier === "leader" ? "status-green" : pl.tier === "challenger" ? "status-amber" : "status-not-started"}`}>
                          {pl.tier === "leader" ? t("leader") : pl.tier === "challenger" ? t("challenger") : t("niche")}
                        </span>
                      </td>
                      {hasTechType && <td className="col-type">{pl.techType ?? "—"}</td>}
                      {hasCapacity && <td className="col-num tabular-nums">{pl.capacityMWe !== undefined ? pl.capacityMWe.toLocaleString() : "—"}</td>}
                      {hasProjectStatus && <td className="col-type">{pl.projectStatus ? <span className="status-chip status-in-progress">{pl.projectStatus}</span> : "—"}</td>}
                      {attrLabels.slice(0, 4).map((label) => <td key={label} className="col-type">{attrOf(pl, label)}</td>)}
                      <td className="col-text cell-truncate text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{pl.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              );
            })()}
          </>
        )}
          {!matrix.competitive && (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
              {t("noCompetitiveStructureDataDerived")}
            </p>
          )}
          {canCurate && analysisId && <CompetitiveInputForm analysisId={analysisId} />}
          <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("shareAndRankAreQualitative")}
          </p>
        </section>
      )}</>
  );
}

export function SizingSizeTab({ ctx }: { ctx: SizingReportState }) {const t = useTranslations("stages.s1.sizingMarketTabs"); const tc = useTranslations("common");
  const { tab, matrix } = ctx;
  return (
    <>{tab === "size" && (
      <>
      <StepSection n={2} id="step-2" title={t("baseMarketSizingTriangulation")}>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          {t("twoOrThreeIndependentEstimates")}
        </p>
        <AnchorChart matrix={matrix} />
        <ul className="sizing-note-list mt-2">
          {matrix.anchor.sources.map((s) => (
            <li key={s.label} className={s.status === "excluded" ? "text-[color:var(--muted-fg)] line-through" : ""}>
              <strong>{s.label}</strong> — ${s.estimate.toFixed(2)}B
              {s.sourceUrl && <> · <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{tc("source")}</a></>}
              {s.asOf && <> <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">({s.asOf})</span></>}
              {s.methodology && <span className="block pl-4 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("measurementMethodology")} {s.methodology}</span>}
              <span className="block pl-4 text-[length:var(--fs-caption)]">{s.note}</span>
            </li>
          ))}
        </ul>
      </StepSection>
      </>
      )}</>
  );
}

export function SizingAllocationTab({ ctx }: { ctx: SizingReportState }) {const t = useTranslations("stages.s1.sizingMarketTabs");
  const { tab, matrix } = ctx;
  return (
    <>{tab === "allocation" && (
      <>
      <StepSection n={3} id="step-3" title={t("regionAndSegmentAllocation")}>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          {t("regionWeightsComeFromAdjacent")}
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{t("regionWeightsDonut")}</h4>
            <RegionWeightDonut matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{t("segmentMixByRegionStacked")}</h4>
            <SegmentMixStack matrix={matrix} />
          </div>
        </div>
        <RegionTable matrix={matrix} />
      </StepSection>
      </>
      )}</>
  );
}
