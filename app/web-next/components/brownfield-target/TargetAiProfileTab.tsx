"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { renderWithCitations } from "./renderWithCitations.tsx";
import { CompetitorRegistryBlock } from "./CompetitorRegistryBlock.tsx";
import { DegradedChip } from "../stages/our-company/ProfileChips.tsx";
import type { TargetDetailViewState } from "./useTargetActions.ts";
import type { TargetDetail } from "./types.ts";

export function TargetAiProfileTab({ ctx, t }: { ctx: TargetDetailViewState; t: TargetDetail }) {
  const { profileTab, companyId, companyProfile, setProfileTab } = ctx;
  return (
    <>{profileTab === "aiprofile" && (
          <div className="mt-3">
            {!companyId ? (
              <div className="card"><p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">회사 마스터가 아직 연결되지 않았습니다 — 후보 등록/수정 시 회사명이 확정되면 연결됩니다.</p></div>
            ) : companyProfile === undefined ? (
              <div className="card"><p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">불러오는 중...</p></div>
            ) : companyProfile === null ? (
              <div className="card"><p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">AI 분석 상태를 불러오지 못했습니다.</p></div>
            ) : (
              <>
                {/* 헤더 — 회사명·배지만 표시. 분석 실행/재분석 버튼은 탭 목록과
                    같은 줄 오른쪽으로 이동했다(사용자 요청, 2026-09-15). */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h2 className="text-[0.95rem] !mb-0">🏢 {companyProfile.profile?.companyName ?? t.company_name} 강·약점 SWOT</h2>
                  {companyProfile.profile?.dataSources?.dart && <span className="status-chip status-green">DART {companyProfile.profile.dataSources.dartYear ?? ""}</span>}
                  {(companyProfile.profile?.dataSources?.webResearchCount ?? 0) > 0 && (
                    <span className="status-chip status-in-progress">외부 리서치 {companyProfile.profile!.dataSources.webResearchCount}건</span>
                  )}
                  {companyProfile.profile?.degraded && <DegradedChip degraded={companyProfile.profile.degraded} showHint />}
                </div>

                {companyProfile.status === "in_progress" ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">전자공시·웹 리서치·AI 분석 진행 중 — 완료되면 자동으로 갱신됩니다.</p>
                ) : companyProfile.status === "failed" ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">분석 실패 — {companyProfile.error ?? "사유 없음"}</p>
                ) : companyProfile.status === "not_started" || !companyProfile.profile ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">아직 분석된 프로파일이 없습니다 — "AI 분석 실행"으로 강점·약점·산업 노출·경쟁 포지셔닝을 생성하세요.</p>
                ) : (
                  <div className="text-[0.88rem]">
                    {companyProfile.profile.swot && (
                      <p className="sizing-note-list mb-2 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]" role="note">
                        ⚠ 기회·위협은 AI 추정 — 분석가 확정 전까지 인용 시 검증 필요 표기를 유지하세요.
                      </p>
                    )}
                    <div className="chart-pair">
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>💪 강점</h4>
                        <ul className="report-bullet-list">{companyProfile.profile.strengths.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [])}</li>)}</ul>
                      </div>
                      <div className="chart-half sizing-grade-card report-bullet-card">
                        <h4>🩹 약점</h4>
                        <ul className="report-bullet-list">{companyProfile.profile.weaknesses.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [])}</li>)}</ul>
                      </div>
                      {companyProfile.profile.swot && (
                        <>
                          <div className="chart-half sizing-grade-card report-bullet-card">
                            <h4>🌱 기회</h4>
                            <ul className="report-bullet-list">{companyProfile.profile.swot.opportunities.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [])}</li>)}</ul>
                          </div>
                          <div className="chart-half sizing-grade-card report-bullet-card">
                            <h4>⛈️ 위협</h4>
                            <ul className="report-bullet-list">{companyProfile.profile.swot.threats.map((x, i) => <li key={i}>{renderWithCitations(x, companyProfile.profile?.researchSources ?? [])}</li>)}</ul>
                          </div>
                        </>
                      )}
                    </div>
                    <p className="mt-3 mb-0 text-[0.88rem]">
                      <strong>종합 평가:</strong>{" "}
                      {companyProfile.profile.businessAssessment
                        ? renderWithCitations(companyProfile.profile.businessAssessment, companyProfile.profile?.researchSources ?? [])
                        : "—"}
                    </p>

                    {companyProfile.profile.competitive && !companyProfile.profile.competitive.degraded && (
                      <>
                        <h3 className="sizing-step-title text-[0.95rem] mt-3">경쟁 포지셔닝</h3>
                        <p className="mb-2">{renderWithCitations(companyProfile.profile.competitive.positioning || "—", companyProfile.profile?.researchSources ?? [])}</p>
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
                          본 분석에 사용된 외부 리서치 {companyProfile.profile.researchSources.length}건 — 위 <span className="text-[color:var(--accent)]">[n]</span> 표시가 아래 출처로 연결됩니다. 전체 목록은{" "}
                          <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setProfileTab("sources")}>출처 탭</button>에서.
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
