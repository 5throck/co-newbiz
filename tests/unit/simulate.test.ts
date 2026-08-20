// @version 1.0.0
/**
 * Unit tests for simulate (scripts/co-newbiz/simulate.ts / python/monte_carlo.py)
 * — ADR-0026 and design v1.0 section 12 verification item 13.
 */

import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { runSimulation } from "../../scripts/co-newbiz/simulate.ts";

const NO_LIABILITIES = resolve(import.meta.dirname, "..", "fixtures", "simulation-no-liabilities.json");
const WITH_LIABILITIES = resolve(import.meta.dirname, "..", "fixtures", "simulation-with-liabilities.json");

test("same seed and inputs reproduce an identical result (design §12 verification item 13)", async () => {
  const r1 = await runSimulation(WITH_LIABILITIES);
  const r2 = await runSimulation(WITH_LIABILITIES);
  expect(r1).toEqual(r2);
});

test("with zero contingent liabilities, the distribution collapses to the base NPV (std=0)", async () => {
  const result = await runSimulation(NO_LIABILITIES);
  expect(result.std).toBe(0);
  expect(result.p05).toBe(result.p50);
  expect(result.p50).toBe(result.p95);
});

test("adding contingent liabilities visibly thickens the downside tail (design §12's explicit test)", async () => {
  const base = await runSimulation(NO_LIABILITIES);
  const withLiabilities = await runSimulation(WITH_LIABILITIES);

  // Same base cash flows and discount rate -> same base_npv and same P95
  // (liabilities only ever subtract, so the best-case tail is unaffected).
  expect(withLiabilities.base_npv).toBe(base.base_npv);
  expect(withLiabilities.p95).toBe(base.p95);

  // The downside (P05) must be strictly worse once liabilities are modeled.
  expect(withLiabilities.p05).toBeLessThan(base.p05);
  expect(withLiabilities.std).toBeGreaterThan(0);
});

test("throws a clear error for a missing scenario file", async () => {
  await expect(runSimulation("tests/fixtures/does-not-exist.json")).rejects.toThrow(/not found/);
});
