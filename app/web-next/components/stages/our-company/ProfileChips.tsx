"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { Profile } from "./types.ts";

/** 상세 헤더 요약 칩 — 프로파일 메타 (DART·리서치·폴백 상태). */
export function ProfileChips({ profile }: { profile: Profile | "loading" | undefined }) {
  if (!profile || profile === "loading") return null;
  return (
    <span className="flex items-center gap-1">
      {profile.dataSources?.dart && <span className="status-chip status-green">DART {profile.dataSources.dartYear ?? ""}</span>}
      {(profile.dataSources?.webResearchCount ?? 0) > 0 && <span className="status-chip status-in-progress">외부 리서치 {profile.dataSources!.webResearchCount}건</span>}
      {profile.degraded && <span className="status-chip status-amber" title={profile.degraded}>부분 분석(폴백)</span>}
    </span>
  );
}