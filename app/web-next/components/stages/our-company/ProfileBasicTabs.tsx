"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
// ProfileSwotTab moved to its own file (design 2026-11-13-profile-headless-fallback round) —
// re-exported here so the existing import sites stay unchanged.
import Link from "next/link";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";
import { AnalystEditedChip, ProfileFieldEditor, ProfileProvidedSources, isEditedItem } from "./ProfileEvidence.tsx";
import { useTranslations } from "next-intl";

export function ProfileOverviewTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const t = useTranslations("components.ourCompany.profileBasicTabs");
  const tc = useTranslations("common");
  const { profileTab } = ctx;
  return (
    <>
      {profileTab === "overview" && (
        <div className="text-[length:var(--fs-body)]">
          {profile.ragCapRecommendation && (
            <div className="sizing-grade-card mb-3">
              <h4 className="text-[length:var(--fs-body)] mb-2">{t("confidenceCapRecommendation")}</h4>
              <span
                className={`status-chip ${profile.ragCapRecommendation.grade === "green" ? "status-green" : profile.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}
              >
                {t("upperBound")} {profile.ragCapRecommendation.grade.toUpperCase()}
              </span>
              <p className="mt-2 mb-0 text-[length:var(--fs-body)]">{profile.ragCapRecommendation.rationale}</p>
            </div>
          )}
          {/* typed guard instead of a non-null assertion — the editor renders only
              for an open member (fail-quiet, never an undefined memberId) */}
          {ctx.openMember && (
            <ProfileFieldEditor
              key={profile.companyName + (profile.analystEditLog?.length ?? 0)}
              ctx={ctx}
              memberId={ctx.openMember}
              profile={profile}
            />
          )}
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">
            {t("overallEvaluation")} {profile.analystEdited?.businessAssessment && <AnalystEditedChip />}
          </h3>
          <p className="mb-3">{profile.businessAssessment || "—"}</p>
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("industryExposure")}</h3>
          {profile.industryExposure && profile.industryExposure.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-3">
              {profile.industryExposure.map((x) => (
                <span key={x} className="status-chip status-in-progress">
                  {x}
                  {isEditedItem(profile, "industryExposure", x) && <AnalystEditedChip />}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-3">
              {t("noIndustryExposureInformation")}
            </p>
          )}
          {!profile.schemaVersion && (
            <p className="sizing-note-list text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]" role="note">
              {t("thisProfilePredatesExtendedAnalysis")} <strong>{tc("reanalyze")}</strong>
              {t("generatesTheFullReport")}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export { ProfileSwotTab } from "./ProfileSwotTab.tsx";

export function ProfileIndustryTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const t = useTranslations("components.ourCompany.profileBasicTabs");
  const tc = useTranslations("common");
  const { profileTab, s1Requests, canAct, requestS1Analysis } = ctx;
  return (
    <>
      {profileTab === "industry" && (
        <div className="text-[length:var(--fs-body)]">
          <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("s1MarketAnalysisLinkage")}</h3>
          <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            {t("linksTheIndustryExposureItems")}
          </p>
          {profile.industryLinkage && profile.industryLinkage.length > 0 ? (
            // biome-ignore lint/a11y/useSemanticElements lint/a11y/noNoninteractiveTabindex: design-system scroll region (WCAG 2.1.1) — a focusable labelled region so keyboard users can scroll a wide table; <section> is not phrasing-neutral here (house table-scroll pattern)
            <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
              <table className="data-table report-table" aria-label={t("industryExposureS1MatrixLinkage")}>
                <caption className="sr-only">{t("industryExposureS1MatrixLinkage2")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("industry")}</th>
                    <th scope="col" className="col-num">
                      {t("s1Anchor")}
                    </th>
                    <th scope="col" className="col-num">
                      CAGR
                    </th>
                    <th scope="col" className="col-num">
                      {t("externalOutlookGap")}
                    </th>
                    <th scope="col" className="w-[11rem]">
                      {tc("link")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {profile.industryLinkage.map((l, i) => {
                    const req = s1Requests[l.industry];
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: no stable row id in the linkage payload — industry+index composite is deterministic per render
                      <tr key={`${l.industry}-${i}`}>
                        <td>{l.industry}</td>
                        <td className="col-num tabular-nums">
                          {l.anchorTotalUsdB != null ? `$${l.anchorTotalUsdB.toFixed(2)}B` : "—"}
                        </td>
                        <td className="col-num tabular-nums">{l.cagr != null ? `${l.cagr.toFixed(1)}%` : "—"}</td>
                        <td className="col-num tabular-nums">
                          {l.externalGapPercent != null
                            ? `${l.externalGapPercent > 0 ? "+" : ""}${l.externalGapPercent}%`
                            : "—"}
                        </td>
                        <td className="text-[length:var(--fs-caption)]">
                          {l.matrixFound && l.industryId ? (
                            <Link
                              href={`/market?industry=${encodeURIComponent(l.industryId)}`}
                              className="text-[color:var(--accent)] underline"
                            >
                              {t("marketAnalysisReport")}
                            </Link>
                          ) : req?.status === "created" ? (
                            <span className="flex items-center gap-1">
                              <span className="status-chip status-amber">{t("s1AnalysisInProgress")}</span>
                              {req.industryId && (
                                <Link
                                  href={`/market?industry=${encodeURIComponent(req.industryId)}`}
                                  className="text-[color:var(--accent)] underline"
                                >
                                  {t("report")}
                                </Link>
                              )}
                            </span>
                          ) : req?.status === "creating" ? (
                            <span className="status-chip status-not-started">{t("requesting")}</span>
                          ) : !canAct ? (
                            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">—</span>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              title={t("startsThisIndustrySS1")}
                              onClick={() => void requestS1Analysis(l.industry)}
                            >
                              {t("requestS1Analysis")}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
              {t("noIndustryLinkageDataOn")}
            </p>
          )}
          {profile.industryLinkage?.some(
            (l) =>
              l.qualitativeLinks &&
              (l.qualitativeLinks.opportunityFactors.length > 0 || l.qualitativeLinks.riskFactors.length > 0),
          ) && (
            <div className="chart-pair mt-3">
              <div className="chart-half sizing-grade-card report-bullet-card">
                <h4>{t("opportunityFactorsOfLinkedIndustries")}</h4>
                <ul className="report-bullet-list">
                  {profile.industryLinkage
                    .flatMap((l) => l.qualitativeLinks?.opportunityFactors ?? [])
                    .slice(0, 6)
                    .map((f, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: factor strings carry no id and the list is static per profile render
                      <li key={i}>{f}</li>
                    ))}
                </ul>
              </div>
              <div className="chart-half sizing-grade-card report-bullet-card">
                <h4>{t("riskFactorsOfLinkedIndustries")}</h4>
                <ul className="report-bullet-list">
                  {profile.industryLinkage
                    .flatMap((l) => l.qualitativeLinks?.riskFactors ?? [])
                    .slice(0, 6)
                    .map((f, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: factor strings carry no id and the list is static per profile render
                      <li key={i}>{f}</li>
                    ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function ProfileSourcesTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const t = useTranslations("components.ourCompany.profileBasicTabs");
  const tc = useTranslations("common");
  const { profileTab } = ctx;
  return (
    <>
      {profileTab === "sources" && (
        <div className="text-[length:var(--fs-body)]">
          {/* typed guard instead of a non-null assertion (same rule as the overview tab) */}
          {ctx.openMember && <ProfileProvidedSources ctx={ctx} memberId={ctx.openMember} profile={profile} />}
          {(profile.researchSources ?? []).filter((s) => !s.provided).length > 0 ? (
            <ul className="sizing-note-list mb-3">
              {(profile.researchSources ?? [])
                .filter((s) => !s.provided)
                .map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: source records carry no id — title+url is not guaranteed unique, index keeps keys stable per render
                  <li key={i}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[color:var(--accent)] underline"
                    >
                      {s.title}
                    </a>
                    <span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic">{t("noSourceRecords")}</p>
          )}
          {profile.sectionConfidence && profile.sectionConfidence.length > 0 && (
            <>
              <h3 className="sizing-step-title text-[length:var(--fs-body)] mt-3">
                {t("dataConfidenceGradeBySection")}
              </h3>
              <table className="data-table" aria-label={tc("sectionConfidenceGrade")}>
                <caption className="sr-only">{tc("sectionConfidenceGrade")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{tc("section")}</th>
                    <th scope="col">{t("grade")}</th>
                    <th scope="col">{tc("notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.sectionConfidence.map((s, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: ledger rows carry no id — section names can repeat across versions, index is the stable key
                    <tr key={i}>
                      <td className="font-semibold">{s.section}</td>
                      <td>
                        <span
                          className={`status-chip ${s.grade === "A" || s.grade === "B" ? "status-green" : s.grade === "B-" || s.grade === "C" ? "status-amber" : "status-red"}`}
                        >
                          {s.grade}
                        </span>
                      </td>
                      <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {profile.verificationLedger && profile.verificationLedger.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[length:var(--fs-body)] text-[color:var(--accent)]">
                <span aria-hidden="true">🔍</span> {t("verificationLedger")}
                {profile.verificationLedger.length}
                {t("itemSConfirmedCannotConfirm")}
              </summary>
              <table className="data-table mt-2" aria-label={t("verificationLedger2")}>
                <caption className="sr-only">{t("verificationStatusByClaim")}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-[34%]">
                      {tc("items")}
                    </th>
                    <th scope="col">{tc("status")}</th>
                    <th scope="col">{tc("evidence")}</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.verificationLedger.map((v, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: ledger rows carry no id — item names can repeat, index is the stable key
                    <tr key={i}>
                      <td className="font-semibold">{v.item}</td>
                      <td>
                        <span
                          className={`status-chip ${v.status === "confirmed" ? "status-green" : v.status === "could_not_verify" ? "status-red" : "status-amber"}`}
                        >
                          {v.status === "confirmed"
                            ? tc("confirm")
                            : v.status === "could_not_verify"
                              ? t("cannotConfirm")
                              : t("judgementNeeded")}
                        </span>
                      </td>
                      <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{v.evidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </>
  );
}
