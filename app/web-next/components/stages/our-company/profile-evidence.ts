// Pure helpers for the analyst-supplied evidence inputs of the profile generation panel (ADR-0172 amendment 4).
import { TranslatorFn } from "../../../i18n/config.ts";
import type { Profile } from "./types.ts";

export interface EvidenceDraft { urls: string; note: string }
export const EMPTY_EVIDENCE: EvidenceDraft = { urls: "", note: "" };

/** Catalog key; resolve through a TranslatorFn at render. */
export const EVIDENCE_HELP =
  "components.ourCompany.profileEvidence.evidenceUrlsAndIntroductionMemos";

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

export function sourceStatusChip(s: { status: "ok" | "thin" | "failed"; reason?: string }, tr: TranslatorFn): { icon: string; text: string; tone: "status-green" | "status-amber" | "status-red" } {
  if (s.status === "ok") return { icon: "✓", text: tr("components.ourCompany.profileEvidence.collected"), tone: "status-green" };
  if (s.status === "thin") return { icon: "!", text: tr("components.ourCompany.profileEvidence.insufficientBodyRecordedBySource"), tone: "status-amber" };
  return { icon: "×", text: tr("components.ourCompany.profileEvidence.failedP1", { p1: s.reason ?? tr("common.noReason") }), tone: "status-red" };
}

/** True when the analyst supplied usable evidence (a note or at least one source with a body). */
export function hasAnalystEvidence(profile: Pick<Profile, "dataSources">): boolean {
  const d = profile.dataSources;
  return Boolean(d?.analystNote) || (d?.userSources ?? []).some((s) => s.status === "ok");
}

export function versionLabel(sourceRef: string | null, tr: TranslatorFn): string | null {
  if (sourceRef === "analyst_edit") return tr("common.analystRevision");
  if (sourceRef === "analyst_source") return tr("components.ourCompany.profileEvidence.changeSource");
  return null;
}

export const EDIT_FIELD_LABELS = { industryExposure: "components.ourCompany.profileEvidence.industryExposure", strengths: "components.ourCompany.profileEvidence.strength", weaknesses: "components.ourCompany.profileEvidence.weakness", businessAssessment: "components.ourCompany.profileEvidence.businessEvaluation" } as const;

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
