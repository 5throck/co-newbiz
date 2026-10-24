"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { useTranslations } from "next-intl";
import { renderWithCitations } from "./renderWithCitations.tsx";
import { CompetitorRegistryBlock } from "./CompetitorRegistryBlock.tsx";
import { DegradedChip } from "../stages/our-company/ProfileChips.tsx";
import type { TargetDetailViewState } from "./useTargetActions.ts";
import type { TargetDetail } from "./types.ts";

export function TargetAiProfileTab({ ctx, t }: { ctx: TargetDetailViewState; t: TargetDetail }) {
  const tr = useTranslations("components.brownfieldTarget.aiProfileTab");
  const tc = useTranslations("common");
  const { profileTab, companyId, companyProfile, setProfileTab } = ctx;
  return (
    <>{profileTab === "aiprofile" && (
          <div className="mt-3">
            {!companyId ? (
              <div className="card"><p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tr("noCompanyLinked")}</p></div>
            ) : companyProfile === undefined ? (
              <div className="card"><p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("loading")}</p></div>
            ) : companyProfile === null ? (
              <div className="card"><p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{tr("profileLoadFailed")}</p></div>
            ) : (
              <>
                {/* 헤더 — 회사명·배지만 표시. 분석 실행/재분석 버튼은 탭 목록과
                    같은 줄 오른쪽으로 이동했다(사용자 요청, 2026-09-15). */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h2 className="text-[length:var(--fs-body)] !mb-0"><span aria-hidden="true">🏢</span> {tr("swotHeading", { p1: companyProfile.profile?.companyName ?? t.company_name })}</h2>
                  {companyProfile.profile?.dataSources?.dart && <span className="status-chip status-green">DART {companyProfile.profile.dataSources.dartYear ?? ""}</span>}
                  {(companyProfile.profile?.dataSources?.webResearchCount ?? 0) > 0 && (
                    <span className="status-chip status-in-progress">{tr("externalResearchCount", { p1: companyProfile.profile!.dataSources.webResearchCount })}</span>
                  )}
                  {companyProfile.profile?.degraded && <DegradedChip degraded={companyProfile.profile.degraded} showHint />}
                </div>

                {companyProfile.status === "in_progress" ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tr("analysisInProgress")}</p>
                ) : companyProfile.status === "failed" ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{tr("analysisFailed", { p1: companyProfile.error ?? tc("noReason") })}</p>
                ) : companyProfile.status === "not_started" || !companyProfile.profile ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tr("noProfileYet")}</p>
                ) : (
                  <div className="text-[length:var(--fs-body)]">
                    {companyProfile.profile.swot && (
                      <p className="sizing-note-list mb-2 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]" role="note">
                        {tr("swotWarning")}
                      </p>
                    )}
                    <div className="chart-pair">
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>{tr("strengthsHeading")}</h4>
                        <ul className="report-bullet-list">{companyProfile.profile.strengths.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [], tr("citationTitlePrefix"))}</li>)}</ul>
                      </div>
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>{tr("weaknessesHeading")}</h4>
                        <ul className="report-bullet-list">{companyProfile.profile.weaknesses.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [], tr("citationTitlePrefix"))}</li>)}</ul>
                      </div>
                      {companyProfile.profile.swot && (
                        <>
                          <div className="chart-half sizing-grade-card report-bullet-card">
                            <h4>{tr("opportunitiesHeading")}</h4>
                            <ul className="report-bullet-list">{companyProfile.profile.swot.opportunities.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [], tr("citationTitlePrefix"))}</li>)}</ul>
                          </div>
                          <div className="chart-half sizing-grade-card report-bullet-card">
                            <h4>{tr("threatsHeading")}</h4>
                            <ul className="report-bullet-list">{companyProfile.profile.swot.threats.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [], tr("citationTitlePrefix"))}</li>)}</ul>
                          </div>
                        </>
                      )}
                    </div>
                    <p className="mt-3 mb-0 text-[length:var(--fs-body)]">
                      <strong>{tr("assessmentLead")}</strong>{" "}
                      {companyProfile.profile.businessAssessment
                        ? renderWithCitations(companyProfile.profile.businessAssessment, companyProfile.profile?.researchSources ?? [], tr("citationTitlePrefix"))
                        : "—"}
                    </p>

                    {companyProfile.profile.competitive && !companyProfile.profile.competitive.degraded && (
                      <>
                        <h3 className="sizing-step-title text-[length:var(--fs-body)] mt-3">{tr("competitivePositioning")}</h3>
                        <p className="mb-2">{renderWithCitations(companyProfile.profile.competitive.positioning || "—", companyProfile.profile?.researchSources ?? [], tr("citationTitlePrefix"))}</p>
                        {/* ADR-0142 — 확정 경쟁사 레지스트리가 1순위. 없으면 payload
                            제안을 "미확정" 표기와 함께 보여준다(제안≠확정). */}
                        {companyId && (
                          <CompetitorRegistryBlock
                            companyId={companyId}
                            payloadCompetitors={companyProfile.profile.competitive.competitors.map((c) => ({ name: c.name, note: c.note }))}
                          />
                        )}
                      </>
                    )}

                    {/* 이 분석에 사용된 외부 검색 출처를 그 자리에 기록한다(사용자
                        요청, 2026-09-16) — 위 [n] 인용 링크의 실체. 전체 목록은
                        출처 탭에 누적된다. */}
                    {companyProfile.profile.researchSources.length > 0 && (
                      <div className="mt-3 mb-0">
                        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">
                          {tr("researchSourcesNote", { p1: companyProfile.profile.researchSources.length })} <span className="text-[color:var(--accent)]">[n]</span> {tr("researchSourcesNotePost")}{" "}
                          <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setProfileTab("sources")}>{tr("sourcesTabLink")}</button>{tr("researchSourcesNoteTail")}
                        </p>
                        <ul className="sizing-note-list mb-0" style={{ fontSize: "0.88rem" }}>
                          {companyProfile.profile.researchSources.slice(0, 5).map((s) => (
                            <li key={s.url}>
                              <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}</>
  );
}
