"use client";

// Split from components/stages/OurCompanyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { Profile } from "./types.ts";
import { degradedChip, isNoResearchDegraded } from "../../../lib/profile-degraded.ts";
import { hasAnalystEvidence } from "./profile-evidence.ts";
import { AnalystEvidenceChip } from "./ProfileEvidence.tsx";

/** The "no search evidence" warning is moot when the analyst supplied usable evidence (a note or a fetched source). */
export function showDegradedChip(profile: Profile): boolean {
  return Boolean(profile.degraded) && !(isNoResearchDegraded(profile.degraded) && hasAnalystEvidence(profile));
}

/** Warning chip (icon + text) for a degraded profile; `showHint` adds the regenerate hint as visible text. */
export function DegradedChip({ degraded, showHint = false }: { degraded: string; showHint?: boolean }) {
  const c = degradedChip(degraded);
  return (
    <>
      <span className="status-chip status-amber" title={`${degraded} — ${c.hint}`}><span aria-hidden="true">!</span> {c.label}</span>
      {showHint && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{c.hint}</span>}
    </>
  );
}

/** 상세 헤더 요약 칩 — 프로파일 메타 (DART·리서치·폴백 상태). */
export function ProfileChips({ profile }: { profile: Profile | "loading" | undefined }) {
  if (!profile || profile === "loading") return null;
  return (
    <span className="flex items-center gap-1">
      {profile.dataSources?.dart && <span className="status-chip status-green">DART {profile.dataSources.dartYear ?? ""}</span>}
      {(profile.dataSources?.webResearchCount ?? 0) > 0 && <span className="status-chip status-in-progress">외부 리서치 {profile.dataSources!.webResearchCount}건</span>}
      {hasAnalystEvidence(profile) && <AnalystEvidenceChip />}
      {showDegradedChip(profile) && <DegradedChip degraded={profile.degraded!} />}
    </span>
  );
}