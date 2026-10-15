// Legacy business-case detection (UX round 2, R2-E).
// ADR-0143 (flow.spec v2.5.0) made brownfield S8 per-target (subjectScope:
// shortlist); projects promoted before it carry business_case_model rows with
// target_id NULL. The S8 predicate needs per-target market_forward models, so
// those legacy models do not count — yet the screen only said "Business
// Case가 필요합니다" with no hint why. This helper counts them so the screen
// can say so. Detection only: never migrate, backfill or auto-delete legacy
// rows (a human regenerates through the existing generate action).
// Pure function — no db import — so the unit test needs no fixture project.

export interface LegacyCaseProbe {
  target_id: string | null;
  /** ADR-0158: an archived legacy model no longer counts toward the notice. */
  archived_at?: string | null;
}

/** True when the project is shortlist-scoped (ADR-0143 brownfield): the S8 business-case response exposes target comparison rows. */
export function isShortlistScoped(targets: readonly unknown[]): boolean {
  return targets.length > 0;
}

/**
 * Count pre-ADR-0143 models (target_id NULL) on a shortlist-scoped project.
 * Returns 0 for greenfield (no target axis) — there NULL is the correct value,
 * not a legacy leftover.
 */
export function countLegacyUnassignedModels(cases: readonly LegacyCaseProbe[], targets: readonly unknown[]): number {
  if (!isShortlistScoped(targets)) return 0;
  return cases.filter((c) => c.target_id === null && !c.archived_at).length;
}

/**
 * The historical (past-based) variant is Brown Field comparison evidence only:
 * a Green Field has no target company, so only market_forward models are shown.
 * Stored historical rows are neither deleted nor archived here (a person decides);
 * the adopted model always stays visible so the adoption audit trail resolves.
 */
export function hideHistoricalForGreenfield<T extends { variant: string; adopted?: boolean }>(cases: readonly T[], greenfield: boolean): T[] {
  return greenfield ? cases.filter((c) => c.variant !== "historical" || c.adopted === true) : [...cases];
}
