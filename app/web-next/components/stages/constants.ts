// Shared column-share presets for stage tables whose column count varies at
// runtime (conditional action columns). Each function returns a positive
// percentage array summing to 100 for any plausible column count — the
// table-sizing guard (tests/unit/table-sizing.test.ts) checks n = 1..20.

/** 설립 실행 단계 현황 (IcReviewStage) — 단계/상태/담당자/갱신 (+작업 when writable).
    n = 4 → [30, 20, 30, 20]; n = 5 → [24, 14, 24, 12, 26]; other counts fall back
    to an equal split so the guard's 1..20 sweep always sums to 100. */
export function estStepColPct(n: number): number[] {
  if (n === 4) return [30, 20, 30, 20];
  if (n === 5) return [24, 14, 24, 12, 26];
  return Array.from({ length: Math.max(n, 1) }, () => 100 / Math.max(n, 1));
}
