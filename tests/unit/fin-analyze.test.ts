// @version 1.0.0
/**
 * Unit tests for fin:analyze (scripts/co-newbiz/fin-analyze.ts), which
 * shells out to python/kpi.py (reused from co-consult, design v1.0 §4-4).
 * Runs the real subprocess against a real fixture — this is an integration
 * test in spirit, kept under tests/unit/ since it has no DB dependency.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { computeKpis } from "../../scripts/co-newbiz/fin-analyze.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "fixtures", "canonical-model-sample.json");

test("computes profitability KPIs for every year", async () => {
  const report = (await computeKpis(FIXTURE)) as any;
  expect(report.meta.company).toBe("Test Marine Engine Co.");
  expect(Object.keys(report.kpi)).toEqual(["2023", "2024", "2025"]);
  expect(report.kpi["2023"].profitability.gross_margin.value).toBe(30);
  expect(report.kpi["2023"].profitability.operating_margin.value).toBe(8);
});

test("first year has no YoY growth (no prior year)", async () => {
  const report = (await computeKpis(FIXTURE)) as any;
  expect(report.kpi["2023"].growth.revenue_yoy.value).toBeNull();
  expect(report.kpi["2023"].growth.revenue_yoy.note).toBe("no prior year");
});

test("second year computes real YoY growth", async () => {
  const report = (await computeKpis(FIXTURE)) as any;
  // revenue 1000 -> 1100 = +10%
  expect(report.kpi["2024"].growth.revenue_yoy.value).toBe(10);
});

test("third year computes 3-year CAGR matching an independent calculation", async () => {
  const report = (await computeKpis(FIXTURE)) as any;
  // (1250/1000)^(1/3) - 1 = 7.7%
  expect(report.kpi["2025"].growth.revenue_3yr_cagr.value).toBe(7.7);
});

test("leverage ratios are computed from balance-sheet fields", async () => {
  const report = (await computeKpis(FIXTURE)) as any;
  // total_liabilities 820 / total_equity 600 = 1.3667 -> rounds to 1.37
  expect(report.kpi["2025"].leverage_liquidity.de_ratio.value).toBe(1.37);
});

test("throws a clear error for a missing file", async () => {
  await expect(computeKpis("tests/fixtures/does-not-exist.json")).rejects.toThrow(/not found/);
});
