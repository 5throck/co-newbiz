"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { segmentsOf } from "../../../lib/market-sizing.ts";
import { ColGroup } from "../../ui.tsx";
import { chainLinkColPct } from "./constants.ts";
import { StepSection } from "./MarketReport.tsx";
import { POSITION_LABELS } from "./marketFormat.ts";
import { StepSensitivityChart } from "./SizingCharts.tsx";
import type { SizingReportState } from "./useSizingReport.ts";
import { useTranslations } from "next-intl";

export function SizingStructureTab({ ctx }: { ctx: SizingReportState }) {const tr = useTranslations(); const t = useTranslations("stages.s1.sizingStructureTab"); const tc = useTranslations("common");
  const { tab, matrix, canCurate, onAddLinked, view, retiringLinkId, retireLink, approving, approveProposal, chainLinkError, manualLink, setManualLink, linkSaving, submitManualLink, linkSaved, legacyRelation, setLegacyRelation, legacyAssigning, assignLegacyRelation, detail } = ctx;
  return (
    <>{tab === "structure" && (
      <>
      <StepSection n={1} id="step-1" title={t("marketStructureDefinitionAnalysisAxes")}>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          {t("theMarket")} <strong>{t("regionSegmentScenario")}</strong> {t("threeAxesAndTheAnalysis")}
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <table className="data-table sizing-axes-table" aria-label={t("analysisAxisDefinitions")}>
              <caption className="sr-only">{t("analysisAxisDefinitions2")}</caption>
              <thead><tr><th scope="col">{tc("division")}</th><th scope="col">{tc("value")}</th></tr></thead>
              <tbody>
                <tr><td className="font-semibold">{t("region")}</td><td>{matrix.regions.map((r) => r.label).join(" / ")} ({matrix.regions.length}{tc("countSuffixParen")}</td></tr>
                <tr><td className="font-semibold">{t("segment")}</td><td>{segmentsOf(matrix).map((seg) => seg.label).join(" / ")} ({segmentsOf(matrix).length}{tc("countSuffixParen")}</td></tr>
                <tr><td className="font-semibold">{t("scenario")}</td><td>{t("pessimisticBaseOptimistic3Cagr")}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="chart-half sizing-grade-card">
            <span className="status-chip status-amber">{t("chainGrade")} {matrix.chainGrade.grade}</span>
            <p className="mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{matrix.chainGrade.note}</p>
            <p className="mt-1 text-[length:var(--fs-caption)]">{t("statisticalHops")} {matrix.chainGrade.statisticalHops}{t("itemSAnalysisHopsDo")}</p>
          </div>
        </div>
        <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-4 mb-1">
          {t("industryChainDirectionPosition")} {POSITION_LABELS(tr)[matrix.chainDirection.position] ?? matrix.chainDirection.position}
        </h4>
        <table className="data-table" aria-label={t("industryChainDirectionAnalysis")}>
          <caption className="sr-only">{t("industryChainDirectionAnalysis2")}</caption>
          <thead>
            <tr><th scope="col" className="w-[8rem]">{tc("direction")}</th><th scope="col">{t("adjacentIndustries")}</th><th scope="col">{t("analysisPoints")}</th></tr>
          </thead>
          <tbody>
            {matrix.chainDirection.relatedIndustries.map((r, i) => (
              <tr key={i}>
                <td className="font-semibold">{r.relation}</td>
                <td>{r.name}</td>
                <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{matrix.chainDirection.note}</p>

        {/* 가치사슬 연계 — 링크 + 승인 대기 제안 + 등급 (S1 산출물, ADR-0126) */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 mb-1">
          <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("valueChainLinkage")}</h4>
          {canCurate && onAddLinked && (
            <button type="button" className="btn-ghost btn-sm" onClick={onAddLinked} title={t("pickAdditionalIndustriesToAnalyze")}>
              {t("continueAnalysisIntoLinkedIndustries")}
            </button>
          )}
        </div>
        {view.chain.links.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
            {t("noValueChainLinkageLinks")}
          </p>
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
          <table className="data-table table-fixed-pct tmin-56" aria-label={t("valueChainLinkageLink")}>
            <caption className="sr-only">{t("valueChainLinkageLink2")}</caption>
            <ColGroup widths={chainLinkColPct(canCurate ? 7 : 6)} />
            <thead>
              <tr><th scope="col">{t("relation")}</th><th scope="col">{t("industry")}</th><th scope="col">hop</th><th scope="col">{t("coefficientBeta")}</th><th scope="col">{t("lagMonths")}</th><th scope="col">{tc("evidence")}</th>{canCurate && <th scope="col">{tc("manage")}</th>}</tr>
            </thead>
            <tbody>
              {view.chain.links.map((l, i) => (
                <tr key={`${l.industry_id}-${l.direction}-${i}`}>
                  <td className="font-semibold">{l.relation ?? (l.direction === "upstream" ? tc("upstreamSupply") : tc("downstreamDemand"))}</td>
                  <td>{l.name_ko}</td>
                  <td>{l.hop_type === "engineering" ? "engineering" : l.hop_type === "statistical" ? "statistical" : t("structureApproved")}</td>
                  <td className="tabular-nums">{l.hop_type === "engineering" ? l.coefficient : l.beta !== null ? `β ${l.beta} (R² ${l.r2})` : "—"}</td>
                  <td className="tabular-nums">{l.lag_months ?? "—"}</td>
                  <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{l.evidence_ref}</td>
                  {canCurate && (
                    <td>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={retiringLinkId === l.id}
                        onClick={() => void retireLink(l.id)}
                      >
                        {retiringLinkId === l.id ? t("recovering") : t("recovery")}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {/* ADR-0126 — S1 시장 구조 정의가 도출한 인접 산업 중 산업 마스터와
            매칭된 것을 승인 대기 제안으로 제시한다. 등록은 사람의 행위다. */}
        {canCurate && (view.proposals?.length ?? 0) > 0 && (
          <div className="sizing-grade-card mt-2">
            <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">{t("proposalsAwaitingApproval")}</span> {t("adjacentIndustriesDerivedFromThe")}</p>
            <div className="flex flex-wrap gap-2">
              {view.proposals!.map((p) => (
                <span key={p.industry_id} className="control-chip">
                  <span className="font-semibold">{p.relation}</span> · {p.name_ko}
                  <button type="button" className="btn-ghost btn-sm ml-1" disabled={approving === p.industry_id} onClick={() => void approveProposal(p)}>
                    {approving === p.industry_id ? tc("registering") : tc("approve")}
                  </button>
                </span>
              ))}
            </div>
            {chainLinkError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0">{chainLinkError}</p>}
          </div>
        )}
        {(view.unmatchedProposals?.length ?? 0) > 0 && (
          <p className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("unmatchedCandidatesNotInThe")} {view.unmatchedProposals!.map((u) => `${u.relation} ${u.name}`).join(", ")}
          </p>
        )}
        {/* ADR-0126 — 제안이 없어도 사람이 직접 연계를 등록할 수 있다 (같은 승인 행위). */}
        {canCurate && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("registerDirectlyPickFromThe")}</summary>
            <div className="sizing-new-form mt-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("targetIndustry")}</span>
                  <select
                    value={manualLink.industry_id}
                    onChange={(e) => setManualLink({ ...manualLink, industry_id: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm"
                    style={{ minWidth: "12rem" }}
                  >
                    <option value="">{tc("selectEllipsis")}</option>
                    {(view.linkableIndustries ?? []).map((i) => (
                      <option key={i.id} value={i.id}>{i.name_ko}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{t("relation2")}</span>
                  <select value={manualLink.relation} onChange={(e) => setManualLink({ ...manualLink, relation: e.target.value })} className="sizing-new-input sizing-new-input-sm">
                    <option value={tc("downstream")}>{tc("downstreamDemand")}</option>
                    <option value={tc("secondTierDownstream")}>{t("downstreamDemand2Hops")}</option>
                    <option value={tc("upstream")}>{tc("upstreamSupply")}</option>
                    <option value={tc("secondTierUpstream")}>{t("upstreamSupply2Hops")}</option>
                  </select>
                </label>
                <label className="text-[length:var(--fs-caption)]">
                  <span className="block mb-1">{tc("evidenceAsterisk")}</span>
                  <input value={manualLink.evidence_ref} onChange={(e) => setManualLink({ ...manualLink, evidence_ref: e.target.value })} className="sizing-new-input" style={{ flex: "1 1 12rem" }} />
                </label>
                <button type="button" className="btn-ghost btn-sm" disabled={linkSaving || !manualLink.industry_id || !manualLink.evidence_ref.trim()} onClick={() => void submitManualLink()}>
                  {linkSaving ? tc("registering") : tc("register")}
                </button>
              </div>
              {linkSaved && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--green-fg)] mt-1 mb-0">{t("linkRegistered")}</p>}
            </div>
          </details>
        )}
        {view.chain.grade && (
          <p className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            <span className="status-chip status-green mr-1">{t("chainGrade2")} {view.chain.grade.reliability_grade}</span>
            {view.chain.grade.grade_rationale}
          </p>
        )}

        {/* ADR-0129 — relation 미태깅 레거시 구조 링크(ADR-0126 시절 등록) 검토 큐.
            은퇴하지 않고 relation만 지정하면 되므로 별도 섹션으로 분리한다. */}
        {canCurate && view.chain.legacyUntagged.length > 0 && (
          <div className="sizing-grade-card mt-2">
            <p className="text-[length:var(--fs-caption)] mb-1">
              <span className="font-semibold">{t("legacyReview")}</span> {t("aLegacyStructureLinkWithout")}
            </p>
            <div className="flex flex-wrap gap-2">
              {view.chain.legacyUntagged.map((l) => (
                <span key={l.id} className="control-chip">
                  <span className="font-semibold">{l.direction === "upstream" ? tc("upstreamSupply") : tc("downstreamDemand")}</span> · {l.name_ko}
                  <select
                    value={legacyRelation[l.id] ?? tc("downstream")}
                    onChange={(e) => setLegacyRelation({ ...legacyRelation, [l.id]: e.target.value })}
                    className="sizing-new-input sizing-new-input-sm ml-1"
                  >
                    <option value={tc("downstream")}>{tc("downstream")}</option>
                    <option value={tc("secondTierDownstream")}>{tc("secondTierDownstream")}</option>
                    <option value={tc("upstream")}>{tc("upstream")}</option>
                    <option value={tc("secondTierUpstream")}>{tc("secondTierUpstream")}</option>
                  </select>
                  <button
                    type="button"
                    className="btn-ghost btn-sm ml-1"
                    disabled={legacyAssigning === l.id}
                    onClick={() => void assignLegacyRelation(l.id)}
                  >
                    {legacyAssigning === l.id ? t("assigning") : t("assigned")}
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <StepSensitivityChart sensitivities={detail.driver_sensitivities} />
      </StepSection>
      </>
      )}</>
  );
}
