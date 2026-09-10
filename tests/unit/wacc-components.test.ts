// @version 1.0.0
/** ADR-0115 — CAPM/WACC component math, validation, and derivation assembly. */

import { test, expect } from "bun:test";
import {
  assembleDerivation,
  capmComponentGaps,
  capmCostOfEquity,
  formatPct,
  hamadaRelever,
  hamadaUnlever,
  validateComponentInput,
  weightsFromDe,
  WaccComponentValidationError,
} from "../../db/lib/wacc-components.ts";

const SAMPLE = {
  "wacc.risk_free": 0.0335,
  "wacc.erp": 0.063,
  "wacc.size_premium": 0.015,
  "wacc.beta_levered": 1.35,
  "wacc.observed_de": 0.9,
  "wacc.target_de": 0.6,
  "wacc.tax_rate": 0.22,
  "wacc.debt_spread": 0.021,
};

test("hamada unlever/relever round-trips at the same D/E", () => {
  const u = hamadaUnlever(1.35, 0.9, 0.22);
  expect(u).toBeCloseTo(1.35 / (1 + 0.78 * 0.9), 12);
  expect(hamadaRelever(u, 0.9, 0.22)).toBeCloseTo(1.35, 12);
});

test("regression path re-levers βU to the target structure and never rounds intermediates", () => {
  const d = assembleDerivation(SAMPLE);
  const betaU = hamadaUnlever(1.35, 0.9, 0.22);
  const betaL = hamadaRelever(betaU, 0.6, 0.22);
  expect(d.betaPath).toBe("regression_relevered");
  expect(d.computed.betaUnlevered).toBeCloseTo(betaU, 12);
  expect(d.computed.betaLevered).toBeCloseTo(betaL, 12);
  expect(d.computed.ke).toBeCloseTo(capmCostOfEquity(0.0335, betaL, 0.063, 0.015), 12);
  // ~12.19% — the intermediate beta keeps full precision (display rounds, math must not)
  expect(Math.abs(d.computed.ke! * 100 - 12.19)).toBeLessThan(0.01);
});

test("WACC blends weighted equity and after-tax debt exactly as the formula states", () => {
  const d = assembleDerivation(SAMPLE);
  const { we, wd } = weightsFromDe(0.6);
  expect(we).toBeCloseTo(0.625, 12);
  expect(wd).toBeCloseTo(0.375, 12);
  const kd = 0.0335 + 0.021;
  const expected = we * d.computed.ke! + wd * kd * (1 - 0.22);
  expect(d.computed.wacc).toBeCloseTo(expected, 12);
  const waccStep = d.steps.find((s) => s.item === "WACC");
  expect(waccStep).toBeDefined();
  // substitution strings carry the actual numbers so deliverables show the "how"
  expect(waccStep!.substitution).toContain("×12.19%");
});

test("direct loan rate replaces the rating-spread path", () => {
  const d = assembleDerivation({ ...SAMPLE, "wacc.debt_spread": undefined, "wacc.cost_of_debt": 0.058 } as Record<string, number>);
  expect(d.computed.kd).toBe(0.058);
  expect(d.steps.find((s) => s.item.startsWith("타인자본비용"))!.formula).toContain("직접 입력");
});

test("peer path starts from an already-unlevered beta and skips the unlever step", () => {
  const d = assembleDerivation({
    "wacc.risk_free": 0.0335,
    "wacc.erp": 0.063,
    "wacc.beta_unlevered": 0.84,
    "wacc.target_de": 0.6,
    "wacc.tax_rate": 0.22,
    "wacc.debt_spread": 0.021,
  });
  expect(d.betaPath).toBe("peer_unlevered");
  expect(d.steps.find((s) => s.item.includes("비레버드"))).toBeUndefined();
  expect(d.steps.find((s) => s.item.includes("타겟 레버드"))).toBeDefined();
  expect(d.computed.betaLevered).toBeCloseTo(hamadaRelever(0.84, 0.6, 0.22), 12);
});

test("levered beta without observed D/E is used as-is and labelled", () => {
  const d = assembleDerivation({
    "wacc.risk_free": 0.0335,
    "wacc.erp": 0.063,
    "wacc.beta_levered": 1.2,
    "wacc.target_de": 0.6,
    "wacc.tax_rate": 0.22,
    "wacc.debt_spread": 0.021,
  });
  expect(d.betaPath).toBe("levered_direct");
  expect(d.computed.betaLevered).toBe(1.2);
});

test("empty input yields no steps, a null WACC, and a Korean missing list", () => {
  const d = assembleDerivation({});
  expect(d.steps).toHaveLength(0);
  expect(d.computed.wacc).toBeNull();
  expect(d.missing.length).toBeGreaterThan(0);
  expect(d.missing.some((m) => m.includes("무위험이자율"))).toBe(true);
});

test("beta_r2 and volume stats never enter the math but survive the component map", () => {
  const d = assembleDerivation({ ...SAMPLE, "wacc.beta_r2": 0.68, "wacc.beta_vol_asset": 0.284, "wacc.beta_vol_market": 0.172 });
  // no step consumes them; WACC unchanged vs SAMPLE
  const baseline = assembleDerivation(SAMPLE);
  expect(d.computed.wacc).toBeCloseTo(baseline.computed.wacc!, 12);
});

test("validateComponentInput enforces key/kind/range/evidence-ref", () => {
  expect(() => validateComponentInput({ key: "wacc.discount", value: 0.1, kind: "user" })).toThrow(WaccComponentValidationError);
  expect(() => validateComponentInput({ key: "wacc.erp", value: 0.063, kind: "assumed" })).toThrow(/kind/);
  expect(() => validateComponentInput({ key: "wacc.beta_levered", value: -0.5, kind: "derived" })).toThrow(/positive/);
  expect(() => validateComponentInput({ key: "wacc.tax_rate", value: 1.1, kind: "user" })).toThrow(/\[0, 1\)/);
  expect(() => validateComponentInput({ key: "wacc.erp", value: -0.01, kind: "live" })).toThrow(/non-negative/);
  expect(() =>
    validateComponentInput({ key: "wacc.risk_free", value: 0.0335, kind: "live", anchorRef: "cim.pdf#p12" }),
  ).toThrow(WaccComponentValidationError);
  // the happy path passes
  expect(() =>
    validateComponentInput({ key: "wacc.risk_free", value: 0.0335, kind: "live", anchorRef: "https://ecos.bok.or.kr" }),
  ).not.toThrow();
});

test("capmComponentGaps names exactly what blocks a derivable session", () => {
  expect(capmComponentGaps([])).toEqual([
    "wacc.risk_free",
    "wacc.erp",
    "wacc.tax_rate",
    "wacc.target_de",
    "wacc.beta_unlevered | wacc.beta_levered",
    "wacc.cost_of_debt | wacc.debt_spread",
  ]);
  expect(
    capmComponentGaps([
      { key: "wacc.risk_free", value: 0.03 },
      { key: "wacc.erp", value: 0.06 },
      { key: "wacc.tax_rate", value: 0.22 },
      { key: "wacc.target_de", value: 0.6 },
      { key: "wacc.beta_levered", value: 1.2 },
      { key: "wacc.debt_spread", value: 0.02 },
    ]),
  ).toEqual(["wacc.observed_de (wacc.beta_levered을 비레버드 환산하려면 필요)"]);
});

test("formatPct renders registry decimals the way the UI shows them", () => {
  expect(formatPct(0.0335)).toBe("3.35%");
  expect(formatPct(0.092128)).toBe("9.21%");
});
