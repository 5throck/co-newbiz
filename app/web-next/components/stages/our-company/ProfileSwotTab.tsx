"use client";

// Split from ProfileBasicTabs.tsx (design 2026-11-13-profile-headless-fallback round; behavior unchanged).
import type { OurCompanyStageState } from "./useOurGroups.ts";
import type { Profile } from "./types.ts";
import { AnalystEditedChip, FinancialGroundedChip, isEditedItem } from "./ProfileEvidence.tsx";
import { useTranslations } from "next-intl";

export function ProfileSwotTab({ ctx, profile }: { ctx: OurCompanyStageState; profile: Profile }) {
  const t = useTranslations("components.ourCompany.profileBasicTabs");
  const { profileTab } = ctx;
  return (
    <>
      {profileTab === "swot" && (
        <div className="text-[length:var(--fs-body)]">
          {profile.swot && (
            <p
              className="sizing-note-list mb-2 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]"
              role="note"
            >
              {t("opportunitiesAndThreatsAreAi")}
            </p>
          )}
          <div className="chart-pair">
            <div className="chart-half sizing-grade-card report-bullet-card">
              <h4>{t("strength")}</h4>
              <ul className="report-bullet-list">
                {(profile.strengths ?? []).map((x, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: bullet strings carry no id and the list is static per profile render
                  <li key={i}>
                    {x}
                    {isEditedItem(profile, "strengths", x) && <AnalystEditedChip />}
                    <FinancialGroundedChip profile={profile} field="strengths" index={i} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="chart-half sizing-grade-card report-bullet-card">
              <h4>{t("weakness")}</h4>
              <ul className="report-bullet-list">
                {(profile.weaknesses ?? []).map((x, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: bullet strings carry no id and the list is static per profile render
                  <li key={i}>
                    {x}
                    {isEditedItem(profile, "weaknesses", x) && <AnalystEditedChip />}
                    <FinancialGroundedChip profile={profile} field="weaknesses" index={i} />
                  </li>
                ))}
              </ul>
            </div>
            {profile.swot && (
              <>
                <div className="chart-half sizing-grade-card report-bullet-card">
                  <h4>{t("opportunity")}</h4>
                  <ul className="report-bullet-list">
                    {(profile.swot.opportunities ?? []).map((x, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: bullet strings carry no id and the list is static per profile render
                      <li key={i}>
                        {x}
                        <FinancialGroundedChip profile={profile} field="opportunities" index={i} />
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="chart-half sizing-grade-card report-bullet-card">
                  <h4>{t("threat")}</h4>
                  <ul className="report-bullet-list">
                    {(profile.swot.threats ?? []).map((x, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: bullet strings carry no id and the list is static per profile render
                      <li key={i}>
                        {x}
                        <FinancialGroundedChip profile={profile} field="threats" index={i} />
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
          <p className="mt-3 mb-0 text-[length:var(--fs-body)]">
            <strong>{t("overallEvaluation2")}</strong> {profile.businessAssessment || "—"}
          </p>
        </div>
      )}
    </>
  );
}
