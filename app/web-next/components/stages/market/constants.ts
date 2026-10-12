// Table column sizing presets for the S1 market screens
// (2026-10-11-table-column-sizing-system, batch 2).

/**
 * 경쟁 구조 — 주요 기업 (SizingMarketTabs) — 산업 적응형 동적 컬럼 프리셋.
 * 첫 열(기업) 16%, 마지막 열(비고) 20% 고정, 가운데 열(포지션·기술유형·용량·
 * 진행상태·속성 컬럼) 합 64%를 열 수에 맞춰 균등 분할한다.
 */
export function competitiveColPct(extra: number): number[] {
  if (extra <= 0) return [80, 20];
  const first = 16;
  const last = 20;
  const share = Math.floor((64 / extra) * 100) / 100;
  const middles = Array.from({ length: extra }, () => share);
  middles[extra - 1] = Math.round((100 - first - last - share * (extra - 1)) * 100) / 100;
  return [first, ...middles, last];
}
