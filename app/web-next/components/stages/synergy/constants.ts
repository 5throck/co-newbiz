// Shared column-share presets for synergy tables whose column count varies at
// runtime (conditional 작업 column when the viewer can curate). Each function
// returns positive percentages summing to 100 for any plausible column count —
// the table-sizing guard (tests/unit/table-sizing.test.ts) sweeps n = 1..20.

/** 우선 시너지 영역 (SynergyTabs shortlist) — 순위/영역/판정/사유/출처 (+작업 when curatable). */
export function shortlistColPct(n: number): number[] {
  if (n === 5) return [8, 24, 12, 40, 16];
  if (n === 6) return [7, 21, 11, 35, 14, 12];
  return Array.from({ length: Math.max(n, 1) }, () => 100 / Math.max(n, 1));
}
