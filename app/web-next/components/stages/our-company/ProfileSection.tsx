"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import Link from "next/link";
import { ListBackButton } from "../../ListBackButton.tsx";
import { ProfileReport } from "./ProfileReport.tsx";
import { ProfileChips } from "./ProfileChips.tsx";
import { ProfileEvidencePanel } from "./ProfileEvidence.tsx";
import type { OurCompanyStageState } from "./useOurGroups.ts";
import { useTranslations } from "next-intl";

export function ProfileSection({ ctx }: { ctx: OurCompanyStageState }) {const t = useTranslations("components.ourCompany.profileSection"); const tc = useTranslations("common");
  const { openMember, profiles, canAct, analyzeMember, backToList } = ctx;
  return (
    <>{openMember && (
        <section aria-label={t("affiliateProfileReport")} className="market-section sizing-step">
          {/* Back navigation sits on its own line so the toolbar keeps one action + one next-stage link. */}
          <div className="mb-2"><ListBackButton onClick={backToList} /></div>
          <SectionToolbar
            title={t("affiliateProfileAnalysis")}
            summary={<ProfileChips profile={profiles[openMember]} />}
            actions={
              <>
                {/* /synergy는 캐리어 리다이렉트 스텁이 됐다(route-cleanup design
                    §4.3) — 분석(company) 딥링크 파라미터는 캐리어 탭에서 표현할
                    방법이 없어 평문 플랫 링크로 통일한다. 피커/리졸버가 검토/안건을
                    고른 뒤 S3 탭에서 이 계열사를 다시 고르는 2단계가 된다. */}
                {profiles[openMember] && profiles[openMember] !== "loading" && (
                  <Link
                    href="/synergy"
                    className="btn-ghost"
                    title={t("runTheSynergyAndStrategic")}
                  >
                    {t("synergyAnalysis")}
                  </Link>
                )}
                {canAct && (
                <button type="button" className="btn-ghost" disabled={profiles[openMember] === "loading"} onClick={() => analyzeMember(openMember)}>
                  {profiles[openMember] === "loading" ? tc("analyzing") : tc("reanalyze")}
                </button>
                )}
              </>
            }
          />
          {canAct && profiles[openMember] !== "loading" && <ProfileEvidencePanel ctx={ctx} memberId={openMember} profile={profiles[openMember]} />}
          {profiles[openMember] === "loading" && <p className="text-[length:var(--fs-body)]" role="status">{t("analysisInProgressItWill")}</p>}
          <ProfileReport ctx={ctx} openMember={openMember} />
        </section>
      )}</>
  );
}
