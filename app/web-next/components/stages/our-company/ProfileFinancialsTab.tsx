"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { EChartsCore } from "./constants.ts";
import { ColGroup } from "../../ui.tsx";

// 재무 비율 (연도별) 6열 — 연도 + 수치 지표 5열, 균등 배분.
const RATIOS_COL_PCT = [20, 16, 16, 16, 16, 16] as const;
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";
import { useTranslations } from "next-intl";

export function ProfileFinancialsTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {const t = useTranslations("components.ourCompany.profileFinancialsTab"); const tc = useTranslations("common");
  const { profileTab, ct } = ctx;
  return (
    <>{profileTab === "financials" && (
              <div className="text-[length:var(--fs-body)]">
                <h3 className="sizing-step-title text-[length:var(--fs-body)]">{t("financialPosition")} {profile.dartFinancials?.available ? t("dartP1", { p1: profile.dartFinancials.year ?? "" }) : t("dartUnavailable")}</h3>
                {profile.dartFinancials?.available && profile.dartFinancials.items ? (() => {
                  const items = profile.dartFinancials.items;
                  const years = [...new Set(items.map((i) => i.year ?? ""))].filter(Boolean).sort().reverse();
                  const accounts = [...new Set(items.map((i) => i.name))];
                  const byKey = new Map(items.map((i) => [`${i.year}|${i.name}`, i.value]));
                  // 연도별 작성 기준(연결/개별) 표기 — items[].fsDiv가 정본 (design 2026-11-04 §2.5).
                  // 구형 페이로드(fsDiv 없음)는 표기 없는 연도 헤더로 자연 강등된다.
                  const fsDivByYear = new Map(
                    items.filter((i) => i.year && i.fsDiv).map((i) => [i.year as string, i.fsDiv as "CFS" | "BFS"]),
                  );
                  const yearLabel = (y: string) => {
                    const d = fsDivByYear.get(y);
                    return d === "BFS" ? `${y} (${t("separate")})` : d === "CFS" ? `${y} (${t("consolidated")})` : y;
                  };
                  const fmtEok = (v: number) => (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 });
                                    const chartOption = {
                    tooltip: { trigger: "axis" as const },
                    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                    grid: { left: 60, right: 16, top: 32, bottom: 28 },
                    xAxis: { type: "category" as const, data: accounts, axisLabel: { color: ct.muted, fontSize: 11, interval: 0, rotate: accounts.length > 6 ? 20 : 0 } },
                    yAxis: { type: "value" as const, axisLabel: { color: ct.muted, formatter: (v: number) => t("p1HundredMillions", { p1: fmtEok(v) }) }, splitLine: { lineStyle: { color: ct.split } } },
                    series: years.map((y, i) => ({
                      name: yearLabel(y),
                      type: "bar" as const,
                      data: accounts.map((a) => byKey.get(`${y}|${a}`) ?? null),
                      itemStyle: { color: ct.color[i % ct.color.length], borderRadius: [4, 4, 0, 0] },
                    })),
                  };
                  return (
                    <>
                      <div className="report-chart-card">
                        <EChartsCore option={chartOption} style={{ height: 300 }} />
                        <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("unitKrw100MillionsSource")}</p>
                      </div>
                      <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                        <table className="data-table report-table" aria-label={t("dartFinancialSummaryAccountYear")}>
                          <caption className="sr-only">{t("dartFinancialSummaryAccountYear2")}</caption>
                          <thead>
                            <tr><th scope="col" className="col-label">{t("account")}</th>{years.map((y) => <th key={y} scope="col" className="col-num">{yearLabel(y)}</th>)}</tr>
                          </thead>
                          <tbody>
                            {accounts.map((a) => (
                              <tr key={a}>
                                <td className="col-label font-semibold">{a}</td>
                                {years.map((y) => {
                                  const v = byKey.get(`${y}|${a}`);
                                  return <td key={y} className="col-num tabular-nums">{v !== undefined ? t("p1HundredMillionKrw", { p1: fmtEok(v) }) : "—"}</td>;
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {profile.dartFinancials?.fsDiv === "mixed" && (
                        <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("mixedSourceNote")}</p>
                      )}
                      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("source")} <span className="status-chip status-green">DART</span> {t("regulatoryFilingAnnualReport")}{profile.dartFinancials?.reportUrl ? <> — <a href={profile.dartFinancials.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{t("viewOriginal")}</a></> : null}</p>
                    </>
                  );
                })() : (
                  <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">{profile.dartFinancials?.error ?? t("noFinancialData")}</p>
                )}
                {profile.financialAnalysis && (
                  profile.financialAnalysis.available ? (
                    <>
                      <h3 className="sizing-step-title text-[length:var(--fs-body)] mt-4">{t("financialRatiosAndTrendsDeterministic")}</h3>
                      <div className="report-chart-card">
                        <EChartsCore
                          option={{
                            tooltip: { trigger: "axis" as const },
                            legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                            grid: { left: 60, right: 16, top: 32, bottom: 28 },
                            xAxis: { type: "category" as const, data: profile.financialAnalysis.years, axisLabel: { color: ct.muted, fontSize: 11 } },
                            yAxis: { type: "value" as const, axisLabel: { color: ct.muted, formatter: (v: number) => t("p1HundredMillions2", { p1: v }) }, splitLine: { lineStyle: { color: ct.split } } },
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
                      <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                        <table className="data-table table-fixed-pct tmin-40 mt-3" aria-label={t("financialRatiosByYear")}>
                          <caption className="sr-only">{t("financialRatiosByYear2")}</caption>
                          <ColGroup widths={RATIOS_COL_PCT} />
                          <thead>
                            <tr>
                              <th scope="col" className="col-label">{t("year")}</th>
                              <th scope="col" className="col-num">{t("revenueChangeRate")}</th>
                              <th scope="col" className="col-num">{t("operatingMargin")}</th>
                              <th scope="col" className="col-num">{t("netMargin")}</th>
                              <th scope="col" className="col-num">{t("debtRatio")}</th>
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
                    <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mt-3">{t("financialRatioAnalysisUnavailable")} {profile.financialAnalysis.notes.join(" ") || t("insufficientData")}</p>
                  )
                )}
                {profile.financialAnalysis && profile.financialAnalysis.missingAccounts.length > 0 && (
                  <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("accountsNotCollected")} {profile.financialAnalysis.missingAccounts.join(", ")}</p>
                )}
              </div>
            )}</>
  );
}
