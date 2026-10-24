"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import { CheckIcon } from "./icons.tsx";
import { useTranslations } from "next-intl";

export function GroupSelectPanel({ ctx }: { ctx: OurCompanyStageState }) {const t = useTranslations("components.ourCompany.groupPanels"); const tc = useTranslations("common");
  const { canAct, setShowGroupForm, setShowMemberForm, showGroupForm, groupName, setGroupName, busy, groups, selectedGroup, createGroup, backToList, loadGroup } = ctx;
  return (
    <section aria-label={t("group")} className="market-section" aria-busy={groups === null}>
        <SectionToolbar
          title={t("groupsInAnalysisScope")}
          actions={
            canAct ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { setShowGroupForm((v) => !v); setShowMemberForm(false); }}
                aria-expanded={showGroupForm}
              >
                {t("registerGroup")}
              </button>
            ) : undefined
          }
        />
        {canAct && showGroupForm && (
          <form onSubmit={createGroup} className="sizing-new-form mb-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{t("groupName")}</span>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t("eGTechcrossGroup")} required className="sizing-new-input" autoFocus />
              </label>
              <span className="flex items-center gap-2">
                <button type="submit" className="btn-ghost btn-sm" disabled={busy || !groupName.trim()}>{tc("register")}</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setShowGroupForm(false)}>{tc("cancel")}</button>
              </span>
            </div>
          </form>
        )}
        {groups === null ? (
          <p>{tc("loading")}</p>
        ) : groups.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">{t("noGroupsRegisteredStartWith")}</p>
        ) : (
          <div role="group" aria-label={t("groupsInAnalysisScope2")} className="group-card-list">
            {groups.map((g) => {
              const active = selectedGroup?.group.id === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={active}
                  className={`group-card ${active ? "group-card-active" : ""}`}
                  onClick={() => { backToList(); loadGroup(g.id); }}
                >
                  <span className="group-card-check">{active && <CheckIcon />}</span>
                  <span className="group-card-body">
                    <span className="group-card-name" title={g.name}>{g.name}</span>
                    <span className="sizing-chip-meta">{tc("affiliate")} {g.member_count}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
  );
}

export function ProfileSummaryPanel({ ctx }: { ctx: OurCompanyStageState }) {const t = useTranslations("components.ourCompany.groupPanels");
  const { selectedGroup } = ctx;
  return (
    <>{selectedGroup && (() => {
        const withProfiles = selectedGroup.profiles.filter((p) => p.profile);
        if (withProfiles.length < 2) return null;
        const pairs: Array<{ a: string; b: string; shared: string[]; score: number }> = [];
        for (let i = 0; i < withProfiles.length; i++) {
          for (let j = i + 1; j < withProfiles.length; j++) {
            const pa = withProfiles[i].profile!;
            const pb = withProfiles[j].profile!;
            const ea = new Set(pa.industryExposure ?? []);
            const eb = new Set(pb.industryExposure ?? []);
            const shared = [...ea].filter((x) => eb.has(x));
            // 산업 노출 겹침 비율 기반 시너지 점수 (0-100, 정성 지표)
            const union = new Set([...ea, ...eb]).size;
            const score = union === 0 ? 0 : Math.min(100, Math.round(((shared.length / union) * 100) * 1.5));
            if (shared.length > 0) pairs.push({ a: withProfiles[i].company_name, b: withProfiles[j].company_name, shared, score });
          }
        }
        if (pairs.length === 0) return null;
        pairs.sort((x, y) => y.score - x.score);
        return (
          <section aria-label={t("synergy")} className="market-section">
            <div className="section-toolbar"><span className="section-title"><h2>{t("synergyMatrixByIndustryExposure")}</h2></span></div>
            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("aQualitativeMatrixConvertingHow")}
            </p>
            <table className="data-table" aria-label={t("synergy2")}>
              <caption className="sr-only">{t("synergyMatrix")}</caption>
              <thead>
                <tr><th scope="col">{t("affiliateA")}</th><th scope="col">{t("affiliateB")}</th><th scope="col">{t("overlappingIndustries")}</th><th scope="col" className="w-[7rem]">{t("synergyMetrics")}</th></tr>
              </thead>
              <tbody>
                {pairs.map((pr) => (
                  <tr key={`${pr.a}-${pr.b}`}>
                    <td className="font-semibold">{pr.a}</td>
                    <td className="font-semibold">{pr.b}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {pr.shared.map((x) => <span key={x} className="status-chip status-in-progress">{x}</span>)}
                      </div>
                    </td>
                    <td className="tabular-nums">
                      <span className={`status-chip ${pr.score >= 60 ? "status-green" : pr.score >= 30 ? "status-amber" : "status-not-started"}`}>{pr.score}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })()}</>
  );
}
