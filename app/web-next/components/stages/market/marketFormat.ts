// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.

export const SEGMENT_COLORS = [0, 1, 2, 3, 4];
export const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const POSITION_LABELS: Record<string, string> = {
  upstream: "상류(원자재·부품)",
  midstream: "중류(조립·가공)",
  downstream: "하류(완제품·수요처)",
};

/** Anchor totals below $10B keep two decimals — Math.round turned $0.9B into "$1B" (user-manual D-13). */
export function fmtBillions(n: number): string {
  return Math.abs(n) >= 10 ? Math.round(n).toLocaleString() : n.toFixed(2);
}
