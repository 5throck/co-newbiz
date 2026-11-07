import { describe, expect, test } from "bun:test";
import { formatRange, mergeMarketSummaries } from "../../app/web-next/lib/synergy-market-summary.ts";

describe("mergeMarketSummaries", () => {
  test("merges duplicate industries into a min–max range without dropping values", () => {
    const [m, other] = mergeMarketSummaries([
      { industry: "산업·제조 전력수요 산업", cagrPct: 4.5, gapPct: 10 },
      { industry: "다른 산업", cagrPct: null, gapPct: null },
      { industry: "산업·제조 전력수요 산업", cagrPct: 5.5, gapPct: 20 },
    ]);
    expect(m.merged).toBe(true);
    expect(formatRange(m.cagrMin, m.cagrMax)).toBe("4.5–5.5");
    expect(formatRange(m.gapMin, m.gapMax, true)).toBe("+10–+20");
    expect(other.merged).toBe(false);
    expect(formatRange(other.cagrMin, other.cagrMax)).toBeNull();
  });

  test("single value formats without a range; negative gap keeps its sign", () => {
    expect(formatRange(4.5, 4.5)).toBe("4.5");
    expect(formatRange(-3, -3, true)).toBe("-3");
  });

  test("flags |gap| > 100 as an outlier, in either direction, and keeps the value", () => {
    const [a] = mergeMarketSummaries([{ industry: "A", cagrPct: 1, gapPct: 4356.8 }]);
    expect(a.gapOutlier).toBe(true);
    expect(a.gapMax).toBe(4356.8);
    expect(mergeMarketSummaries([{ industry: "A", cagrPct: 1, gapPct: -120 }])[0].gapOutlier).toBe(true);
    expect(mergeMarketSummaries([{ industry: "A", cagrPct: 1, gapPct: 100 }])[0].gapOutlier).toBe(false);
  });
});
