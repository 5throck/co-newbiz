// @version 1.0.0
/**
 * Unit tests for gradeChain() (db/lib/chain-grading.ts) — meeting M4
 * decisions D-M4-1/D-M4-2/D-M4-3. The first test below is the design's own
 * worked example (crankshaft -> engine -> ship) and is the single most
 * important regression test in this codebase: if it ever grades C instead
 * of B, the M4 correction has silently regressed back to the naive
 * "total hop count" framing the meeting explicitly rejected.
 */

import { test, expect } from "bun:test";
import { gradeChain, type Hop } from "../../db/lib/chain-grading.ts";

test("design's own worked example: crankshaft->engine (engineering) + engine->ship (statistical, R2>=0.6) grades B, not C", () => {
  const hops: Hop[] = [
    { hopType: "engineering", betaOrCoefficient: 4.2 }, // crankshafts per engine — fixed physical fact
    { hopType: "statistical", betaOrCoefficient: 0.59, r2: 0.87, ciLow: 0.49, ciHigh: 0.69 }, // engine -> ship demand
  ];
  const result = gradeChain(hops);
  expect(result.grade).toBe("B");
  expect(result.rationale).toMatch(/M4 D-M4-2/);
});

test("all-engineering chain grades A with no CI to compound", () => {
  const hops: Hop[] = [
    { hopType: "engineering", betaOrCoefficient: 4.2 },
    { hopType: "engineering", betaOrCoefficient: 1.1 },
  ];
  const result = gradeChain(hops);
  expect(result.grade).toBe("A");
  expect(result.compoundedCiLow).toBeNull();
  expect(result.compoundedCiHigh).toBeNull();
});

test("a single statistical hop below R2=0.6 grades C, per D-M4-1", () => {
  const hops: Hop[] = [{ hopType: "statistical", betaOrCoefficient: 0.4, r2: 0.35, ciLow: 0.2, ciHigh: 0.6 }];
  const result = gradeChain(hops);
  expect(result.grade).toBe("C");
  expect(result.rationale).toMatch(/< 0\.6/);
});

test("two statistical hops grade C regardless of R2, per D-M4-1's multi-hop clause", () => {
  const hops: Hop[] = [
    { hopType: "statistical", betaOrCoefficient: 0.5, r2: 0.9, ciLow: 0.4, ciHigh: 0.6 },
    { hopType: "statistical", betaOrCoefficient: 0.3, r2: 0.85, ciLow: 0.25, ciHigh: 0.35 },
  ];
  const result = gradeChain(hops);
  expect(result.grade).toBe("C");
  expect(result.rationale).toMatch(/2 statistical hops/);
});

test("a single statistical hop at exactly R2=0.6 grades B (boundary inclusive)", () => {
  const hops: Hop[] = [{ hopType: "statistical", betaOrCoefficient: 0.5, r2: 0.6, ciLow: 0.4, ciHigh: 0.6 }];
  const result = gradeChain(hops);
  expect(result.grade).toBe("B");
});

test("CI compounds via quadrature, not simple addition (D-M4-3)", () => {
  // Two independent statistical hops (contrived: even though 2 stat hops
  // grades C, the CI-compounding math itself is tested here independent of
  // the grade outcome — quadrature should produce a NARROWER combined
  // relative width than simple addition would.
  const hops: Hop[] = [
    { hopType: "statistical", betaOrCoefficient: 0.5, r2: 0.9, ciLow: 0.4, ciHigh: 0.6 }, // relative half-width = 0.1/0.5 = 0.2
    { hopType: "statistical", betaOrCoefficient: 0.4, r2: 0.85, ciLow: 0.32, ciHigh: 0.48 }, // relative half-width = 0.08/0.4 = 0.2
  ];
  const result = gradeChain(hops);
  const pointProduct = 0.5 * 0.4; // 0.2
  const simpleAdditionRelativeWidth = 0.2 + 0.2; // 0.4 (what NOT to expect)
  const quadratureRelativeWidth = Math.sqrt(0.2 * 0.2 + 0.2 * 0.2); // ~0.2828

  const actualHalfWidth = (result.compoundedCiHigh! - result.compoundedCiLow!) / 2;
  const actualRelativeWidth = actualHalfWidth / pointProduct;

  expect(actualRelativeWidth).toBeCloseTo(quadratureRelativeWidth, 4);
  expect(actualRelativeWidth).toBeLessThan(simpleAdditionRelativeWidth);
});
