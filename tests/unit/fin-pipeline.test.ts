// @version 1.0.0
/**
 * Unit tests for fin:pipeline (scripts/co-newbiz/fin-pipeline.ts), the full
 * DART -> validate -> normalize -> KPI chain, design v1.0 §4-4. Runs the
 * real subprocess chain against a real fixture — genuinely realistic DART
 * fnlttSinglAcntAll-shaped data (tests/fixtures/dart-sample.json), not a
 * pre-flattened canonical model.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { runFullPipeline } from "../../scripts/co-newbiz/fin-pipeline.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "fixtures", "dart-sample.json");

test("accounting-equation validation passes for a balanced fixture (Assets = Liabilities + Equity)", async () => {
  const { validation } = (await runFullPipeline(FIXTURE)) as any;
  const eqCheck = validation.checks.find((c: any) => c.rule === "accounting_equation");
  expect(eqCheck.status).toBe("pass");
  expect(eqCheck.residual).toBe(0);
});

test("normalize.py correctly converts raw won amounts to KRW billions", async () => {
  const { canonicalModel } = (await runFullPipeline(FIXTURE)) as any;
  expect(canonicalModel.meta.unit).toBe("KRW_billions");
  // 100,000,000,000 won -> 100.0 billion
  expect(canonicalModel.data["2025"].revenue).toBe(100.0);
  expect(canonicalModel.data["2025"].total_assets).toBe(142.0);
});

test("field-mapping coverage is reported and non-trivial", async () => {
  const { canonicalModel } = (await runFullPipeline(FIXTURE)) as any;
  expect(canonicalModel.meta.coverage.mapped).toBeGreaterThan(20);
  expect(canonicalModel.meta.coverage.coverage_pct).toBeGreaterThan(50);
});

test("KPI stage produces correct ratios chained from the normalized model", async () => {
  const { kpiReport } = (await runFullPipeline(FIXTURE)) as any;
  const p = kpiReport.kpi["2025"].profitability;
  // operating_income 13.0 / revenue 100.0 = 13%
  expect(p.operating_margin.value).toBe(13.0);
  // net_income 8.5 / revenue 100.0 = 8.5%
  expect(p.net_margin.value).toBe(8.5);
  // total_liabilities 82.0 / total_equity 60.0 = 1.3667 -> 1.37
  expect(kpiReport.kpi["2025"].leverage_liquidity.de_ratio.value).toBe(1.37);
});

test("cleans up its temporary canonical-model file after each run", async () => {
  await runFullPipeline(FIXTURE);
  const tmpPath = FIXTURE.replace(/\.json$/, ".canonical-model.tmp.json");
  expect(existsSync(tmpPath)).toBe(false);
});

test("throws a clear error for a missing DART file", async () => {
  await expect(runFullPipeline("tests/fixtures/does-not-exist.json")).rejects.toThrow(/not found/);
});
