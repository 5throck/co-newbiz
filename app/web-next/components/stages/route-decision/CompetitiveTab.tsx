"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import Link from "next/link";
import { ColGroup } from "../../ui.tsx";
import { S4_COMPETITIVE_COL_PCT } from "./constants.ts";
import type { RouteDecisionStageState } from "./useRouteDecision.ts";
import type { OpportunityRow } from "./types.ts";
import { useTranslations } from "next-intl";

export function CompetitiveTab({ ctx, selected }: { ctx: RouteDecisionStageState; selected: OpportunityRow }) {const t = useTranslations("stages.s4.competitiveTab"); const tc = useTranslations("common");
  const { tab, advisory } = ctx;
  return (
    <>{tab === "competitive" && (
        <div className="card">
          <h2>{selected.name} {t("competitiveStructure")}</h2>
          {advisory === null ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
              {t("failedToLoadEvidenceRefresh")}
            </p>
          ) : advisory.s1Evidence?.competitive ? (
            <>
              <h4 className="text-[length:var(--fs-body)] mb-1">
                {t("competitiveStructureS1V")}{advisory.s1Evidence.versionNo ?? "?"} — {advisory.s1Evidence.industryName})
              </h4>
              <p className="text-[length:var(--fs-caption)] mb-1">{advisory.s1Evidence.competitive.structure}</p>
              {advisory.s1Evidence.competitive.players.length > 0 && (
                <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
                  <table className="data-table mb-0 table-fixed-pct tmin-40" aria-label={tc("competitiveStructureKeyCompanies")}>
                    <caption className="sr-only">{tc("competitiveStructureKeyCompanies")}</caption>
                    <ColGroup widths={S4_COMPETITIVE_COL_PCT} />
                    <thead>
                      <tr><th scope="col">{t("company")}</th><th scope="col">{t("tier")}</th><th scope="col">{tc("notes")}</th></tr>
                    </thead>
                    <tbody>
                      {advisory.s1Evidence.competitive.players.map((p) => (
                        <tr key={p.name}>
                          <td className="cell-primary">{p.name}</td>
                          <td>
                            <span className={`status-chip ${p.tier === "leader" ? "status-green" : p.tier === "challenger" ? "status-amber" : "status-not-started"}`}>
                              {p.tier === "leader" ? t("leader") : p.tier === "challenger" ? t("challenger") : t("niche")}
                            </span>
                          </td>
                          <td className="cell-truncate text-[length:var(--fs-caption)]">{p.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
              {t("competitiveStructureNotRecorded")}{" "}
              {selected.market_scope ? (
                <Link href={`/market?industry=${encodeURIComponent(selected.market_scope)}`} className="text-[color:var(--accent)] underline">{t("s1Report")}</Link>
              ) : (
                <span>{t("s1Report2")}</span>
              )}
              {" "}{t("reinforceConcentrationAndKeyPlayers")}
            </p>
          )}
        </div>
      )}</>
  );
}
