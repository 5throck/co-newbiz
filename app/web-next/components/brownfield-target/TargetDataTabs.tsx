"use client";

// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { useLocale, useTranslations } from "next-intl";
import { EChart } from "../EChart.tsx";
import { formatNumber } from "../../lib/format.ts";
import type { TargetDetailViewState } from "./useTargetActions.ts";

export function TargetFinancialsTab({ ctx }: { ctx: TargetDetailViewState }) {
  const t = useTranslations("components.brownfieldTarget.dataTabs");
  const tf = useTranslations("format");
  const tc = useTranslations("common");
  const locale = useLocale();
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
              // 연도별 작성 기준(연결/개별) 표기 — items[].fsDiv가 정본 (design 2026-11-04 §2.5).
              // 구형 페이로드(fsDiv 없음)는 표기 없는 연도 헤더로 자연 강등된다.
              const fsDivByYear = new Map(
                items.filter((i) => i.year && i.fsDiv).map((i) => [i.year as string, i.fsDiv as "CFS" | "BFS"]),
              );
              const yearLabel = (y: string) => {
                const d = fsDivByYear.get(y);
                return d === "BFS" ? `${y} (${t("separate")})` : d === "CFS" ? `${y} (${t("consolidated")})` : y;
              };
              const fmtEok = (v: number) => formatNumber(v / 1e8, locale, { maximumFractionDigits: 0 });
              const chartOption = {
                tooltip: { trigger: "axis" as const },
                legend: { top: 0, textStyle: { color: ct.muted, fontSize: 11 } },
                grid: { left: 60, right: 16, top: 32, bottom: 28 },
                xAxis: { type: "category" as const, data: accounts, axisLabel: { color: ct.muted, fontSize: 11, interval: 0, rotate: accounts.length > 6 ? 20 : 0 } },
                yAxis: { type: "value" as const, axisLabel: { color: ct.muted, formatter: (v: number) => `${fmtEok(v)}${tf("eokUnit")}` }, splitLine: { lineStyle: { color: ct.split } } },
                series: years.map((y, i) => ({
                  name: yearLabel(y),
                  type: "bar" as const,
                  data: accounts.map((a) => byKey.get(`${y}|${a}`) ?? null),
                  itemStyle: { color: ct.color[i % ct.color.length], borderRadius: [4, 4, 0, 0] as [number, number, number, number] },
                })),
              };
              return (
                <div className="card mb-3">
                  <h4 className="text-[length:var(--fs-body)] mb-2">{t("dartFinancialsHeading", { p1: String(companyProfile.profile.dartFinancials!.year) })}</h4>
                  <EChart option={chartOption} height={300} ariaLabel={t("dartChartAria")} />
                  <p className="mt-1 mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("dartUnitNote")}</p>
                  <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                    <table className="data-table report-table" aria-label={t("dartTableAria")}>
                      <caption className="sr-only">{t("dartTableCaption")}</caption>
                      <thead>
                        <tr><th scope="col" className="col-label">{t("colAccount")}</th>{years.map((y) => <th key={y} scope="col" className="col-num">{yearLabel(y)}</th>)}</tr>
                      </thead>
                      <tbody>
                        {accounts.map((a) => (
                          <tr key={a}>
                            <td className="col-label font-semibold">{a}</td>
                            {years.map((y) => {
                              const v = byKey.get(`${y}|${a}`);
                              return <td key={y} className="col-num tabular-nums">{v !== undefined ? `${fmtEok(v)} ${tf("eokWonUnit")}` : "—"}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {companyProfile.profile.dartFinancials?.fsDiv === "mixed" && (
                    <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("mixedSourceNote")}</p>
                  )}
                </div>
              );
            })()}
            {!companyProfile?.profile?.dartFinancials?.available && (
              <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("dartDetailPre")} <button type="button" className="text-[color:var(--accent)] underline" onClick={() => setProfileTab("aiprofile")}>{t("aiProfileTabLink")}</button>{t("dartDetailPost")}
              </p>
            )}
          </div>
        )}</>
  );
}

export function TargetDisclosuresTab({ ctx }: { ctx: TargetDetailViewState }) {
  const t = useTranslations("components.brownfieldTarget.dataTabs");
  const tc = useTranslations("common");
  const { profileTab, dartCode, companyId, discPreset, setDiscPreset, disclosures } = ctx;
  const presetLabel = (label: string): string => (label === "presetRecent" ? t("presetRecent") : label === "presetBusiness" ? t("presetBusiness") : label);
  return (
    <>{profileTab === "disclosures" && (
          <div className="card mt-3">
            {!dartCode || !companyId ? (
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("noDartCode")}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <label className="text-[length:var(--fs-caption)] flex items-center gap-1">
                    {t("disclosureLabel")}
                    <select value={discPreset} onChange={(e) => setDiscPreset(e.target.value)} className="sizing-new-input sizing-new-input-sm" aria-label={t("presetAria")}>
                      {(disclosures?.presets ?? [{ key: "recent", label: "presetRecent" }, { key: "business", label: "presetBusiness" }]).map((pr) => (
                        <option key={pr.key} value={pr.key}>{presetLabel(pr.label)}</option>
                      ))}
                    </select>
                  </label>
                  {disclosures === undefined && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("querying")}</span>}
                </div>
                {disclosures === undefined ? null : disclosures === null ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("disclosuresLoadFailed")}</p>
                ) : disclosures.error ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{disclosures.error}</p>
                ) : disclosures.disclosures.length === 0 ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noDisclosures")}</p>
                ) : (
                  <ul className="sizing-note-list mb-0" style={{ maxHeight: "16rem", overflowY: "auto", fontSize: "0.88rem" }}>
                    {disclosures.disclosures.map((d) => (
                      <li key={d.rcept_no} className="flex flex-wrap items-center gap-2">
                        <code className="dd-item-id">{d.rcept_dt}</code>
                        <span className="flex-1 min-w-[16rem]">{d.report_nm}</span>
                        {d.viewer_url && (
                          <a href={d.viewer_url} target="_blank" rel="noreferrer" className="text-[length:var(--fs-body)] text-[color:var(--accent)] underline">{t("openReport")}</a>
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
  const t = useTranslations("components.brownfieldTarget.dataTabs");
  const tc = useTranslations("common");
  const { profileTab, companyId, companyProfile } = ctx;
  return (
    <>{profileTab === "sources" && (
          <div className="card mt-3">
            <h4 className="text-[length:var(--fs-body)] mb-2">{t("sourcesHeading")}</h4>
            {!companyId ? (
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noCompany")}</p>
            ) : companyProfile === undefined ? (
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("loading")}</p>
            ) : !companyProfile?.profile ? (
              <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("runAnalysisFirst")}</p>
            ) : (
              <>
                <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  DART {companyProfile.profile.dataSources?.dart ? t("dartSourceObtained", { p1: companyProfile.profile.dataSources.dartYear ?? "—" }) : t("dartSourceMissing")} ·
                  {" "}{t("webResearchCount", { p1: companyProfile.profile.dataSources?.webResearchCount ?? 0 })}
                </p>
                {companyProfile.profile.dartFinancials?.available && (
                  <p className="mb-2 text-[length:var(--fs-body)]">
                    <span className="status-chip status-green mr-1">DART</span>
                    {t("dartReportLabel", { p1: String(companyProfile.profile.dartFinancials.year) })}
                    {companyProfile.profile.dartFinancials.reportUrl && (
                      <> — <a href={companyProfile.profile.dartFinancials.reportUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{t("viewOriginal")}</a></>
                    )}
                  </p>
                )}
                {companyProfile.profile.researchSources.length === 0 ? (
                  <p className="mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noWebSources")}</p>
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
