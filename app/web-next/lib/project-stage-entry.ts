// Project-stage entry hrefs (S8–S12). Defect remediation 2 (2026-11-24, DEC-20261124-01,
// design 2026-11-21-s8-overview-tab): S8's canonical entry is the project page itself
// (/projects/{id} = the 개요 tab). Linking the bare /business-case route made the stage body
// paint the 재무적 타당성 lens for one frame before the redirect, so no entry link may target it.

/** Sub-route per project stage (the canonical screens under /projects/{id}/...). */
export const PROJECT_STAGE_PATH: Record<string, string> = {
  S8: "business-case",
  S9: "dd",
  S10: "deal-structure",
  S11: "ic-review",
  S12: "portfolio",
};

/** S8 entry with no explicit tab → the 개요 page. */
export function s8EntryHref(projectId: string): string {
  return `/projects/${projectId}`;
}

/** Href for a project stage reached from a deal-stage route. S8 with an empty query goes
 * straight to the 개요 page (one hop); a query is an explicit deep link and keeps the
 * stage route (`?tab=` must reach /business-case unchanged). */
export function projectStageHref(stageId: string, projectId: string, query: string): string {
  const pid = encodeURIComponent(projectId);
  if (stageId === "S8" && !query) return s8EntryHref(pid);
  return `/projects/${pid}/${PROJECT_STAGE_PATH[stageId]}${query ? `?${query}` : ""}`;
}
