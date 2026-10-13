// Checklist item review status (informational only — it never blocks a gate).
// Items in checklists/*.yaml may carry optional `review_status`, `reviewer`,
// `verified_on`; a missing status reads as draft-AI. Pure module: safe to import
// from both server routes and client components.

export const REVIEW_STATUSES = ["draft-AI", "counsel-reviewed", "confirmed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ReviewFields {
  review_status?: ReviewStatus;
  reviewer?: string;
  verified_on?: string;
}

/** Marker shown as tooltip / aria text on the draft-AI badge. */
export const DRAFT_AI_MARKER = "AI 작성 · 법령 원문 일부 확인 · 변호사 검토 전 — 확정 아님";

export function reviewStatusOf(item: ReviewFields | null | undefined): ReviewStatus {
  const s = item?.review_status;
  return s === "counsel-reviewed" || s === "confirmed" ? s : "draft-AI";
}

export interface ReviewBadge {
  status: ReviewStatus;
  label: string;
  /** Existing status-chip tone class. */
  cls: string;
  /** Tooltip and aria text. */
  title: string;
}

export function reviewBadge(item: ReviewFields | null | undefined): ReviewBadge {
  const status = reviewStatusOf(item);
  const by = [item?.reviewer, item?.verified_on].filter(Boolean).join(", ");
  if (status === "confirmed") {
    return { status, label: `확정(${by})`, cls: "status-green", title: `확정 — ${by}` };
  }
  if (status === "counsel-reviewed") {
    return { status, label: `법무 검토됨(${by})`, cls: "status-green", title: `법무 검토됨 — ${by}. 최종 확정 전` };
  }
  return { status, label: "AI 작성·검토 전", cls: "status-amber", title: DRAFT_AI_MARKER };
}

export interface DraftAiSummary {
  in_scope: number;
  draft_ai: number;
}

interface WorkspaceLike {
  domains: Array<{ items: Array<ReviewFields & { scope?: { judgeable: boolean } }> }>;
}

/** Counts in-scope checklist items (excluded-by-track items skipped) that are still draft-AI. */
export function draftAiSummary(view: WorkspaceLike): DraftAiSummary {
  let inScope = 0;
  let draft = 0;
  for (const d of view.domains) {
    for (const i of d.items) {
      if (i.scope && !i.scope.judgeable) continue;
      inScope++;
      if (reviewStatusOf(i) === "draft-AI") draft++;
    }
  }
  return { in_scope: inScope, draft_ai: draft };
}
