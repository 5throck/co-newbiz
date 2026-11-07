// S3 linkage tab — merge the per-analysis market summaries by industry so the same industry never prints twice,
// and flag implausible gap values. Nothing is dropped: differing values are kept as a min–max range.

export type MarketSummaryInput = { industry: string; cagrPct: number | null; gapPct: number | null };

export type MergedMarketSummary = {
  industry: string;
  cagrMin: number | null;
  cagrMax: number | null;
  gapMin: number | null;
  gapMax: number | null;
  /** More than one source row was merged into this entry. */
  merged: boolean;
  /** At least one gap value has an absolute value above GAP_OUTLIER_ABS_PCT. */
  gapOutlier: boolean;
};

/** |gapPct| above this is shown as an outlier needing verification. */
export const GAP_OUTLIER_ABS_PCT = 100;

function span(values: number[]): [number | null, number | null] {
  return values.length === 0 ? [null, null] : [Math.min(...values), Math.max(...values)];
}

export function mergeMarketSummaries(list: MarketSummaryInput[]): MergedMarketSummary[] {
  const groups = new Map<string, MarketSummaryInput[]>();
  for (const m of list) {
    const key = m.industry.trim();
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  return [...groups.entries()].map(([industry, rows]) => {
    const [cagrMin, cagrMax] = span(rows.flatMap((r) => (r.cagrPct === null ? [] : [r.cagrPct])));
    const gaps = rows.flatMap((r) => (r.gapPct === null ? [] : [r.gapPct]));
    const [gapMin, gapMax] = span(gaps);
    return {
      industry,
      cagrMin,
      cagrMax,
      gapMin,
      gapMax,
      merged: rows.length > 1,
      gapOutlier: gaps.some((g) => Math.abs(g) > GAP_OUTLIER_ABS_PCT),
    };
  });
}

/** "4.5" or "4.5–5.5"; null when there is no value. */
export function formatRange(min: number | null, max: number | null, signed = false): string | null {
  if (min === null || max === null) return null;
  const f = (n: number) => `${signed && n > 0 ? "+" : ""}${n}`;
  return min === max ? f(min) : `${f(min)}–${f(max)}`;
}
