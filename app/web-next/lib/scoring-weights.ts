// Scoring methodology dataset (ADR-0102 hybrid scoring) — DATA, not logic.
//
// Per the profile-first principle (ADR-0024/0044) tunable methodology
// parameters live here instead of being scattered through TypeScript
// literals. This module holds the workspace-wide DEFAULTS; it is the single
// place to tune the synergy score without touching scoring code, and the
// natural seam for a future industry-profile / region-profile override
// (profile data would merge over these defaults at load time).
//
// Do not add computation here — consumers (lib/synergy-score.ts) apply these
// numbers. Changing any value changes scores; keep tests/unit/synergy-score.test.ts
// in sync when re-tuning.

/** Factor base weights before renormalization over available factors. */
export const SYNERGY_FACTOR_WEIGHTS = {
  market_attractiveness: 0.35,
  industry_match: 0.3,
  financial_capacity: 0.2,
  scope_match: 0.15,
} as const;

/**
 * Market-attractiveness piecewise curve (CAGR fraction → 0-100).
 * Anchors: 0% → 0, mid → 50, high → 100 (capped).
 *   below the breakpoint: linear 0 → 50 over [0, cagrMidpoint]
 *   above: linear 50 → 100 over [cagrMidpoint, cagrMidpoint + cagrUpperSpan]
 */
export const MARKET_ATTRACTIVENESS_CURVE = {
  /** CAGR fraction mapping to the midpoint score (50). */
  cagrMidpoint: 0.08,
  /** CAGR fraction span above the midpoint that reaches the max score. */
  cagrUpperSpan: 0.27,
  /** Score at the midpoint breakpoint. */
  midpointScore: 50,
} as const;

/** Financial-capacity factor shape (latest DART ratios). */
export const FINANCIAL_CAPACITY_PARAMS = {
  /** Score baseline before ratio points/penalty are applied. */
  base: 45,
  /** Debt-ratio penalty: clamp((debt - debtFloor) * debtPenaltySlope, -maxPenalty, maxPenalty). */
  debtFloor: 0.4,
  debtPenaltySlope: 180,
  debtPenaltyMin: -40,
  debtPenaltyMax: 40,
  /** ROE fraction → points: clamp(roe * roeSlope, 0, 100). */
  roeSlope: 350,
  /** Operating-margin fraction → points: clamp(margin * marginSlope, 0, 100). */
  marginSlope: 300,
  /** Contribution of each points block inside the factor. */
  roeContribution: 0.5,
  marginContribution: 0.3,
} as const;
