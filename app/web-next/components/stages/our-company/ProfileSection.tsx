"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import Link from "next/link";
import { ListBackButton } from "../../ListBackButton.tsx";
import { ProfileReport } from "./ProfileReport.tsx";
import { ProfileChips } from "./ProfileChips.tsx";
import type { OurCompanyStageState } from "./useOurGroups.ts";

export function ProfileSection({ ctx }: { ctx: OurCompanyStageState }) {
  const { openMember, profiles, canAct, analyzeMember, backToList } = ctx;
  return (
    <>{openMember && (
        <section aria-label="계열사 프로파일 리포트" className="market-section sizing-step">
          <SectionToolbar
            title="계열사 프로파일 분석"
            icon="🏢"
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
                    title="이 계열사를 대상으로 시너지·전략적 적합성 분석을 진행합니다"
                  >
                    시너지 분석 →
                  </Link>
                )}
                {canAct && (
                <button type="button" className="btn-ghost" disabled={profiles[openMember] === "loading"} onClick={() => analyzeMember(openMember)}>
                  {profiles[openMember] === "loading" ? "분석 중..." : "재분석"}
                </button>
                )}
                <ListBackButton onClick={backToList} />
              </>
            }
          />
          {profiles[openMember] === "loading" && <p className="text-[length:var(--fs-body)]" role="status">분석 중입니다 — 완료되면 자동으로 표시됩니다.</p>}
          <ProfileReport ctx={ctx} openMember={openMember} />
        </section>
      )}</>
  );
}
