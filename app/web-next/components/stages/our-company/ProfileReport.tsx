"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { ProfileOverviewTab, ProfileSwotTab, ProfileIndustryTab, ProfileSourcesTab } from "./ProfileBasicTabs.tsx";
import { ProfileFinancialsTab } from "./ProfileFinancialsTab.tsx";
import { ProfileCompetitiveTab } from "./ProfileCompetitiveTab.tsx";
import { PROFILE_TABS } from "./constants.ts";
import { DegradedChip, showDegradedChip } from "./ProfileChips.tsx";
import { AnalystEvidenceChip } from "./ProfileEvidence.tsx";
import { hasAnalystEvidence } from "./profile-evidence.ts";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";
import { useTranslations } from "next-intl";

export function ProfileReport({ ctx, openMember }: { ctx: OurCompanyStageState; openMember: string }) {const tr = useTranslations(); const t = useTranslations("components.ourCompany.profileReport"); const tc = useTranslations("common");
  const { profiles, profileTab, setProfileTab } = ctx;
  return (
    <>{profiles[openMember] && profiles[openMember] !== "loading" && (() => {
        const profile = profiles[openMember] as Profile;
        return (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h2 className=" !mb-0">{profile.companyName} {t("profile")}</h2>
              {profile.dataSources?.dart && <span className="status-chip status-green">DART {profile.dataSources.dartYear ?? ""}</span>}
              {(profile.dataSources?.webResearchCount ?? 0) > 0 && <span className="status-chip status-in-progress">{tc("externalResearch")} {profile.dataSources!.webResearchCount}{tc("countUnit")}</span>}
              {profile.dataSources?.webResearchPlaywright && <span className="status-chip status-in-progress">{tc("headlessSearchChip")}</span>}
              {hasAnalystEvidence(profile) && <AnalystEvidenceChip />}
              {showDegradedChip(profile) && <DegradedChip degraded={profile.degraded!} dartGrounded={profile.dataSources?.dart === true} showHint />}
            </div>
            <div className="library-tabs" role="tablist" aria-label={t("profileSections")}>
              {PROFILE_TABS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={profileTab === key} className={`library-tab ${profileTab === key ? "library-tab-active" : ""}`} onClick={() => setProfileTab(key)}>
                  {tr(label)}
                </button>
              ))}
            </div>

            <ProfileOverviewTab ctx={ctx} profile={profile} />

            <ProfileFinancialsTab ctx={ctx} profile={profile} />

            <ProfileSwotTab ctx={ctx} profile={profile} />

            <ProfileIndustryTab ctx={ctx} profile={profile} />

            <ProfileCompetitiveTab ctx={ctx} profile={profile} />

            <ProfileSourcesTab ctx={ctx} profile={profile} />

          </>
        );
      })()}</>
  );
}
