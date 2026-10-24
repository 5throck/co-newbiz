"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import Link from "next/link";
import { SectionToolbar } from "../../layout.tsx";
import { ColGroup } from "../../ui.tsx";

// 분석 대상 회사 목록 표 열 비율(2026-10-11-table-column-sizing-system batch 2) —
// 연결 기회·분석 상태(칩 텍스트가 길다)에 폭을 주고 구분·분석일·작업은 좁게.
const SYNERGY_COL_PCT = [16, 22, 10, 28, 10, 14] as const;
import { profileHrefFor } from "./synergyFormat.ts";
import { analysisGroupKey, targetLabel } from "./synergyFormat.ts";
import type { SynergyStageState } from "./useSynergyList.ts";
import type { SynergyAnalysis } from "./types.ts";
import { useTranslations } from "next-intl";

export function SynergyListSection({ ctx }: { ctx: SynergyStageState }) {const tr = useTranslations(); const t = useTranslations("stages.s3.synergyListSection"); const tc = useTranslations("common");
  const { analyses, canCurate, setShowNewForm, showNewForm, selectedId, openDetail, rerun, removeAnalysis, hasInProgress, opportunityId, dealScoped, scope, setScope, setOppSel, opps } = ctx;
  // A project id (or unknown id) is not an opportunity: no analysis can be linked to it.
  const oppKnown = !!opportunityId && opps.some((o) => o.id === opportunityId);
  const startDisabledReason = !canCurate
    ? t("synergyAnalysisRequiresTheAnalyst")
    : !opportunityId || (opps.length > 0 && !oppKnown)
      ? t("noOriginatingOpportunityLinkedTo")
      : null;
  const dealEmpty = dealScoped && scope === "deal" && analyses !== null && analyses.length === 0;
  return (
    <section aria-label={t("companiesInAnalysisScope")} className="market-section">
        <SectionToolbar
          title={t("synergyAnalysisList")}
          icon=""
          count={analyses?.length ?? 0}
          actions={
            canCurate ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowNewForm((v) => !v)}
                aria-expanded={showNewForm}
              >
                {t("newAnalysis")}
              </button>
            ) : null
          }
        />

        {dealScoped && (
          <div role="group" aria-label={t("analysisScope")} className="flex flex-wrap gap-1 mb-2">
            <button type="button" className={scope === "deal" ? "btn-primary btn-sm" : "btn-ghost btn-sm"} aria-pressed={scope === "deal"} onClick={() => setScope("deal")}>{t("thisDealOnly")}</button>
            <button type="button" className={scope === "all" ? "btn-primary btn-sm" : "btn-ghost btn-sm"} aria-pressed={scope === "all"} onClick={() => setScope("all")}>{tc("all")}</button>
          </div>
        )}

        {analyses === null ? (
          <p>{tc("loading")}</p>
        ) : dealEmpty ? (
          <div className="text-[length:var(--fs-body)]" role="status">
            <p className="mb-2">{t("noSynergyAnalysesLinkedTo")}</p>
            <button
              type="button"
              className="btn-primary"
              disabled={startDisabledReason !== null}
              aria-describedby={startDisabledReason ? "synergy-deal-start-reason" : undefined}
              onClick={() => { if (opportunityId) setOppSel(opportunityId); setShowNewForm(true); setTimeout(() => document.querySelector(".sizing-new-form")?.scrollIntoView({ block: "center" }), 0); }}
            >
              {t("startAnalysisForThisDeal")}
            </button>
            {startDisabledReason && <p id="synergy-deal-start-reason" className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{startDisabledReason}</p>}
            <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("analysesOfOtherDealsAre")}</p>
          </div>
        ) : analyses.length === 0 ? (
          <div className="text-[length:var(--fs-body)]">
            <p className="text-[color:var(--muted-fg)] mb-2">
              {t("noSynergyAnalysesRegisteredAnalysis")} <strong>{t("groupAffiliatesSynergyAnalysis")}</strong> {t("orderGroupAndAffiliateProfiles")}
            </p>
            <Link href={profileHrefFor(opportunityId)} className="btn-ghost btn-sm">{t("registerGroupAndAffiliateProfiles")}</Link>
            <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("afterCreatingTheProfileCome")}</span>
          </div>
        ) : (
          <div className="table-scroll">
          <table className="data-table list-table synergy-list-table table-fixed-pct tmin-56" aria-label={t("companyListInAnalysisScope")}>
            <caption className="sr-only">{t("companyListInAnalysisScope2")}</caption>
            <ColGroup widths={SYNERGY_COL_PCT} />
            <thead>
              <tr>
                <th scope="col">{t("companyName")}</th>
                <th scope="col">{t("linkedOpportunity")}</th>
                <th scope="col">{tc("division")}</th>
                <th scope="col">{tc("analysisStatus")}</th>
                <th scope="col" className="col-date">{tc("analysisDate")}</th>
                <th scope="col"><span className="sr-only">{tc("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // 회사별 묶음 — 회사 셀은 그룹 첫 행에만 표시(rowSpan)하고
                // 기회는 행마다 나열된다 (가독성: 회사가 하나의 묶음으로 보임).
                const groups = new Map<string, SynergyAnalysis[]>();
                for (const a of analyses) {
                  const key = analysisGroupKey(a);
                  const list = groups.get(key) ?? [];
                  list.push(a);
                  groups.set(key, list);
                }
                const flat: Array<{ a: SynergyAnalysis; companyCell: SynergyAnalysis | null }> = [];
                for (const list of groups.values()) {
                  list.forEach((a, i) => flat.push({ a, companyCell: i === 0 ? a : null }));
                }
                return flat.map(({ a, companyCell }) => {
                const inProgress = a.status === "in_progress";
                // 보호 모드 재분석 중엔 status가 여전히 'completed'라 inProgress로는
                // 안 잡힌다 — 재분석/삭제를 막으려면 이 플래그도 함께 봐야 한다.
                const busy = inProgress || !!a.rerun_in_progress;
                return (
                  // 행 전체 클릭 진입점은 제거됐다(2026-10 접근성 리뷰 — 행 합성
                  // 타깃은 스크린리더에서 셀 구조를 무너뜨린다). 상세 진입은 연결
                  // 기회 셀의 리포트 버튼이 담당한다.
                  <tr
                    key={a.id}
                    className={selectedId === a.id ? "row-selected" : undefined}
                  >
                    {companyCell !== null && (() => {
                      const groupLen = groups.get(analysisGroupKey(companyCell))!.length;
                      // 회사 셀은 항상 묶음 헤더(레이블)일 뿐이다 — 상세 진입은
                      // 연결 기회 셀의 리포트 버튼이 일관되게 담당한다.
                      return (
                        <td className="cell-primary align-top" rowSpan={groupLen}>
                          <span className="font-semibold">{targetLabel(companyCell, tr)}</span>
                        </td>
                      );
                    })()}
                    <td>
                      <button
                        type="button"
                        className={a.opportunity_name ? "text-[length:var(--fs-caption)] text-left underline-offset-2 hover:underline" : "text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] text-left underline-offset-2 hover:underline"}
                        title={t("openSynergyConsistencyReport")}
                        onClick={() => openDetail(a)}
                      >
                        {a.opportunity_name ?? t("marketLinkageOnly")}
                      </button>
                      {scope === "all" && dealScoped && opportunityId && a.opportunity_id === opportunityId && (
                        <span className="control-chip status-green ml-1">{t("thisDeal")}</span>
                      )}
                    </td>
                    <td>{a.target_type ? <span className="control-chip status-not-started">{a.target_type === "group" ? t("group") : tc("affiliate")}</span> : <span className="control-chip status-amber" title={t("legacySeparatelyRegisteredAnalysis")}>legacy</span>}</td>
                    <td>
                      {inProgress ? (
                        <span className="status-chip status-amber">{tc("analyzingOpen")}{a.current_step}{t("n5Steps")}</span>
                      ) : a.status === "completed" && a.rerun_in_progress ? (
                        // ADR-0132 — 재분석 진행 중에도 이전 완료 버전이 그대로 표시된다.
                        <span className="status-chip status-amber" title={t("thePreviousCompletedVersionStays")}>{t("item")}{a.current_step ?? 0}{t("n5StepsPreviousV")}{a.latest_version ?? 1} {tc("keptSuffix")}</span>
                      ) : a.status === "completed" && a.error_message ? (
                        <span className="status-chip status-red" title={t("p1TheDisplayedVersionIs", { p1: a.error_message })}>{t("failedV")}{a.latest_version ?? 1} {tc("keptSuffix")}</span>
                      ) : (
                        <span className="status-chip status-green">{tc("analysisCompleteV")}{a.latest_version ?? 1})</span>
                      )}
                    </td>
                    <td className="col-date tabular-nums">{(a.completed_at ?? a.created_at).slice(0, 10)}</td>
                    <td className="sizing-actions-cell"><span className="actions-row">
                      {!busy && canCurate && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          title={a.target_type ? t("reusesTheSameAnalysisRow") : t("legacySeparatelyRegisteredAnalysesCannot")}
                          onClick={() => { void rerun(a, { stayOnList: true }); }}
                        >
                          {tc("reanalyze")}
                        </button>
                      )}
                      {!busy && canCurate && (
                        <button type="button" className="btn-danger btn-sm" title={t("deletesThisSynergyAnalysis")} onClick={() => removeAnalysis(a)}>
                          {tc("delete")}
                        </button>
                      )}
                    </span></td>
                  </tr>
                );
                });
              })()}
            </tbody>
          </table>
          </div>
        )}
        {hasInProgress && <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="status">{t("analysisInProgressTheList")}</p>}
      </section>
  );
}
