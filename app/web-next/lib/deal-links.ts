// Direct deal-stage links (design 2026-10-11-direct-deal-stage-links). Client-safe
// and pure: builds /deals/<id>/<sN> so callers never go through the flat-route
// redirect (/opportunities?opportunity=<id> always lands on S2).

const STAGE_SEGMENT = /^[sS]([1-9]|1[0-2])$/;

/** Opportunity status -> the stage tab that hosts that status (board convention). */
export const OPPORTUNITY_STATUS_STAGE: Record<string, string> = {
  identified: "S2",
  assessed: "S3",
  selected: "S4",
};

/** Stage label ("S3", "s3") -> tab segment ("s3"); null when not S1..S12. */
export function stageSegment(stage: string | null | undefined): string | null {
  if (!stage || !STAGE_SEGMENT.test(stage)) return null;
  return stage.toLowerCase();
}

/**
 * Deal-stage href. Unknown/empty stage falls back to the deal overview
 * (/deals/<id>), which resolves the carrier and shows the current stage.
 */
export function dealStageHref(id: string, stage?: string | null): string {
  const base = `/deals/${encodeURIComponent(id)}`;
  const seg = stageSegment(stage);
  return seg ? `${base}/${seg}` : base;
}

/** Href for an opportunity row by its status (identified=S2, assessed=S3, selected=S4). */
export function opportunityStatusHref(id: string, status?: string | null): string {
  return dealStageHref(id, status ? OPPORTUNITY_STATUS_STAGE[status] : null);
}
