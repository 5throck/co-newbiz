// @version 1.0.0
/** ADR-0115 — pasted-series OLS beta regression and peer-median unlevering. */

import { test, expect } from "bun:test";
import {
  medianBetaUnlevered,
  olsBeta,
  parseSeriesInput,
  regressionFromText,
  scatterPoints,
  BetaRegressionError,
} from "../../db/lib/beta-regression.ts";

/** Deterministic series builder: asset return = beta × market return (perfect fit). */
function perfectSeries(beta: number): { rows: { date: string; price: number; indexPrice: number }[]; marketReturns: number[] } {
  const marketReturns = [0.01, -0.02, 0.015, -0.005, 0.008, -0.012, 0.02, -0.001, 0.004, 0.011, -0.017, 0.006];
  let price = 100;
  let index = 300;
  const rows = [{ date: "2026-01-01", price, indexPrice: index }];
  marketReturns.forEach((r, i) => {
    price *= 1 + beta * r;
    index *= 1 + r;
    rows.push({ date: `2026-01-${String(i + 2).padStart(2, "0")}`, price, indexPrice: index });
  });
  return { rows, marketReturns };
}

test("parseSeriesInput accepts CSV/TSV/semicolon, skips a header, and sorts by date", () => {
  const text = "date,price,index\n2026-09-02,101,301\n2026-09-01,100,300\n2026-09-03\t103\t304";
  const rows = parseSeriesInput(text);
  expect(rows).toHaveLength(3);
  expect(rows[0].date).toBe("2026-09-01");
  expect(rows[2].price).toBe(103);
});

test("parseSeriesInput refuses malformed rows and too-short series", () => {
  expect(() => parseSeriesInput("a,b\n1,2,3,4")).toThrow(/3 columns/);
  expect(() => parseSeriesInput("d,1,2\nd,2,x\nd,3,5\nd,4,6")).toThrow(/non-numeric/);
  expect(() => parseSeriesInput("d,1,2\nd,2,x\nd,3,5")).toThrow(/non-numeric/);
  expect(() => parseSeriesInput("2026-01-01,100,300\n2026-01-02,101,302")).toThrow(/at least 3/);
  expect(() => parseSeriesInput("d,0,300\nd,101,302\nd,102,303")).toThrow(/positive/);
});

test("olsBeta recovers the true beta with R²=1 on a perfectly proportional series", () => {
  const { rows, marketReturns } = perfectSeries(1.35);
  const r = olsBeta(rows);
  expect(r.beta).toBeCloseTo(1.35, 10);
  expect(r.r2).toBeCloseTo(1, 10);
  expect(r.alpha).toBeCloseTo(0, 10);
  expect(r.n).toBe(marketReturns.length);
  expect(r.windowStart).toBe("2026-01-01");
  // identical return scale → same annualized volatility
  expect(r.volRatio).toBeCloseTo(1.35, 10);
});

test("annualized volatility equals stdev(daily) × √252", () => {
  const { rows } = perfectSeries(1);
  const r = olsBeta(rows);
  const rets = rows.slice(1).map((row, i) => row.price / rows[i].price - 1);
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1));
  expect(r.annualVolAsset).toBeCloseTo(sd * Math.sqrt(252), 10);
  expect(r.annualVolMarket).toBeCloseTo(sd * Math.sqrt(252), 10);
});

test("olsBeta refuses degenerate series", () => {
  const flatMarket = [1, 2, 3].map((i) => ({ date: `2026-01-0${i}`, price: 100 + i, indexPrice: 300 }));
  expect(() => olsBeta(flatMarket)).toThrow(/zero variance/);
  expect(() => olsBeta([{ date: "a", price: 1, indexPrice: 1 }, { date: "b", price: 2, indexPrice: 2 }])).toThrow();
});

test("scatterPoints returns one (market, asset) pair per daily return", () => {
  const { rows } = perfectSeries(1.35);
  const pts = scatterPoints(rows);
  expect(pts).toHaveLength(rows.length - 1);
  expect(pts[0].y).toBeCloseTo(1.35 * pts[0].x, 10);
});

test("medianBetaUnlevered — odd picks the middle, even averages the middle pair", () => {
  const mk = (betaLevered: number, deRatio: number) => ({ label: `p${betaLevered}`, betaLevered, deRatio, taxRate: 0.22 });
  const odd = medianBetaUnlevered([mk(1.0, 0.5), mk(1.5, 0.5), mk(2.0, 0.5)]);
  expect(odd.median).toBeCloseTo(medianBetaUnlevered([mk(1.5, 0.5), mk(1.5, 0.5), mk(1.5, 0.5)]).median, 10);
  const even = medianBetaUnlevered([mk(1.0, 0.0), mk(2.0, 0.0)]);
  expect(even.median).toBe(1.5);
  expect(() => medianBetaUnlevered([{ label: "bad", betaLevered: 1, deRatio: -1, taxRate: 0.22 }])).toThrow(BetaRegressionError);
});

test("regressionFromText is the paste-to-result path the WACC page uses", () => {
  const { rows } = perfectSeries(1.35);
  const text = "date,price,index\n" + rows.map((r) => `${r.date},${r.price.toFixed(6)},${r.indexPrice.toFixed(6)}`).join("\n");
  const r = regressionFromText(text);
  expect(r.beta).toBeCloseTo(1.35, 6);
  expect(r.volRatio).toBeCloseTo(1.35, 6);
});
