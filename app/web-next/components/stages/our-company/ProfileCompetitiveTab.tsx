"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { ColGroup } from "../../ui.tsx";
import { CROSSCHECK_VERDICT_META, CROSSCHECK_STATUS_META, COMPETITOR_COL_PCT, OUR_COMPANY_COPY as COPY } from "./constants.ts";
import { RowMenu } from "../../crud.tsx";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";
import { useTranslations } from "next-intl";

export function ProfileCompetitiveTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {const tr = useTranslations(); const t = useTranslations("components.ourCompany.profileCompetitiveTab"); const tc = useTranslations("common");
  const { profileTab, compError, competitors, editingCompetitor, excludingCompetitor, setEditingCompetitor, compBusy, setExcludingCompetitor, canAct, webBusy, competitorProposals, dismissedProposals, setDismissedProposals, webSuggestions, webNote, setWebSuggestions, competitorForm, setCompetitorForm, competitorDartSearching, competitorDartResults, saveCompetitorEdit, saveCompetitorExclude, restoreCompetitorRow, runCompetitorWebSearch, acceptProposal, acceptWebSuggestion, searchCompetitorDart, registerManualCompetitor } = ctx;
  return (
    <>{profileTab === "competitive" && (
              <div className="text-[length:var(--fs-body)]">
                <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("competitivePositioning")}</h3>
                {compError && <p role="alert" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{compError}</p>}

                {/* ① 확정 경쟁사 — 사람의 수용·등록으로만 생긴 레지스트리(ADR-0142) */}
                <div className="market-section mb-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h4 className="text-[length:var(--fs-body)] font-semibold m-0">{t("confirmedCompetitors")}</h4>
                    <span className="status-chip status-green">{(competitors ?? []).filter((c) => c.status === "confirmed").length}{tc("countUnit")}</span>
                  </div>
                  {(competitors ?? []).filter((c) => c.status === "confirmed").length === 0 ? (
                    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                      {t("noConfirmedCompetitorsYetAccept")}
                    </p>
                  ) : (
                    <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                      <table className="data-table report-table competitor-table table-fixed-pct tmin-48" aria-label={t("confirmedCompetitors2")}>
                        <caption className="sr-only">{t("confirmedCompetitors3")}</caption>
                        <ColGroup widths={COMPETITOR_COL_PCT} />
                        <thead>
                          <tr>
                            <th scope="col">{t("competitor")}</th>
                            <th scope="col">{tc("dartId")}</th>
                            <th scope="col">{tc("competitiveRelation")}</th>
                            <th scope="col">{tc("source")}</th>
                            <th scope="col">{t("comparison")}</th>
                            <th scope="col">{tc("manage")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(competitors ?? []).filter((c) => c.status === "confirmed").map((c) => {
                            const meta = c.crosscheck_verdict ? CROSSCHECK_VERDICT_META[c.crosscheck_verdict as keyof typeof CROSSCHECK_VERDICT_META] : null;
                            const editing = editingCompetitor?.id === c.id;
                            const excluding = excludingCompetitor?.id === c.id;
                            return (
                              <tr key={c.id}>
                                <td className="competitor-name font-semibold" title={c.name}>{c.name}</td>
                                <td className="text-[length:var(--fs-caption)] tabular-nums">
                                  {editing ? <input value={editingCompetitor.dart} onChange={(e) => setEditingCompetitor({ ...editingCompetitor, dart: e.target.value })} className="sizing-new-input" style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }} placeholder={t("id")} /> : (c.dart_corp_code || "—")}
                                </td>
                                <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                  {editing ? <input value={editingCompetitor.note} onChange={(e) => setEditingCompetitor({ ...editingCompetitor, note: e.target.value })} className="sizing-new-input" style={{ width: "100%" }} placeholder={tc("competitiveRelation")} /> : (c.note || "—")}
                                </td>
                                <td>{c.discovery_source === "ai_proposal" ? <span className="status-chip status-in-progress">{t("acceptAiRecommendation")}</span> : <span className="status-chip status-not-started">{t("manualEntry")}</span>}</td>
                                <td>{meta ? <span className={`status-chip ${meta.chip}`} title={String(c.crosscheck_verdict)}>{tr(meta.label)}</span> : <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">—</span>}</td>
                                <td>
                                  {editing ? (
                                    <span className="actions-row">
                                      <button type="button" className="btn-ghost btn-sm" disabled={compBusy} onClick={() => void saveCompetitorEdit()}>{tc("save")}</button>
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingCompetitor(null)}>{tc("cancel")}</button>
                                    </span>
                                  ) : excluding ? (
                                    <span className="actions-row">
                                      <input value={excludingCompetitor.reason} onChange={(e) => setExcludingCompetitor({ ...excludingCompetitor, reason: e.target.value })} className="sizing-new-input" style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }} placeholder={t("exclusionReason")} />
                                      <button type="button" className="btn-danger btn-sm" disabled={compBusy || !excludingCompetitor.reason.trim()} onClick={() => void saveCompetitorExclude()}>{tc("confirm")}</button>
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setExcludingCompetitor(null)}>{tc("cancel")}</button>
                                    </span>
                                  ) : !canAct ? null : (
                                    <span className="actions-row">
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingCompetitor({ id: c.id, note: c.note ?? "", dart: c.dart_corp_code ?? "" })}>{tc("edit")}</button>
                                      <RowMenu
                                        label={`${c.name} ${tr(COPY.rowMore)}`}
                                        items={[{ key: "exclude", label: tc("exclude"), danger: true, onSelect: () => setExcludingCompetitor({ id: c.id, reason: "" }) }]}
                                      />
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {(competitors ?? []).filter((c) => c.status === "excluded").length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("excludedCompetitors")} {(competitors ?? []).filter((c) => c.status === "excluded").length}{tc("countUnit")}</summary>
                      <ul className="sizing-note-list mt-1">
                        {(competitors ?? []).filter((c) => c.status === "excluded").map((c) => (
                          <li key={c.id}>
                            {c.name} — {c.exclusion_reason ?? tc("noReason")}{" "}
                            {canAct && <button type="button" className="btn-ghost btn-sm" disabled={compBusy} onClick={() => void restoreCompetitorRow(c.id)}>{t("restore")}</button>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                {/* ② AI 추천 — 최신 프로필 분석의 경쟁사 후보. 수용은 사람(경계 #2) */}
                <div className="market-section mb-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h4 className="text-[length:var(--fs-body)] font-semibold m-0">{tc("aiRecommendation")}</h4>
                    <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("basedOnTheLatestProfile")}</span>
                    {canAct && (
                    <button type="button" className="btn-ghost btn-sm" disabled={webBusy} onClick={() => void runCompetitorWebSearch()}>
                      {webBusy ? t("searchingTheWeb") : t("viaWebSearch")}
                    </button>
                    )}
                  </div>
                  {(competitorProposals ?? []).filter((p) => !p.accepted && !dismissedProposals.includes(p.name)).length === 0 ? (
                    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                      {t("noNewProposalsTheProfile")}
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {(competitorProposals ?? []).filter((p) => !p.accepted && !dismissedProposals.includes(p.name)).map((p) => {
                        const meta = p.verdict ? CROSSCHECK_VERDICT_META[p.verdict as keyof typeof CROSSCHECK_VERDICT_META] : null;
                        return (
                          <div key={p.name} className="sizing-grade-card mb-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <strong className="text-[length:var(--fs-body)]">{p.name}</strong>
                              {meta && <span className={`status-chip ${meta.chip}`} title={t("filingResearchOriginalComparisonJudgement")}>{tr(meta.label)}</span>}
                              <span className="status-chip status-not-started" title={t("thisProposalIsNotA")}>{tc("proposal")}</span>
                            </div>
                            <p className="mb-1 text-[length:var(--fs-caption)]">{p.note || "—"}</p>
                            {p.evidence.length > 0 && (
                              <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                {tc("evidenceColon")}{" "}
                                {p.evidence.map((e, i) => (
                                  <span key={i}>{i > 0 && " · "}<a href={e.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{e.title || tc("source")}</a></span>
                                ))}
                              </p>
                            )}
                            {canAct && (<div className="flex flex-wrap gap-2">
                              <button type="button" className="btn-ghost btn-sm" disabled={compBusy} onClick={() => void acceptProposal(p.name)}>{tc("accept")}</button>
                              <button type="button" className="btn-ghost btn-sm" onClick={() => setDismissedProposals((prev) => [...prev, p.name])}>{tc("ignore")}</button>
                            </div>)}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {webSuggestions && webSuggestions.length > 0 && (
                    <div className="grid gap-2 mt-2">
                      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">{webNote ?? t("additionalProposalsFromWebSearch")}</p>
                      {webSuggestions.map((ws) => (
                        <div key={ws.name} className="sizing-grade-card mb-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <strong className="text-[length:var(--fs-body)]">{ws.name}</strong>
                            <span className={`status-chip ${ws.reliability === "B" ? "status-in-progress" : "status-amber"}`} title={t("proposalBasedOnWebSearch")}>
                              {ws.reliability === "B" ? t("proposalWebSearchEvidence") : t("proposalUnverified")}
                            </span>
                          </div>
                          <p className="mb-1 text-[length:var(--fs-caption)]">{ws.note || "—"}</p>
                          {ws.sources.length > 0 && (
                            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                              {tc("evidenceColon")}{" "}
                              {ws.sources.map((e, i) => (
                                <span key={i}>{i > 0 && " · "}<a href={e.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{e.title || tc("source")}</a></span>
                              ))}
                            </p>
                          )}
                          {canAct && (<div className="flex flex-wrap gap-2">
                            <button type="button" className="btn-ghost btn-sm" disabled={compBusy} onClick={() => void acceptWebSuggestion(ws)}>{tc("accept")}</button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setWebSuggestions((prev) => (prev ?? []).filter((x) => x.name !== ws.name))}>{tc("ignore")}</button>
                          </div>)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ③ 수작업 등록 — 상시 노출 (브라운필드 후보 등록 폼 패턴) */}
                {canAct && (<div className="market-section mb-3">
                  <h4 className="text-[length:var(--fs-body)] font-semibold mb-2">{t("registerManually")}</h4>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="flex items-center gap-2">
                      <input value={competitorForm.name} onChange={(e) => setCompetitorForm({ ...competitorForm, name: e.target.value })} className="sizing-new-input" style={{ width: "14rem", maxWidth: "100%" }} placeholder={t("competitorName")} aria-label={t("competitorName2")} />
                      <button type="button" className="btn-ghost btn-sm" disabled={competitorDartSearching || !competitorForm.name.trim()} onClick={() => void searchCompetitorDart()}>{t("dartSearch")}</button>
                    </span>
                    <input value={competitorForm.dart_corp_code} onChange={(e) => setCompetitorForm({ ...competitorForm, dart_corp_code: e.target.value })} className="sizing-new-input" style={{ width: "10rem" }} placeholder={t("dartIdOptional8Digits")} aria-label={t("competitorDartId")} />
                    <span className="flex items-center gap-2" style={{ flex: "1 1 22rem" }}>
                      <input value={competitorForm.note} onChange={(e) => setCompetitorForm({ ...competitorForm, note: e.target.value })} className="sizing-new-input" style={{ flex: "1 1 auto", minWidth: 0 }} placeholder={t("competitiveRelationOptional")} aria-label={tc("competitiveRelation")} />
                      <button type="button" className="btn-ghost btn-sm" disabled={compBusy || !competitorForm.name.trim()} onClick={() => void registerManualCompetitor()}>{tc("register")}</button>
                    </span>
                  </div>
                  {competitorDartResults.length > 0 && (
                    <ul className="sizing-note-list">
                      {competitorDartResults.map((r) => (
                        <li key={r.corp_code}>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setCompetitorForm({ ...competitorForm, name: r.corp_name, dart_corp_code: r.corp_code })}>{t("fillFromThisCompany")}</button>{" "}
                          <strong>{r.corp_name}</strong> <code className="text-[length:var(--fs-caption)]">{r.corp_code}</code>
                          {r.source === "web" && <span className="status-chip status-amber ml-1">{t("candidates")}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>)}

                {/* AI 분석 참고 — payload 원문(제안 원천). 확정 목록과 별개다. */}
                <details className="market-section">
                  <summary className="cursor-pointer text-[length:var(--fs-body)] font-semibold">{t("aiAnalysisReferencePositioningAnd")}</summary>
                  {profile.competitive && !profile.competitive.degraded ? (
                    <>
                      <p className="mt-2 mb-2">{profile.competitive.positioning || "—"}</p>
                      {profile.competitive.competitors.length > 0 && (
                        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                          {t("competitorsProposedInThisAnalysis")} {profile.competitive.competitors.length}{t("itemSDecideWhetherTo")}
                        </p>
                      )}
                    {profile.competitive.crossCheck && (
                      <div className="mt-3">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h4 className="text-[length:var(--fs-body)] font-semibold">{t("filingAndResearchOriginalComparison")}</h4>
                          <span className={`status-chip ${CROSSCHECK_STATUS_META[profile.competitive.crossCheck.status].chip}`}>
                            {tr(CROSSCHECK_STATUS_META[profile.competitive.crossCheck.status].label)}
                          </span>
                        </div>
                        {profile.competitive.crossCheck.dartReport && (
                          <p className="mb-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            {t("sourceDart")} {profile.competitive.crossCheck.dartReport.reportNm} {t("received")} {profile.competitive.crossCheck.dartReport.rceptDt.slice(0, 8)}) —{" "}
                            <a href={profile.competitive.crossCheck.dartReport.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{t("viewOriginal")}</a>
                          </p>
                        )}
                        {profile.competitive.crossCheck.claims.length > 0 ? (
                          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                            <table className="data-table" aria-label={t("competitiveClaimResults")}>
                              <caption className="sr-only">{t("competitiveClaimResults2")}</caption>
                              <thead>
                                <tr><th scope="col" className="col-label w-[34%]">{tc("items")}</th><th scope="col" className="w-[7rem]">{tc("judgement")}</th><th scope="col" className="col-text">{tc("evidence")}</th></tr>
                              </thead>
                              <tbody>
                                {profile.competitive.crossCheck.claims.map((cl, i) => (
                                  <tr key={i}>
                                    <td className="col-label font-semibold">{cl.claim}</td>
                                    <td>
                                      <span className={`status-chip ${CROSSCHECK_VERDICT_META[cl.verdict].chip}`}>{tr(CROSSCHECK_VERDICT_META[cl.verdict].label)}</span>
                                      <span className="ml-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{cl.source}</span>
                                    </td>
                                    <td className="col-text text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                      {cl.evidence}
                                      {cl.url && <> — <a href={cl.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{tc("source")}</a></>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{profile.competitive.crossCheck.note ?? t("noComparisonResults")}</p>
                        )}
                        {profile.competitive.crossCheck.note && profile.competitive.crossCheck.claims.length > 0 && (
                          <p className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("notes")} {profile.competitive.crossCheck.note}</p>
                        )}
                      </div>
                    )}
                    <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      {profile.competitive.crossCheck
                        ? profile.competitive.crossCheck.status === "cross_checked"
                          ? t("filingAndResearchOriginalComparison2")
                          : t("aiEstimateFromWebResearch")
                        : t("aiEstimateFromWebResearch2")}
                    </p>
                  </>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
                    {profile.competitive?.degraded ?? t("noCompetitivePositioningDataGenerated")}
                  </p>
                )}
                </details>
              </div>
            )}</>
  );
}
