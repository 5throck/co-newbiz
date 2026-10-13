// Governance library index — generated static projection for Next/Turbopack.
// Source documents still live under policies/, procedures/, checklists/, docs/,
// and templates/. The generated module keeps server routes from performing broad
// filesystem traversal during `next build` NFT tracing.
import {
  LIBRARY_BROWNFIELD_WORKSPACE_OVERLAY,
  LIBRARY_CHECKLIST_ITEMS,
  LIBRARY_CONTENT,
  LIBRARY_DOCS,
  LIBRARY_WORKSPACE_OVERLAY,
} from "./library.generated.ts";

export type LibraryCategory = "checklist" | "manual" | "policy" | "procedure" | "reference" | "template" | "design" | "dd" | "runbook" | "guideline";

export interface LibraryDocSummary {
  id: string;
  category: LibraryCategory;
  title: string;
  file: string;
  gate?: string;
  enforceability?: string;
  version?: string;
  owner_agent?: string;
  item_count?: number;
  // 단일 파일 문서는 그 내용 언어를, md 문서는 ko/en 페어 중 자기 파일의 언어를 표시한다.
  lang: "en" | "ko";
}

export interface LibraryDocContent extends LibraryDocSummary {
  content: string;
}

const CATEGORIES: LibraryCategory[] = ["checklist", "manual", "policy", "procedure", "reference", "template", "design", "dd", "runbook", "guideline"];

export function listLibrary(): LibraryDocSummary[] {
  return [...LIBRARY_DOCS];
}

export function getLibraryDoc(id: string): LibraryDocContent | null {
  return LIBRARY_CONTENT[id] ?? null;
}

export function isLibraryCategory(value: string): value is LibraryCategory {
  return (CATEGORIES as string[]).includes(value);
}

export interface ChecklistItemDef {
  id: string;
  text: string;
  mandatory: boolean;
  waiver_eligible: boolean;
}

export function getChecklistItems(checklistDocId: string): ChecklistItemDef[] | null {
  return LIBRARY_CHECKLIST_ITEMS[checklistDocId] ?? null;
}

/**
 * ADR-0160 addendum (b): the S9 workspace scope overlay as projected from
 * checklists/_overlays/greenfield-workspace-scope.yaml (drift-checked by
 * sync-library-projection.ts --check). Shape is validated by checklists/_validate.ts;
 * lib/greenfield-subtrack.ts reads it defensively (fail-closed to "apply as-is").
 */
export function getWorkspaceOverlay(): unknown {
  return LIBRARY_WORKSPACE_OVERLAY;
}

/**
 * ADR-0162: the brownfield S9 workspace scope overlay as projected from
 * checklists/_overlays/brownfield-workspace-scope.yaml (same drift check).
 * lib/brownfield-subtrack.ts reads it defensively (fail-closed to "apply as-is").
 */
export function getBrownfieldWorkspaceOverlay(): unknown {
  return LIBRARY_BROWNFIELD_WORKSPACE_OVERLAY;
}

/** DD workspace kinds → their gate-checklist doc ids. */
export const DD_WORKSPACE_CHECKLISTS: Record<string, string> = {
  commercial: "chk-commercial-dd-checklist",
  technical: "chk-technical-dd-checklist",
  legal: "chk-legal-dd-checklist",
  financial: "chk-financial-dd-checklist",
  hr: "chk-hr-dd-checklist",
  market: "chk-market-dd-checklist",
  financing: "chk-financing-plan-checklist",
};

/**
 * Wave F-8 (audit B1) — extra S9 checklists applicable by Brownfield
 * route_decision.sub_track, on top of the seven shared DD domains.
 * M&A: the six binding validators (bf-01) + special topics. JV / partnership /
 * minority: partnership + pre-signing deal-shape. R&BD: technology checklist.
 * Strategic investment and CVC have no sub-track-specific checklist.
 */
const PARTNER_SHAPE_CHECKLISTS = ["chk-partnership-checklist", "chk-deal-shape-presigning-checklist"];
export const SUB_TRACK_DD_CHECKLISTS: Record<string, string[]> = {
  m_and_a: ["chk-brownfield-feasibility-checklist", "chk-ma-special-topics-checklist"],
  jv: PARTNER_SHAPE_CHECKLISTS,
  partnership: PARTNER_SHAPE_CHECKLISTS,
  minority_investment: PARTNER_SHAPE_CHECKLISTS,
  rbd: ["chk-rbd-technology-checklist"],
  existing_business_rbd: ["chk-rbd-technology-checklist"],
};

/**
 * ADR-0162 addendum (DEC-20261013-03): extra checklists attached ONLY on the
 * scoped brownfield path (opt-in or past BF_WORKSPACE_SCOPE_DATE), so the
 * overlay can scope them down to the merger-control / foreign-investment items
 * (ma-01..03, min-05). Legacy unscoped projects keep SUB_TRACK_DD_CHECKLISTS
 * unchanged (no retroactive attachment of unscoped M&A items).
 */
export const BF_SCOPED_EXTRA_ADDITIONS: Record<string, string[]> = {
  strategic_investment: ["chk-ma-special-topics-checklist", "chk-deal-shape-presigning-checklist"],
  minority_investment: ["chk-ma-special-topics-checklist"],
  corporate_venture: ["chk-ma-special-topics-checklist", "chk-deal-shape-presigning-checklist"],
};

/** Extras attached to a brownfield sub-track on the scoped (overlay) path. */
export function scopedSubTrackDdChecklists(subTrack: string): string[] {
  return [...(SUB_TRACK_DD_CHECKLISTS[subTrack] ?? []), ...(BF_SCOPED_EXTRA_ADDITIONS[subTrack] ?? [])];
}
