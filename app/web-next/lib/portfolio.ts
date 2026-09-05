// S12 post-management helpers (ADR-0101 §4) — the review-cycle freshness
// vocabulary shared by process-flow's S12 completion predicate and the
// scorecard/transition-decision routes. The 'YYYY-Qn' shape is pinned by the
// migration-0024 GLOB CHECK, so cycles are lexicographically comparable and
// ordering arithmetic reduces to string comparison.
//
// Freshness choice (ADR-0101 §4: "a scorecard row exists for the latest
// recorded cycle and that cycle is not stale"): the project's
// MAX(review_cycle) is FRESH when it is the current quarter or the
// immediately previous quarter. Rationale: the review cadence is quarterly
// (portfolio-venture-monitoring), so a scorecard produced in the prior
// quarter is still the standing evidence for the current quarter's IC sitting
// — demanding the literal current quarter would mark S12 blocked for the
// first weeks of every quarter. Anything older than one full quarter is
// stale ("분기별 스코어카드가 갱신되었다" has lapsed) and yields a blocker
// naming the stale cycle.

/** 'YYYY-Qn' shape — mirrors the migration-0024 GLOB CHECK. */
export const REVIEW_CYCLE_RE = /^\d{4}-Q[1-4]$/;

export function isValidReviewCycle(cycle: string): boolean {
  return REVIEW_CYCLE_RE.test(cycle);
}

/** The quarter containing `now` (or a given date) as 'YYYY-Qn'. */
export function currentReviewCycle(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
}

/** The quarter `n` before `cycle` ('2026-Q1' shifted -1 → '2025-Q4'). */
export function shiftReviewCycle(cycle: string, n: number): string {
  if (!isValidReviewCycle(cycle)) throw new Error(`invalid review_cycle '${cycle}' — must match YYYY-Q[1-4]`);
  const zero = Number(cycle.slice(0, 4)) * 4 + (Number(cycle.slice(6, 7)) - 1) + n;
  return `${Math.floor(zero / 4)}-Q${(zero % 4) + 1}`;
}

/** A cycle is FRESH when it is the current or the immediately previous quarter. */
export function isFreshReviewCycle(cycle: string, now: Date = new Date()): boolean {
  if (!isValidReviewCycle(cycle)) return false;
  return cycle >= shiftReviewCycle(currentReviewCycle(now), -1);
}
