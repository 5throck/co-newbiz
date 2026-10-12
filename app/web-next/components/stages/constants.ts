// Shared column-share presets for stage tables whose column count varies at
// runtime (conditional action columns). Each function returns a positive
// percentage array summing to 100 for any plausible column count — the
// table-sizing guard (tests/unit/table-sizing.test.ts) checks n = 1..20.

/** 설립 실행 단계 현황 (IcReviewStage) — 단계/상태/담당자/최근 기록/갱신 (+작업 when writable).
    n = 5 (read-only) → [26, 14, 20, 24, 16]; n = 6 (writable) → [22, 12, 15, 19, 10, 22]; other counts
    fall back to an equal split so the guard's 1..20 sweep always sums to 100. */
export function estStepColPct(n: number): number[] {
  if (n === 5) return [26, 14, 20, 24, 16];
  if (n === 6) return [22, 12, 15, 19, 10, 22];
  return Array.from({ length: Math.max(n, 1) }, () => 100 / Math.max(n, 1));
}
