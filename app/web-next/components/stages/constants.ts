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

/** 인력 운영 계획 표 (StaffingPlanSection) — 직무군/직급/연봉/인상률/가산율/일회비/상태/작업의
    고정 8열이 68%를 차지하고, horizon 개수만큼 늘어나는 연차 열이 남은 32%를 균등 분배한다.
    반올림 오차는 마지막 열이 흡수해 어떤 n에서도 합계 100(±0.01)을 유지한다. */
export function staffingColPct(n: number): number[] {
  const years = Math.max(1, n);
  const yearPct = Math.round((32 / years) * 100) / 100;
  const widths = [9, 7, ...Array.from({ length: years }, () => yearPct), 9, 7, 7, 9, 13, 7];
  const sum = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] = Math.round((widths[widths.length - 1] + 100 - sum) * 100) / 100;
  return widths;
}
