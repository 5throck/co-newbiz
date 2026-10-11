"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { EChart } from "../EChart.tsx";
import type { TargetDetailViewState } from "./useTargetActions.ts";

export function TargetFinancialsTab({ ctx }: { ctx: TargetDetailViewState }) {
  const { profileTab, companyProfile, ct, setProfileTab } = ctx;
  return (
    <>{profileTab === "financials" && (
          <div className="mt-3">
            {/* DART 원계정 현황 — AI 분석(1단계)에서 입수된 전 계정 × 연도 데이터를
                그래프·표로 보여준다(그룹/계열사 화면 재무 탭과 동일 구성, 사용자
                요청 2026-09-15 — "세부항목 분석을 보면 추가적인 정보를 더 확보하고
                그래프화가 되어야 할 듯"). AI 분석을 아직 실행하지 않았다면 아래
                요약(fact_financial 동기화 기반)만 보인다. */}
            {companyProfile?.profile?.dartFinancials?.available && companyProfile.profile.dartFinancials.items && (() => {
              const items = companyProfile.profile.dartFinancials.items!;
              const years = [...new Set(items.map((i) => i.year ?? ""))].filter(Boolean).sort().reverse();
              const accounts = [...new Set(items.map((i) => i.name))];
              const byKey = new Map(items.map((i) => [`${i.year}|${i.name}`, i.value]));
              const fmtEok = (v: number) => (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 });
              const chartOption = {
                tooltip: { trigger: "axis" as const },
                legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                grid: { left: 60, right: 16, top: 32, bottom: 28 },
                xAxis: { type: "category" as const, data: accounts, axisLabel: { color: ct.muted, fontSize: 11, interval: 0, rotate: accounts.length > 6 ? 20 : 0 } },
                yAxis: { type: "value" as const, axisLabel: { color: ct.muted, formatter: (v: number) => `${fmtEok(v)}억` }, splitLine: { lineStyle: { color: ct.split } } },
                series: years.map((y, i) => ({
                  name: y,
                  type: "bar" as const,
                  data: accounts.map((a) => byKey.get(`${y}|${a}`) ?? null),
                  itemStyle: { color: ct.color[i % ct.color.length], borderRadius: [4, 4, 0, 0] as [number, number, number, number] },
                })),
              };
              return (
                <div className="card mb-3">
                  <h4 className="text-[0.9rem] mb-2">DART 재무 현황 ({companyProfile.profile.dartFinancials!.year}년)</h4>
                  <EChart option={chartOption} height={300} ariaLabel="DART 재무 현황 — 계정별 연도 비교" />
                  <p className="mt-1 mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">단위: 억원 · 출처: DART 사업보고서</p>
                  <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                    <table className="data-table report-table" aria-label="DART 재무 요약 (계정 × 연도)">
                      <caption className="sr-only">DART 재무 요약 (계정 × 연도)</caption>
                      <thead>
                        <tr><th scope="col" className="col-label">계정</th>{years.map((y) => <th key={y} scope="col" className="col-num">{y}</th>)}</tr>
                      </thead>
                      <tbody>
                        {accounts.map((a) => (
                          <tr key={a}>
                            <td className="col-label font-semibold">{a}</td>
                            {years.map((y) => {
                              const v = byKey.get(`${y}|${a}`);
                              return <td key={y} className="col-num tabular-nums">{v !== undefined ? `${fmtEok(v)} 억원` : "—"}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
            {!companyProfile?.profile?.dartFinancials?.available && (
              <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                계정별 상세 그래프는 AI 분석 실행 후 표시됩니다 — <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setProfileTab("aiprofile")}>AI 분석 탭</button>에서 실행하세요.
              </p>
            )}
          </div>
        )}</>
  );
}

export function TargetDisclosuresTab({ ctx }: { ctx: TargetDetailViewState }) {
  const { profileTab, dartCode, companyId, discPreset, setDiscPreset, disclosures } = ctx;
  return (
    <>{profileTab === "disclosures" && (
          <div className="card mt-3">
            {!dartCode || !companyId ? (
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                DART 고유번호가 없어 공시를 조회할 수 없습니다 — 등록 시 8자리 고유번호를 입력하면 연결됩니다.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <label className="text-[length:var(--fs-caption)] flex items-center gap-1">
                    공시
                    <select value={discPreset} onChange={(e) => setDiscPreset(e.target.value)} className="sizing-new-input sizing-new-input-sm" aria-label="공시 프리셋">
                      {(disclosures?.presets ?? [{ key: "recent", label: "최근 공시" }, { key: "business", label: "사업보고서" }]).map((pr) => (
                        <option key={pr.key} value={pr.key}>{pr.label}</option>
                      ))}
                    </select>
                  </label>
                  {disclosures === undefined && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">조회 중...</span>}
                </div>
                {disclosures === undefined ? null : disclosures === null ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">공시 목록을 불러오지 못했습니다.</p>
                ) : disclosures.error ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{disclosures.error}</p>
                ) : disclosures.disclosures.length === 0 ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">해당 프리셋의 공시가 최근 12개월 내 없습니다.</p>
                ) : (
                  <ul className="sizing-note-list mb-0" style={{ maxHeight: "16rem", overflowY: "auto", fontSize: "0.88rem" }}>
                    {disclosures.disclosures.map((d) => (
                      <li key={d.rcept_no} className="flex flex-wrap items-center gap-2">
                        <code className="dd-item-id">{d.rcept_dt}</code>
                        <span className="flex-1 min-w-[16rem]">{d.report_nm}</span>
                        {d.viewer_url && (
                          <a href={d.viewer_url} target="_blank" rel="noreferrer" className="text-[0.88rem] text-[color:var(--accent)] underline">보고서 열기</a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}</>
  );
}

export function TargetSourcesTab({ ctx }: { ctx: TargetDetailViewState }) {
  const { profileTab, companyId, companyProfile } = ctx;
  return (
    <>{profileTab === "sources" && (
          <div className="card mt-3">
            <h4 className="text-[0.9rem] mb-2">출처 · 데이터</h4>
            {!companyId ? (
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">회사 마스터가 아직 연결되지 않았습니다.</p>
            ) : companyProfile === undefined ? (
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">불러오는 중...</p>
            ) : !companyProfile?.profile ? (
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">AI 분석을 먼저 실행하면 리서치 출처가 여기에 표시됩니다.</p>
            ) : (
              <>
                <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  DART {companyProfile.profile.dataSources?.dart ? `공시(${companyProfile.profile.dataSources.dartYear ?? "—"}년)` : "미입수"} ·
                  {" "}외부 웹 리서치 {companyProfile.profile.dataSources?.webResearchCount ?? 0}건
                </p>
                {companyProfile.profile.dartFinancials?.available && (
                  <p className="mb-2 text-[0.88rem]">
                    <span className="status-chip status-green mr-1">DART</span>
                    전자공시 사업보고서 ({companyProfile.profile.dartFinancials.year}년)
                    {companyProfile.profile.dartFinancials.reportUrl && (
                      <> — <a href={companyProfile.profile.dartFinancials.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문 보기</a></>
                    )}
                  </p>
                )}
                {companyProfile.profile.researchSources.length === 0 ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">웹 리서치 출처가 없습니다.</p>
                ) : (
                  <ul className="sizing-note-list mb-0" style={{ fontSize: "0.88rem" }}>
                    {companyProfile.profile.researchSources.map((s, i) => (
                      <li key={i}>
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a>
                        {s.snippet && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{s.snippet}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}</>
  );
}
