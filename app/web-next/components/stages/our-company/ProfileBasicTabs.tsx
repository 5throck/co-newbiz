"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import Link from "next/link";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";

export function ProfileOverviewTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const { profileTab } = ctx;
  return (
    <>{profileTab === "overview" && (
              <div className="text-[0.88rem]">
                {profile.ragCapRecommendation && (
                  <div className="sizing-grade-card mb-3">
                    <h4 className="text-[0.9rem] mb-2">🚦 신뢰도 상한 권고</h4>
                    <span className={`status-chip ${profile.ragCapRecommendation.grade === "green" ? "status-green" : profile.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}>
                      상한 {profile.ragCapRecommendation.grade.toUpperCase()}
                    </span>
                    <p className="mt-2 mb-0 text-[length:var(--fs-body)]">{profile.ragCapRecommendation.rationale}</p>
                  </div>
                )}
                <h3 className="sizing-step-title text-[0.95rem]">종합 평가</h3>
                <p className="mb-3">{profile.businessAssessment || "—"}</p>
                <h3 className="sizing-step-title text-[0.95rem]">산업 노출</h3>
                {profile.industryExposure && profile.industryExposure.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {profile.industryExposure.map((x) => <span key={x} className="status-chip status-in-progress">{x}</span>)}
                  </div>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-3">산업 노출 정보 없음</p>
                )}
                {!profile.schemaVersion && (
                  <p className="sizing-note-list text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]" role="note">
                    ⚠ 이 프로파일은 확장 분석(SWOT·산업 연계·신뢰도) 적용 이전 버전입니다 — <strong>재분석</strong>을 실행하면 전체 리포트가 생성됩니다.
                  </p>
                )}
              </div>
            )}</>
  );
}

export function ProfileSwotTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const { profileTab } = ctx;
  return (
    <>{profileTab === "swot" && (
              <div className="text-[0.88rem]">
                {profile.swot && (
                  <p className="sizing-note-list mb-2 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]" role="note">
                    ⚠ 기회·위협은 AI 추정 — 분석가 확정 전까지 인용 시 검증 필요 표기를 유지하세요.
                  </p>
                )}
                <div className="chart-pair">
                  <div className="chart-half sizing-grade-card report-bullet-card">
                    <h4>💪 강점</h4>
                    <ul className="report-bullet-list">{(profile.strengths ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                  <div className="chart-half sizing-grade-card report-bullet-card">
                    <h4>🩹 약점</h4>
                    <ul className="report-bullet-list">{(profile.weaknesses ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </div>
                  {profile.swot && (
                    <>
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>🌱 기회</h4>
                        <ul className="report-bullet-list">{(profile.swot.opportunities ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>⛈️ 위협</h4>
                        <ul className="report-bullet-list">{(profile.swot.threats ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                    </>
                  )}
                </div>
                <p className="mt-3 mb-0 text-[0.88rem]"><strong>종합 평가:</strong> {profile.businessAssessment || "—"}</p>
              </div>
            )}</>
  );
}

export function ProfileIndustryTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const { profileTab, s1Requests, canAct, requestS1Analysis } = ctx;
  return (
    <>{profileTab === "industry" && (
              <div className="text-[0.88rem]">
                <h3 className="sizing-step-title text-[0.95rem]">S1 시장분석 연계</h3>
                <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
                  산업 노출 항목을 S1 시장분석 매트릭스와 연결합니다 — 완료된 시장분석이 있으면 앵커·CAGR·외부 전망 격차가 실측 연결됩니다.
                </p>
                {profile.industryLinkage && profile.industryLinkage.length > 0 ? (
                  <div className="table-scroll">
                    <table className="data-table report-table" aria-label="산업 노출 × S1 매트릭스 연계">
                      <caption className="sr-only">산업 노출 × S1 매트릭스 연계</caption>
                      <thead>
                        <tr>
                          <th scope="col">산업</th>
                          <th scope="col" className="col-num">S1 앵커</th>
                          <th scope="col" className="col-num">CAGR</th>
                          <th scope="col" className="col-num">외부 전망 격차</th>
                          <th scope="col" className="w-[11rem]">연결</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.industryLinkage.map((l, i) => {
                          const req = s1Requests[l.industry];
                          return (
                          <tr key={`${l.industry}-${i}`}>
                            <td>{l.industry}</td>
                            <td className="col-num tabular-nums">{l.anchorTotalUsdB != null ? `$${l.anchorTotalUsdB.toFixed(2)}B` : "—"}</td>
                            <td className="col-num tabular-nums">
                              {l.cagr != null ? `${l.cagr.toFixed(1)}%` : "—"}
                              {l.escalatedCagrPct != null && <span className="status-chip status-green ml-1" title="결정론 스케일링 에스컬레이션 적용 — 외부 참조 × 0.85 (사람 결정)">에스컬레이션 {l.escalatedCagrPct}%</span>}
                            </td>
                            <td className="col-num tabular-nums">{l.externalGapPercent != null ? `${l.externalGapPercent > 0 ? "+" : ""}${l.externalGapPercent}%` : "—"}</td>
                            <td className="text-[length:var(--fs-caption)]">
                              {l.matrixFound && l.industryId ? (
                                <Link href={`/market?industry=${encodeURIComponent(l.industryId)}`} className="text-[color:var(--accent)] underline">시장분석 리포트</Link>
                              ) : req?.status === "created" ? (
                                <span className="flex items-center gap-1">
                                  <span className="status-chip status-amber">S1 분석 중</span>
                                  {req.industryId && <Link href={`/market?industry=${encodeURIComponent(req.industryId)}`} className="text-[color:var(--accent)] underline">리포트</Link>}
                                </span>
                              ) : req?.status === "creating" ? (
                                <span className="status-chip status-not-started">요청 중...</span>
                              ) : !canAct ? (
                                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">—</span>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  title="이 산업의 S1 8단계 시장분석을 시작합니다 — 세부 결과는 /market 리포트에서 확인하세요"
                                  onClick={() => void requestS1Analysis(l.industry)}
                                >
                                  S1 분석 요청
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
                    산업 연계 데이터가 없습니다 — 재분석 시 산업 노출이 S1 매트릭스와 자동 연결됩니다.
                  </p>
                )}
                {profile.industryLinkage?.some((l) => l.qualitativeLinks && (l.qualitativeLinks.opportunityFactors.length > 0 || l.qualitativeLinks.riskFactors.length > 0)) && (
                  <div className="chart-pair mt-3">
                    <div className="chart-half sizing-grade-card report-bullet-card">
                      <h4>✅ 연결 산업의 기회 요인</h4>
                      <ul className="report-bullet-list">
                        {profile.industryLinkage.flatMap((l) => l.qualitativeLinks?.opportunityFactors ?? []).slice(0, 6).map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                    <div className="chart-half sizing-grade-card report-bullet-card">
                      <h4>⚠️ 연결 산업의 위험 요인</h4>
                      <ul className="report-bullet-list">
                        {profile.industryLinkage.flatMap((l) => l.qualitativeLinks?.riskFactors ?? []).slice(0, 6).map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}</>
  );
}

export function ProfileSourcesTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const { profileTab } = ctx;
  return (
    <>{profileTab === "sources" && (
              <div className="text-[0.88rem]">
                {(profile.researchSources ?? []).length > 0 ? (
                  <ul className="sizing-note-list mb-3">
                    {profile.researchSources!.map((s, i) => (
                      <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a><span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[color:var(--muted-fg)] italic">출처 기록이 없습니다.</p>
                )}
                {profile.sectionConfidence && profile.sectionConfidence.length > 0 && (
                  <>
                    <h3 className="sizing-step-title text-[0.95rem] mt-3">섹션별 데이터 신뢰도 등급 (A 확정 ~ D 추정 불가)</h3>
                    <table className="data-table" aria-label="섹션별 신뢰도 등급">
                      <caption className="sr-only">섹션별 신뢰도 등급</caption>
                      <thead><tr><th scope="col">섹션</th><th scope="col">등급</th><th scope="col">비고</th></tr></thead>
                      <tbody>
                        {profile.sectionConfidence.map((s, i) => (
                          <tr key={i}>
                            <td className="font-semibold">{s.section}</td>
                            <td>
                              <span className={`status-chip ${s.grade === "A" || s.grade === "B" ? "status-green" : s.grade === "B-" || s.grade === "C" ? "status-amber" : "status-red"}`}>
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
                      🔍 검증 원장 ({profile.verificationLedger.length}건 — 확인/확인불가/판단필요)
                    </summary>
                    <table className="data-table mt-2" aria-label="검증 원장">
                      <caption className="sr-only">주장별 검증 상태</caption>
                      <thead><tr><th scope="col" className="w-[34%]">항목</th><th scope="col">상태</th><th scope="col">근거</th></tr></thead>
                      <tbody>
                        {profile.verificationLedger.map((v, i) => (
                          <tr key={i}>
                            <td className="font-semibold">{v.item}</td>
                            <td>
                              <span className={`status-chip ${v.status === "confirmed" ? "status-green" : v.status === "could_not_verify" ? "status-red" : "status-amber"}`}>
                                {v.status === "confirmed" ? "확인" : v.status === "could_not_verify" ? "확인 불가" : "판단 필요"}
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
            )}</>
  );
}
