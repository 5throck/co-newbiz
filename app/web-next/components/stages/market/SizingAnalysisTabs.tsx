"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { VALIDATION_STATUS_META, REGISTRY, STEPS } from "../../../lib/market-sizing.ts";
import { StepSection } from "./MarketReport.tsx";
import { RegistryStatus } from "./RegistryStatus.tsx";
import type { SizingReportState } from "./useSizingReport.ts";
import { useTranslations } from "next-intl";

export function SizingPipelineTab({ ctx }: { ctx: SizingReportState }) {const t = useTranslations("stages.s1.sizingAnalysisTabs"); const tc = useTranslations("common");
  const { tab, matrix } = ctx;
  return (
    <>{tab === "pipeline" && (
        <section aria-label={t("demandPipeline")} className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge sizing-step-badge-deep">4-B</span> {t("demandPipelineConfidenceTierPer")}
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            {t("classifiesIndividualProjectsWithPlanned")} <strong>Tier 1</strong>{t("fromGroundbreakingOrContractConfirmation")}
            <strong> Tier 4</strong>{t("mouInitialReviewTheLower")}
          </p>
          {matrix.demandPipeline && matrix.demandPipeline.length > 0 ? (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table report-table" aria-label={t("demandPipelineProject")}>
              <caption className="sr-only">{t("demandPipelineProjectList")}</caption>
              <thead>
                <tr><th scope="col" className="w-[6rem]">{t("tier")}</th><th scope="col">{t("project")}</th><th scope="col">{tc("status")}</th><th scope="col">{t("codTarget")}</th><th scope="col">{tc("source")}</th></tr>
              </thead>
              <tbody>
                {[...matrix.demandPipeline].sort((a, b) => a.tier - b.tier).map((p, i) => (
                  <tr key={`${p.project}-${i}`} className={p.tier === 1 ? "row-selected" : undefined}>
                    <td>
                      <span className={`status-chip ${p.tier === 1 ? "status-green" : p.tier === 2 ? "status-amber" : "status-not-started"}`}>
                        Tier {p.tier}
                      </span>
                    </td>
                    <td className="font-semibold">
                      {p.project}
                      {p.relatedDemandIndustry ? (
                        <span className="block font-normal text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{p.relatedDemandIndustry}</span>
                      ) : null}
                    </td>
                    <td className="text-[length:var(--fs-caption)]">{p.status}</td>
                    <td className="tabular-nums">{p.codTarget ?? "—"}</td>
                    <td className="text-[length:var(--fs-caption)]">
                      {p.sourceUrl ? <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{t("originalText")}</a> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
              {t("noDemandPipelineDataEvidence")}
            </p>
          )}
        </section>
      )}</>
  );
}

export function SizingRegulationTab({ ctx }: { ctx: SizingReportState }) {const t = useTranslations("stages.s1.sizingAnalysisTabs"); const tc = useTranslations("common");
  const { tab, matrix } = ctx;
  return (
    <>{tab === "regulation" && (
        <section aria-label={t("regulatoryEnvironment")} className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge sizing-step-badge-deep">5-B</span> {t("regulatoryEnvironmentComparisonJurisdictionItem")}
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            {t("comparesRegulatoryAndPermitStatus")} <strong>{t("directPrimarySourceCheck")}</strong> {t("isShownUnverifiedIndirectEstimate")}
          </p>
          {matrix.regulatoryComparison && matrix.regulatoryComparison.length > 0 ? (
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table report-table min-w-[52rem]" aria-label={t("regulatoryEnvironmentComparison")}>
              <caption className="sr-only">{t("regulationComparisonByJurisdiction")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="col-label">{t("jurisdiction")}</th>
                  <th scope="col" className="col-type">{tc("items")}</th>
                  <th scope="col">{tc("status")}</th>
                  <th scope="col" className="col-type">{t("primarySourceCheck")}</th>
                  <th scope="col" className="col-text">{t("sourceAndDate")}</th>
                </tr>
              </thead>
              <tbody>
                {matrix.regulatoryComparison.map((r, i) => (
                  <tr key={`${r.jurisdiction}-${r.item}-${i}`}>
                    <td className="col-label font-semibold">{r.jurisdiction}</td>
                    <td className="col-type whitespace-normal">{r.item}</td>
                    <td className="whitespace-normal text-[length:var(--fs-caption)]">{r.status}</td>
                    <td className="col-type">
                      <span className={`status-chip ${r.confirmedDirectly ? "status-green" : "status-not-started"}`}>
                        {r.confirmedDirectly ? t("directCheck") : t("indirectOrEstimated")}
                      </span>
                    </td>
                    <td className="col-text whitespace-normal text-[length:var(--fs-caption)]">
                      {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{t("originalText2")}</a> : "—"}
                      {r.asOf ? ` · ${r.asOf}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
              {t("noRegulationComparisonDataRegulatory")}
            </p>
          )}
        </section>
      )}</>
  );
}

export function SizingRiskTab({ ctx }: { ctx: SizingReportState }) {const t = useTranslations("stages.s1.sizingAnalysisTabs"); const tc = useTranslations("common");
  const { tab, matrix } = ctx;
  return (
    <>{tab === "risk" && (
        <section aria-label={t("confidenceAndRisk")} className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            <span className="sizing-step-badge sizing-step-badge-deep">7-A</span> {t("confidenceAndRiskRagCap")}
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            {t("dataConfidenceCapsTheOverall")}
          </p>
          {matrix.ragCapRecommendation && (
            <div className="sizing-grade-card mt-3">
              <h4 className="text-[length:var(--fs-body)] mb-2">{t("ragCapRecommendation")}</h4>
              <span className={`status-chip ${matrix.ragCapRecommendation.grade === "green" ? "status-green" : matrix.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}>
                {t("upperBound")} {matrix.ragCapRecommendation.grade.toUpperCase()}
              </span>
              <p className="mt-2 mb-0 text-[length:var(--fs-body)]">{matrix.ragCapRecommendation.rationale}</p>
            </div>
          )}
          {matrix.killCriteriaProposals && matrix.killCriteriaProposals.length > 0 && (
            <div className="mt-3">
              <h4 className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)] mb-2">{t("killCriteriaProposal")}{matrix.killCriteriaProposals.length}{t("itemSAnalystReviewNeeded")}</h4>
              <div className="grid gap-2">
                {matrix.killCriteriaProposals.map((k, i) => (
                  <div key={i} className="sizing-grade-card">
                    <div className="flex items-center gap-2">
                      <span className={`status-chip ${k.severity === "high" ? "status-red" : k.severity === "medium" ? "status-amber" : "status-not-started"}`}>
                        {k.severity === "high" ? t("critical") : k.severity === "medium" ? t("normal") : tc("low")}
                      </span>
                      <strong className="text-[length:var(--fs-body)]">{k.name}</strong>
                    </div>
                    <p className="mt-1 mb-0 text-[length:var(--fs-caption)]"><strong>{t("basis")}</strong> {k.thresholdText}</p>
                    <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{k.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {matrix.verificationLedger && matrix.verificationLedger.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[length:var(--fs-body)] text-[color:var(--accent)]">
                {t("verificationLedger")}{matrix.verificationLedger.length}{t("itemSConfirmedCannotConfirm")}
              </summary>
              <table className="data-table mt-2" aria-label={t("verificationLedger2")}>
                <caption className="sr-only">{t("verificationStatusByClaim")}</caption>
                <thead>
                  <tr><th scope="col" className="w-[34%]">{t("claim")}</th><th scope="col">{tc("status")}</th><th scope="col">{tc("notes")}</th></tr>
                </thead>
                <tbody>
                  {matrix.verificationLedger.map((v, i) => (
                    <tr key={i}>
                      <td className="font-semibold">{v.claim}</td>
                      <td className="sizing-verdict-cell">
                        <span className={`status-chip ${v.status === "confirmed" ? "status-green" : v.status === "could_not_verify" ? "status-red" : "status-amber"}`}>
                          {v.status === "confirmed" ? tc("confirm") : v.status === "could_not_verify" ? t("cannotConfirm") : t("judgementNeeded")}
                        </span>
                      </td>
                      <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{v.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {!matrix.ragCapRecommendation && !matrix.killCriteriaProposals && !matrix.verificationLedger && (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
              {t("noConfidenceRiskDataReflected")}
            </p>
          )}
        </section>
      )}</>
  );
}

export function SizingValidateTab({ ctx }: { ctx: SizingReportState }) {const t = useTranslations("stages.s1.sizingAnalysisTabs"); const tc = useTranslations("common");
  const { tab, matrix, detail, stepSummaries } = ctx;
  return (
    <>{tab === "validate" && (
      <>
      <StepSection n={6} id="step-6" title={t("corporateFiling")}>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          {t("listedCompaniesAnnualAndInterim")} <strong>{t("cannotVerify")}</strong>{t("statesItExplicitlyALimit")}
        </p>
        <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
        <table className="data-table report-table" aria-label={t("corporateFilingResults")}>
          <caption className="sr-only">{t("corporateFilingResults2")}</caption>
          <thead>
            <tr><th scope="col" className="w-[34%]">{t("matrixClaim")}</th><th scope="col">{tc("judgement")}</th><th scope="col">{t("primarySourceEvidence")}</th></tr>
          </thead>
          <tbody>
            {matrix.crossValidation.map((v) => {
              const meta = VALIDATION_STATUS_META[v.status] ?? VALIDATION_STATUS_META.directional;
              return (
                <tr key={v.claim}>
                  <td className="font-semibold">{v.claim}</td>
                  <td className="sizing-verdict-cell"><span className={`status-chip ${meta.chip}`}>{meta.label}</span></td>
                  <td className="text-[length:var(--fs-caption)]">{v.evidence}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </StepSection>

      <StepSection n={7} id="step-7" title={t("analysisLimitationsList")}>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          {t("judgementalCalibrationsSourceMismatchesAnd")}
        </p>
        <ol className="sizing-limitations">
          {matrix.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ol>
        {matrix.sectionConfidence && matrix.sectionConfidence.length > 0 && (
          <>
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-4 mb-1">{t("dataConfidenceGradeBySection")}</h4>
            <table className="data-table" aria-label={tc("sectionConfidenceGrade")}>
              <caption className="sr-only">{t("dataConfidenceGradeBySection2")}</caption>
              <thead>
                <tr><th scope="col">{tc("section")}</th><th scope="col">{t("grade")}</th><th scope="col">{tc("notes")}</th></tr>
              </thead>
              <tbody>
                {matrix.sectionConfidence.map((s, i) => (
                  <tr key={i}>
                    <td className="font-semibold">{s.section}</td>
                    <td>
                      <span className={`status-chip ${s.grade === "A" || s.grade === "B" ? "status-green" : s.grade === "B-" || s.grade === "C" ? "status-amber" : "status-red"}`}>
                        {s.grade}
                      </span>
                    </td>
                    <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{s.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </StepSection>

      <StepSection n={8} id="step-8" title={t("registerInTheAssumptionRegistry")}>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          {t("aFrozenMatrixRegistersOne")}
        </p>
        <RegistryStatus
          sizing={detail.sizing}
          referenceImplementation={REGISTRY.referenceImplementation}
        />
      </StepSection>

      {stepSummaries && stepSummaries.length > 0 && (
        <details className="market-section sizing-step">
          <summary className="cursor-pointer text-[length:var(--fs-body)]">{t("pipelineStepAnalysisNotes")}{stepSummaries.length}{t("step")}</summary>
          <ol className="mt-3 space-y-2 text-[length:var(--fs-body)]">
            {stepSummaries.map((s, i) => (
              // 파이프라인은 단계 5를 최대 3회 기록한다(탑다운 CAGR·외부 전망 격차·
              // 드라이버 보정 루프 — market-sizing-pipeline.ts) — step 값만 키로 쓰면
              // 중복 key "5"가 된다(2026-10-22 사용자 리포트). 목록은 렌더 내 append-only
              // 이므로 step-색인 복합 키를 쓴다.
              <li key={`${s.step}-${i}`}>
                <strong>{s.step}. {STEPS[s.step - 1]?.title ?? s.step}</strong>{" "}
                <span className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                  {s.source === "llm" ? t("llmSummary") : t("deterministicSummary")}
                </span>
                <br />{s.summary}
              </li>
            ))}
          </ol>
        </details>
      )}
      </>
      )}</>
  );
}
