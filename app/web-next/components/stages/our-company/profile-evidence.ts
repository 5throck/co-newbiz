// Pure helpers for the analyst-supplied evidence inputs of the profile generation panel (ADR-0172 amendment 4).
import type { Profile } from "./types.ts";

export interface EvidenceDraft { urls: string; note: string }
export const EMPTY_EVIDENCE: EvidenceDraft = { urls: "", note: "" };

export const EVIDENCE_HELP =
  "여기에 넣은 근거 주소와 소개 메모는 분석가가 확인한 근거로 취급되어 프로파일 생성에 쓰이고, 프로파일 버전에 함께 저장됩니다. 주소는 한 줄에 하나(최대 8개, http/https), 메모는 2000자까지입니다.";

/** Prefill from the last stored profile version so a regeneration reuses the previous inputs. */
export function evidenceFromProfile(profile: Profile | "loading" | undefined): EvidenceDraft {
  if (!profile || profile === "loading") return EMPTY_EVIDENCE;
  // Hand-entered excerpts live server-side and are carried into every regeneration; only fetched URLs are prefilled here.
  const urls = (profile.dataSources?.userSources ?? []).filter((s) => !s.manual && !s.removed).map((s) => s.url).join("\n");
  return { urls, note: profile.userNote ?? "" };
}

export function parseUrlLines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

/** Request body for POST .../analyze. */
export function evidenceBody(draft: EvidenceDraft): { sourceUrls: string[]; companyNote: string } {
  return { sourceUrls: parseUrlLines(draft.urls), companyNote: draft.note.trim() };
}

export function sourceStatusChip(s: { status: "ok" | "thin" | "failed"; reason?: string }): { icon: string; text: string; tone: "status-green" | "status-amber" | "status-red" } {
  if (s.status === "ok") return { icon: "✓", text: "수집됨", tone: "status-green" };
  if (s.status === "thin") return { icon: "!", text: "본문 부족(출처로만 기록)", tone: "status-amber" };
  return { icon: "×", text: `실패(${s.reason ?? "사유 없음"})`, tone: "status-red" };
}

/** True when the analyst supplied usable evidence (a note or at least one source with a body). */
export function hasAnalystEvidence(profile: Pick<Profile, "dataSources">): boolean {
  const d = profile.dataSources;
  return Boolean(d?.analystNote) || (d?.userSources ?? []).some((s) => s.status === "ok");
}

export function versionLabel(sourceRef: string | null): string | null {
  if (sourceRef === "analyst_edit") return "분석가 수정";
  if (sourceRef === "analyst_source") return "출처 변경";
  return null;
}

export const EDIT_FIELD_LABELS = { industryExposure: "산업 노출", strengths: "강점", weaknesses: "약점", businessAssessment: "사업 평가" } as const;

/** Fields whose value differs from the current profile, ready for the overrides request (lists are one item per line). */
export function overrideBody(profile: Profile, draft: { industryExposure: string; strengths: string; weaknesses: string; businessAssessment: string; reason: string; citeSource: string }) {
  const lines = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const same = (a: string[], b: string[] | undefined) => a.length === (b ?? []).length && a.every((x, i) => x === (b ?? [])[i]);
  const body: Record<string, unknown> = { reason: draft.reason.trim() };
  if (draft.citeSource.trim()) body.citeSource = draft.citeSource.trim();
  const ie = lines(draft.industryExposure); if (!same(ie, profile.industryExposure)) body.industryExposure = ie;
  const st = lines(draft.strengths); if (!same(st, profile.strengths)) body.strengths = st;
  const we = lines(draft.weaknesses); if (!same(we, profile.weaknesses)) body.weaknesses = we;
  if (draft.businessAssessment.trim() !== (profile.businessAssessment ?? "").trim()) body.businessAssessment = draft.businessAssessment.trim();
  return body;
}
