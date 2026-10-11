"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { CROSSCHECK_VERDICT_META, CROSSCHECK_STATUS_META } from "./constants.ts";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";

export function ProfileCompetitiveTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const { profileTab, compError, competitors, editingCompetitor, excludingCompetitor, setEditingCompetitor, compBusy, setExcludingCompetitor, canAct, webBusy, competitorProposals, dismissedProposals, setDismissedProposals, webSuggestions, webNote, setWebSuggestions, competitorForm, setCompetitorForm, competitorDartSearching, competitorDartResults, saveCompetitorEdit, saveCompetitorExclude, restoreCompetitorRow, runCompetitorWebSearch, acceptProposal, acceptWebSuggestion, searchCompetitorDart, registerManualCompetitor } = ctx;
  return (
    <>{profileTab === "competitive" && (
              <div className="text-[0.88rem]">
                <h3 className="sizing-step-title text-[0.95rem]">경쟁 포지셔닝</h3>
                {compError && <p role="alert" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">{compError}</p>}

                {/* ① 확정 경쟁사 — 사람의 수용·등록으로만 생긴 레지스트리(ADR-0142) */}
                <div className="market-section mb-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h4 className="text-[0.9rem] font-semibold m-0">확정 경쟁사</h4>
                    <span className="status-chip status-green">{(competitors ?? []).filter((c) => c.status === "confirmed").length}건</span>
                  </div>
                  {(competitors ?? []).filter((c) => c.status === "confirmed").length === 0 ? (
                    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                      아직 확정된 경쟁사가 없습니다 — 아래 AI 추천을 수용하거나 직접 등록하세요.
                    </p>
                  ) : (
                    <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                      <table className="data-table report-table" aria-label="확정 경쟁사">
                        <caption className="sr-only">확정 경쟁사</caption>
                        <thead>
                          <tr>
                            <th scope="col" className="col-label">경쟁사</th>
                            <th scope="col" className="w-[7rem]">DART 고유번호</th>
                            <th scope="col" className="col-text">경쟁 관계</th>
                            <th scope="col" className="w-[7rem]">출처</th>
                            <th scope="col" className="w-[6.5rem]">대조</th>
                            <th scope="col" className="w-[10rem]">관리</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(competitors ?? []).filter((c) => c.status === "confirmed").map((c) => {
                            const meta = c.crosscheck_verdict ? CROSSCHECK_VERDICT_META[c.crosscheck_verdict as keyof typeof CROSSCHECK_VERDICT_META] : null;
                            const editing = editingCompetitor?.id === c.id;
                            const excluding = excludingCompetitor?.id === c.id;
                            return (
                              <tr key={c.id}>
                                <td className="col-label font-semibold">{c.name}</td>
                                <td className="text-[length:var(--fs-caption)] tabular-nums">
                                  {editing ? <input value={editingCompetitor.dart} onChange={(e) => setEditingCompetitor({ ...editingCompetitor, dart: e.target.value })} className="sizing-new-input" style={{ width: "7rem" }} placeholder="고유번호" /> : (c.dart_corp_code || "—")}
                                </td>
                                <td className="col-text text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                  {editing ? <input value={editingCompetitor.note} onChange={(e) => setEditingCompetitor({ ...editingCompetitor, note: e.target.value })} className="sizing-new-input" style={{ width: "100%" }} placeholder="경쟁 관계" /> : (c.note || "—")}
                                </td>
                                <td>{c.discovery_source === "ai_proposal" ? <span className="status-chip status-in-progress">AI 추천 수용</span> : <span className="status-chip status-not-started">수작업</span>}</td>
                                <td>{meta ? <span className={`status-chip ${meta.chip}`} title={String(c.crosscheck_verdict)}>{meta.label}</span> : <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">—</span>}</td>
                                <td>
                                  {editing ? (
                                    <span className="actions-row">
                                      <button type="button" className="btn-ghost btn-sm" disabled={compBusy} onClick={() => void saveCompetitorEdit()}>저장</button>
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingCompetitor(null)}>취소</button>
                                    </span>
                                  ) : excluding ? (
                                    <span className="actions-row">
                                      <input value={excludingCompetitor.reason} onChange={(e) => setExcludingCompetitor({ ...excludingCompetitor, reason: e.target.value })} className="sizing-new-input" style={{ width: "8rem" }} placeholder="제외 사유 *" />
                                      <button type="button" className="btn-danger btn-sm" disabled={compBusy || !excludingCompetitor.reason.trim()} onClick={() => void saveCompetitorExclude()}>확인</button>
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setExcludingCompetitor(null)}>취소</button>
                                    </span>
                                  ) : !canAct ? null : (
                                    <span className="actions-row">
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingCompetitor({ id: c.id, note: c.note ?? "", dart: c.dart_corp_code ?? "" })}>수정</button>
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setExcludingCompetitor({ id: c.id, reason: "" })}>제외</button>
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
                      <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">제외된 경쟁사 {(competitors ?? []).filter((c) => c.status === "excluded").length}건</summary>
                      <ul className="sizing-note-list mt-1">
                        {(competitors ?? []).filter((c) => c.status === "excluded").map((c) => (
                          <li key={c.id}>
                            {c.name} — {c.exclusion_reason ?? "사유 없음"}{" "}
                            {canAct && <button type="button" className="btn-ghost btn-sm" disabled={compBusy} onClick={() => void restoreCompetitorRow(c.id)}>복원</button>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                {/* ② AI 추천 — 최신 프로필 분석의 경쟁사 후보. 수용은 사람(경계 #2) */}
                <div className="market-section mb-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h4 className="text-[0.9rem] font-semibold m-0">AI 추천</h4>
                    <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">최신 프로필 분석 기준 — 제안 전용, 수용은 사람</span>
                    {canAct && (
                    <button type="button" className="btn-ghost btn-sm" disabled={webBusy} onClick={() => void runCompetitorWebSearch()}>
                      {webBusy ? "웹검색 중..." : "웹검색 재제안"}
                    </button>
                    )}
                  </div>
                  {(competitorProposals ?? []).filter((p) => !p.accepted && !dismissedProposals.includes(p.name)).length === 0 ? (
                    <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
                      새로운 제안이 없습니다 — 프로필을 재분석하면 최신 리서치 기반 후보가 제안됩니다.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {(competitorProposals ?? []).filter((p) => !p.accepted && !dismissedProposals.includes(p.name)).map((p) => {
                        const meta = p.verdict ? CROSSCHECK_VERDICT_META[p.verdict as keyof typeof CROSSCHECK_VERDICT_META] : null;
                        return (
                          <div key={p.name} className="sizing-grade-card mb-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <strong className="text-[0.88rem]">{p.name}</strong>
                              {meta && <span className={`status-chip ${meta.chip}`} title="공시·리서치 원문 대조 판정 (제안 시점)">{meta.label}</span>}
                              <span className="status-chip status-not-started" title="이 제안은 확정 기록이 아니며, 수용 버튼으로만 등록됩니다">제안</span>
                            </div>
                            <p className="mb-1 text-[length:var(--fs-caption)]">{p.note || "—"}</p>
                            {p.evidence.length > 0 && (
                              <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                근거:{" "}
                                {p.evidence.map((e, i) => (
                                  <span key={i}>{i > 0 && " · "}<a href={e.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{e.title || "출처"}</a></span>
                                ))}
                              </p>
                            )}
                            {canAct && (<div className="flex flex-wrap gap-2">
                              <button type="button" className="btn-ghost btn-sm" disabled={compBusy} onClick={() => void acceptProposal(p.name)}>수용</button>
                              <button type="button" className="btn-ghost btn-sm" onClick={() => setDismissedProposals((prev) => [...prev, p.name])}>무시</button>
                            </div>)}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {webSuggestions && webSuggestions.length > 0 && (
                    <div className="grid gap-2 mt-2">
                      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">{webNote ?? "웹검색 기반 추가 제안"}</p>
                      {webSuggestions.map((ws) => (
                        <div key={ws.name} className="sizing-grade-card mb-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <strong className="text-[0.88rem]">{ws.name}</strong>
                            <span className={`status-chip ${ws.reliability === "B" ? "status-in-progress" : "status-amber"}`} title="웹검색 근거 기반 제안 — 수용 전 출처를 확인하세요">
                              {ws.reliability === "B" ? "제안 · 웹검색 근거" : "제안 · 미검증"}
                            </span>
                          </div>
                          <p className="mb-1 text-[length:var(--fs-caption)]">{ws.note || "—"}</p>
                          {ws.sources.length > 0 && (
                            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                              근거:{" "}
                              {ws.sources.map((e, i) => (
                                <span key={i}>{i > 0 && " · "}<a href={e.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{e.title || "출처"}</a></span>
                              ))}
                            </p>
                          )}
                          {canAct && (<div className="flex flex-wrap gap-2">
                            <button type="button" className="btn-ghost btn-sm" disabled={compBusy} onClick={() => void acceptWebSuggestion(ws)}>수용</button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setWebSuggestions((prev) => (prev ?? []).filter((x) => x.name !== ws.name))}>무시</button>
                          </div>)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ③ 수작업 등록 — 상시 노출 (브라운필드 후보 등록 폼 패턴) */}
                {canAct && (<div className="market-section mb-3">
                  <h4 className="text-[0.9rem] font-semibold mb-2">수작업 등록</h4>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <input value={competitorForm.name} onChange={(e) => setCompetitorForm({ ...competitorForm, name: e.target.value })} className="sizing-new-input" style={{ width: "14rem" }} placeholder="경쟁사명 *" aria-label="경쟁사명" />
                    <button type="button" className="btn-ghost btn-sm" disabled={competitorDartSearching || !competitorForm.name.trim()} onClick={() => void searchCompetitorDart()}>DART 검색</button>
                    <input value={competitorForm.dart_corp_code} onChange={(e) => setCompetitorForm({ ...competitorForm, dart_corp_code: e.target.value })} className="sizing-new-input" style={{ width: "10rem" }} placeholder="DART 고유번호 (선택, 8자리)" aria-label="경쟁사 DART 고유번호" />
                    <input value={competitorForm.note} onChange={(e) => setCompetitorForm({ ...competitorForm, note: e.target.value })} className="sizing-new-input" style={{ flex: "1 1 14rem" }} placeholder="경쟁 관계 (선택)" aria-label="경쟁 관계" />
                    <button type="button" className="btn-ghost btn-sm" disabled={compBusy || !competitorForm.name.trim()} onClick={() => void registerManualCompetitor()}>등록</button>
                  </div>
                  {competitorDartResults.length > 0 && (
                    <ul className="sizing-note-list">
                      {competitorDartResults.map((r) => (
                        <li key={r.corp_code}>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setCompetitorForm({ ...competitorForm, name: r.corp_name, dart_corp_code: r.corp_code })}>이 회사로 채우기</button>{" "}
                          <strong>{r.corp_name}</strong> <code className="text-[length:var(--fs-caption)]">{r.corp_code}</code>
                          {r.source === "web" && <span className="status-chip status-amber ml-1">웹 미검증 후보</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>)}

                {/* AI 분석 참고 — payload 원문(제안 원천). 확정 목록과 별개다. */}
                <details className="market-section">
                  <summary className="cursor-pointer text-[length:var(--fs-body)] font-semibold">AI 분석 참고 — 포지셔닝·공시 대조 원문 (확정 목록과 별개)</summary>
                  {profile.competitive && !profile.competitive.degraded ? (
                    <>
                      <p className="mt-2 mb-2">{profile.competitive.positioning || "—"}</p>
                      {profile.competitive.competitors.length > 0 && (
                        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
                          이 분석에서 제안된 경쟁사 {profile.competitive.competitors.length}건 — 위 "AI 추천"에서 수용 여부를 결정하세요.
                        </p>
                      )}
                    {profile.competitive.crossCheck && (
                      <div className="mt-3">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h4 className="text-[0.9rem] font-semibold">공시·리서치 원문 대조</h4>
                          <span className={`status-chip ${CROSSCHECK_STATUS_META[profile.competitive.crossCheck.status].chip}`}>
                            {CROSSCHECK_STATUS_META[profile.competitive.crossCheck.status].label}
                          </span>
                        </div>
                        {profile.competitive.crossCheck.dartReport && (
                          <p className="mb-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            출처: DART {profile.competitive.crossCheck.dartReport.reportNm} (접수 {profile.competitive.crossCheck.dartReport.rceptDt.slice(0, 8)}) —{" "}
                            <a href={profile.competitive.crossCheck.dartReport.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문 보기</a>
                          </p>
                        )}
                        {profile.competitive.crossCheck.claims.length > 0 ? (
                          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                            <table className="data-table" aria-label="경쟁 주장 대조 결과">
                              <caption className="sr-only">경쟁 주장 대조 결과</caption>
                              <thead>
                                <tr><th scope="col" className="col-label w-[34%]">항목</th><th scope="col" className="w-[7rem]">판정</th><th scope="col" className="col-text">근거</th></tr>
                              </thead>
                              <tbody>
                                {profile.competitive.crossCheck.claims.map((cl, i) => (
                                  <tr key={i}>
                                    <td className="col-label font-semibold">{cl.claim}</td>
                                    <td>
                                      <span className={`status-chip ${CROSSCHECK_VERDICT_META[cl.verdict].chip}`}>{CROSSCHECK_VERDICT_META[cl.verdict].label}</span>
                                      <span className="ml-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{cl.source}</span>
                                    </td>
                                    <td className="col-text text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                                      {cl.evidence}
                                      {cl.url && <> — <a href={cl.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">출처</a></>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{profile.competitive.crossCheck.note ?? "대조 결과가 없습니다."}</p>
                        )}
                        {profile.competitive.crossCheck.note && profile.competitive.crossCheck.claims.length > 0 && (
                          <p className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">비고: {profile.competitive.crossCheck.note}</p>
                        )}
                      </div>
                    )}
                    <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                      {profile.competitive.crossCheck
                        ? profile.competitive.crossCheck.status === "cross_checked"
                          ? "공시·리서치 원문 대조 완료 — 판정은 자동 대조 결과이며 분석가 확인 전까지 참고용입니다."
                          : "웹 리서치 기반 AI 추정 — DART 원문 대조 불가(위 비고 참조)."
                        : "AI 추정 (웹 리서치 발췌 기반) — 공시·리서치 원문 대조 전입니다."}
                    </p>
                  </>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
                    {profile.competitive?.degraded ?? "경쟁 포지셔닝 데이터가 없습니다 — 재분석 시 생성됩니다."}
                  </p>
                )}
                </details>
              </div>
            )}</>
  );
}
