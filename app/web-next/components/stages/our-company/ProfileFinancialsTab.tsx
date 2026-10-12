"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { EChartsCore } from "./constants.ts";
import { ColGroup } from "../../ui.tsx";

// 재무 비율 (연도별) 6열 — 연도 + 수치 지표 5열, 균등 배분.
const RATIOS_COL_PCT = [20, 16, 16, 16, 16, 16] as const;
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";

export function ProfileFinancialsTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const { profileTab, ct } = ctx;
  return (
    <>{profileTab === "financials" && (
              <div className="text-[0.88rem]">
                <h3 className="sizing-step-title text-[0.95rem]">재무 현황 {profile.dartFinancials?.available ? `(DART ${profile.dartFinancials.year ?? ""}년)` : "(DART 미입수)"}</h3>
                {profile.dartFinancials?.available && profile.dartFinancials.items ? (() => {
                  const items = profile.dartFinancials.items;
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
                      itemStyle: { color: ct.color[i % ct.color.length], borderRadius: [4, 4, 0, 0] },
                    })),
                  };
                  return (
                    <>
                      <div className="report-chart-card">
                        <EChartsCore option={chartOption} style={{ height: 300 }} />
                        <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">단위: 억원 · 출처: DART 사업보고서</p>
                      </div>
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
                      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">출처: <span className="status-chip status-green">DART</span> 전자공시 사업보고서{profile.dartFinancials?.reportUrl ? <> — <a href={profile.dartFinancials.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문 보기</a></> : null}</p>
                    </>
                  );
                })() : (
                  <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">{profile.dartFinancials?.error ?? "재무 데이터 없음"}</p>
                )}
                {profile.financialAnalysis && (
                  profile.financialAnalysis.available ? (
                    <>
                      <h3 className="sizing-step-title text-[0.95rem] mt-4">재무 비율·추세 (결정론 산출)</h3>
                      <div className="report-chart-card">
                        <EChartsCore
                          option={{
                            tooltip: { trigger: "axis" as const },
                            legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                            grid: { left: 60, right: 16, top: 32, bottom: 28 },
                            xAxis: { type: "category" as const, data: profile.financialAnalysis.years, axisLabel: { color: ct.muted, fontSize: 11 } },
                            yAxis: { type: "value" as const, axisLabel: { color: ct.muted, formatter: (v: number) => `${v}억` }, splitLine: { lineStyle: { color: ct.split } } },
                            series: profile.financialAnalysis.series.map((s, i) => ({
                              name: s.label,
                              type: "line" as const,
                              data: s.points.map((p) => p.value),
                              connectNulls: false,
                              itemStyle: { color: ct.color[i % ct.color.length] },
                            })),
                          }}
                          style={{ height: 280 }}
                        />
                      </div>
                      <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                        <table className="data-table table-fixed-pct tmin-40 mt-3" aria-label="재무 비율 (연도별)">
                          <caption className="sr-only">재무 비율 (연도별)</caption>
                          <ColGroup widths={RATIOS_COL_PCT} />
                          <thead>
                            <tr>
                              <th scope="col" className="col-label">연도</th>
                              <th scope="col" className="col-num">매출 증감률</th>
                              <th scope="col" className="col-num">영업이익률</th>
                              <th scope="col" className="col-num">순이익률</th>
                              <th scope="col" className="col-num">부채비율</th>
                              <th scope="col" className="col-num">ROE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profile.financialAnalysis.ratios.map((r) => {
                              const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
                              return (
                                <tr key={r.year}>
                                  <td className="col-label font-semibold tabular-nums">{r.year}</td>
                                  <td className="col-num tabular-nums">{pct(r.revenueGrowth)}</td>
                                  <td className="col-num tabular-nums">{pct(r.operatingMargin)}</td>
                                  <td className="col-num tabular-nums">{pct(r.netMargin)}</td>
                                  <td className="col-num tabular-nums">{pct(r.debtRatio)}</td>
                                  <td className="col-num tabular-nums">{pct(r.roe)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mt-3">재무 비율 분석 불가 — {profile.financialAnalysis.notes.join(" ") || "데이터 부족"}</p>
                  )
                )}
                {profile.financialAnalysis && profile.financialAnalysis.missingAccounts.length > 0 && (
                  <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">미수집 계정: {profile.financialAnalysis.missingAccounts.join(", ")}</p>
                )}
              </div>
            )}</>
  );
}
