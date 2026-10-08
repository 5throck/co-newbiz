// R2-C 7: numbers produced without a model (offline / deterministic synthesis) must never read as
// facts, and degenerate values (CAGR -100%, $0 from empty inputs) must say "산정 불가" instead.
// Pure helpers shared by the S1/S2 screens and the insights API.

export const SYNTHETIC_BADGE_TEXT = "합성 추정 (검증 안 됨)";
export const NOT_COMPUTABLE_TEXT = "산정 불가";

interface StepSummaryLike {
  source?: string;
}

/** True when the version was filled (in whole or part) by deterministic synthesis instead of an LLM run. */
export function isSyntheticSizing(stepSummaries: ReadonlyArray<StepSummaryLike> | null | undefined): boolean {
  if (!stepSummaries || stepSummaries.length === 0) return false;
  return stepSummaries.some((s) => s.source !== "llm");
}

/** A growth rate that carries no information: missing, non-finite, or -100% (everything vanishes). */
export function isDegeneratePct(pct: number | null | undefined): boolean {
  return pct == null || !Number.isFinite(pct) || pct <= -99.5;
}

/** A market size that carries no information: missing, non-finite, or not above zero. */
export function isDegenerateSize(value: number | null | undefined): boolean {
  return value == null || !Number.isFinite(value) || value <= 0;
}

export function formatPctOrNa(pct: number | null | undefined, digits = 1): string {
  return isDegeneratePct(pct) ? NOT_COMPUTABLE_TEXT : `${(pct as number).toFixed(digits)}%`;
}

export function formatUsdBOrNa(value: number | null | undefined): string {
  return isDegenerateSize(value) ? NOT_COMPUTABLE_TEXT : `$${Math.round(value as number).toLocaleString()}B`;
}
