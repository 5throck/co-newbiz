// @version 1.0.0
// Default target resolution for the per-target WACC / financial-analysis views
// (ADR-0156, amended 2026-10-09). Multi-target brownfield projects no longer
// offer a "프로젝트 기준" chip: the view always sits on a concrete target.
// The target bound on md_project.company_id IS the S8-selected target
// (business-case.ts syncs it on selection), so "isBound" marks the gate basis.

export interface TargetLike {
  targetId: string;
  isBound: boolean;
}

export interface TargetScope {
  /** Chip that is active in the selector; null when no selector applies. */
  activeId: string | null;
  /** target_id to send to the API; null = project-level (the gate-feeding view). */
  scopeId: string | null;
  /** No target is bound yet, so every view is per-target evidence, not the gate basis. */
  noGateBasis: boolean;
}

/** Bound (S8-selected) target first, else the first shortlisted target; null for <2 targets. */
export function resolveDefaultTargetId(targets: readonly TargetLike[]): string | null {
  if (targets.length < 2) return null;
  return (targets.find((t) => t.isBound) ?? targets[0]).targetId;
}

/**
 * `chosen` is the user's explicit pick (null = none yet). The bound target maps to the
 * project-level scope so gate semantics (ADR-0156 §2) are unchanged; any other target
 * is sent as target_id.
 */
export function resolveTargetScope(targets: readonly TargetLike[], chosen: string | null): TargetScope {
  if (targets.length < 2) return { activeId: null, scopeId: null, noGateBasis: false };
  const valid = chosen !== null && targets.some((t) => t.targetId === chosen) ? chosen : null;
  const activeId = valid ?? resolveDefaultTargetId(targets);
  const bound = targets.find((t) => t.isBound);
  const scopeId = activeId !== null && activeId !== bound?.targetId ? activeId : null;
  return { activeId, scopeId, noGateBasis: !bound };
}
