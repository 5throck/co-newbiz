"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
// ADR-0180 slice 5: selecting a linked opportunity shows its S2 entry market
// (read-only strip) so the analyst sees the market the fit is judged against.
import Link from "next/link";
import { profileHrefFor } from "./synergyFormat.ts";
import { EntryMarketContextStrip } from "../../EntryMarketContextStrip.tsx";
import type { SynergyStageState } from "./useSynergyList.ts";
import { useTranslations } from "next-intl";

export function NewSynergyForm({ ctx }: { ctx: SynergyStageState }) {const t = useTranslations("stages.s3.newSynergyForm"); const tc = useTranslations("common");
  const { canCurate, showNewForm, targets, targetSel, setTargetSel, oppSel, setOppSel, opps, setShowNewForm, creating, createAnalysis, opportunityId } = ctx;
  const profileHref = profileHrefFor(opportunityId);
  return (
    <>{canCurate && showNewForm && (
        <div className="sizing-new-form mb-3">
          <div className="mb-2">
            <span className="text-label block mb-1">{t("analysisSubjectTargetsProfiledIn")}</span>
            {targets.length === 0 ? (
              <div className="text-[length:var(--fs-body)]">
                <p className="text-[color:var(--muted-fg)] mb-2">
                  {t("noAnalysisScopeTheOrder")} <strong>{t("registerGroupRegisterAffiliatesAnd")}</strong>{t("item")}
                </p>
                <Link href={profileHref} className="btn-ghost btn-sm">{t("registerGroupAndAffiliateProfiles")}</Link>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {targets.map((tgt) => (
                  <button
                    key={`${tgt.kind}-${tgt.id}`}
                    type="button"
                    aria-pressed={targetSel?.kind === tgt.kind && targetSel?.id === tgt.id}
                    disabled={!tgt.hasProfile}
                    title={tgt.hasProfile ? t("p1GroupProfileAvailable", { p1: tgt.groupName }) : t("targetWithoutAProfileRun")}
                    className={`sizing-industry-chip ${targetSel?.kind === tgt.kind && targetSel?.id === tgt.id ? "sizing-industry-chip-active" : ""} ${!tgt.hasProfile ? "opacity-40" : ""}`}
                    onClick={() => { if (tgt.hasProfile) setTargetSel({ kind: tgt.kind, id: tgt.id }); }}
                  >
                    <span className="font-semibold">{tgt.kind === "group" ? tc("all") : ""} {tgt.label}</span>
                    <span className="sizing-chip-meta">{tgt.hasProfile ? t("profileReady") : t("noProfile")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mb-2">
            <span className="text-label block mb-1">{t("linkedOpportunityOptionalSelectingAn")}</span>
            <select value={oppSel} onChange={(e) => setOppSel(e.target.value)} className="sizing-new-input" style={{ width: "100%" }}>
              <option value="">{t("analyzeWithoutAnOpportunityMarket")}</option>
              {opps.filter((o) => o.status !== "dropped").map((o) => (
                <option key={o.id} value={o.id}>[{o.status}] {o.name}</option>
              ))}
            </select>
            {oppSel && <EntryMarketContextStrip opportunityId={oppSel} />}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setShowNewForm(false)}>{tc("cancel")}</button>
            <button
              type="button"
              className="btn-ghost"
              disabled={creating || !targetSel}
              aria-describedby={!targetSel ? "synergy-start-reason" : undefined}
              onClick={() => void createAnalysis()}
            >
              {creating ? tc("analysisStarting") : t("startAnalysis")}
            </button>
          </div>
          {!targetSel && (
            <p id="synergy-start-reason" className="mt-2 mb-0 text-right text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("youCanStartOnceThe")} <Link href={profileHref} className="guide-link">{t("registerGroupAndAffiliateProfiles2")}</Link>{t("item2")}
            </p>
          )}
        </div>
      )}</>
  );
}
