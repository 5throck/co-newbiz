// ADR-0176 slice 2 tests - seeded Monte Carlo over the S5 investment plan.
// ASCII-only source (homoglyph gate): Korean via \u escapes, plus-minus written as +/-.
import { describe, it, expect } from "bun:test";
import {
  clampDraws, DEFAULT_DRAWS, MIN_DRAWS, MAX_DRAWS, HISTOGRAM_BINS,
  percentile, simulateInvestment, simulationInputHash, triangular, validateEnvelope,
} from "../../app/web-next/lib/investment-simulation.ts";
import { buildInvestmentVectors } from "../../app/web-next/lib/investment-vectors.ts";
import { mulberry32 } from "../../app/web-next/lib/calibration-sweep.ts";
import { STAFFING_PLAN_SOURCE, type StaffingPlanEntry, type StaffingRow } from "../../app/web-next/lib/staffing-plan.ts";
import type { CapabilityCostLine } from "../../app/web-next/lib/capability-cost-lines.ts";

const manualConfirmed = (over: Record<string, unknown> = {}): never =>
  ({ line: "l", category: "opex", amount: 120, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, endYear: 3, ...over }) as never;

const capLine = (capabilityKey: string, startYear: number, costKrwM: number): CapabilityCostLine =>
  ({ capabilityKey, name: capabilityKey, line: capabilityKey, category: "opex", costKrwM, startYear, defaultStartYear: startYear, monthsToAttain: null, subCategory: null }) as unknown as CapabilityCostLine;

const staffRow = (over: Partial<StaffingRow>): StaffingRow =>
  ({ id: "r1", roleFamily: "prod", grade: "staff", headcountByYear: [2, 2, 2, 2, 2], avgAnnualBaseSalaryKrwM: 80, salaryIncreaseRatePct: 3, onCostRatePct: 20, hireStartQuarter: null, recruitingOneOffKrwM: 50, salarySource: "analyst", ...over }) as StaffingRow;

const staffingOf = (rows: StaffingRow[]): StaffingPlanEntry =>
  ({ source: STAFFING_PLAN_SOURCE, rows, startYear: 1, endYear: 5, attritionBackfillPct: 0 }) as StaffingPlanEntry;

const plan = staffingOf([staffRow({}), staffRow({ id: "r2", headcountByYear: [0, 3, 3, 3, 3], avgAnnualBaseSalaryKrwM: 60, salaryIncreaseRatePct: 0, onCostRatePct: 15, recruitingOneOffKrwM: 0 })]);

const baseInput = {
  manual: [manualConfirmed(), manualConfirmed({ category: "capex", amount: 10, period: "monthly", startYear: 1, endYear: 1 })],
  capLines: [capLine("cap-a", 1, 500), capLine("cap-b", 2, 300)],
  horizon: 5,
  reflectedKeys: new Set(["cap-a", "cap-b"]),
  staffing: plan as StaffingPlanEntry | null,
};
const SEED = 20261015;

describe("clamp, envelope, triangular, percentile primitives", () => {
  it("clampDraws defaults to 500 and clamps to 100..5000", () => {
    expect(DEFAULT_DRAWS).toBe(500);
    expect(clampDraws(undefined)).toBe(500);
    expect(clampDraws(null)).toBe(500);
    expect(clampDraws(Number.NaN)).toBe(500);
    expect(clampDraws(10)).toBe(MIN_DRAWS);
    expect(clampDraws(99999)).toBe(MAX_DRAWS);
    expect(clampDraws(750.4)).toBe(750);
    expect(simulateInvestment({ ...baseInput, seed: SEED, draws: 3 }).draws).toBe(100);
    expect(simulateInvestment({ ...baseInput, seed: SEED, draws: 9e9 }).draws).toBe(5000);
  });

  it("validateEnvelope accepts absent or finite > 0 only", () => {
    expect(validateEnvelope(undefined)).toBeNull();
    expect(validateEnvelope(null)).toBeNull();
    expect(validateEnvelope(1)).toBeNull();
    for (const bad of [0, -1, Number.NaN, Infinity, "5", {}]) expect(validateEnvelope(bad)).not.toBeNull();
    expect(() => simulateInvestment({ ...baseInput, seed: SEED, envelopeKrwM: -3 })).toThrow();
  });

  it("triangular stays inside [min,max], honours the mode, and consumes one rng value even when degenerate", () => {
    const rng = mulberry32(42);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const x = triangular(rng, 0.7, 1, 1.3);
      expect(x).toBeGreaterThanOrEqual(0.7);
      expect(x).toBeLessThanOrEqual(1.3);
      sum += x;
    }
    expect(Math.abs(sum / n - 1.0)).toBeLessThan(0.01); // symmetric: mean = (min+mode+max)/3 = 1
    const skew = mulberry32(7);
    let s2 = 0;
    for (let i = 0; i < n; i++) s2 += triangular(skew, 0, 1, 4);
    expect(Math.abs(s2 / n - 5 / 3)).toBeLessThan(0.05);
    const a = mulberry32(5), b = mulberry32(5);
    expect(triangular(a, 1, 1, 1)).toBe(1);
    b();
    expect(a()).toBe(b());
  });

  it("percentile interpolates linearly", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.25)).toBe(2.5);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("simulateInvestment", () => {
  it("is deterministic for the same seed and inputs, and moves with the seed", () => {
    const a = simulateInvestment({ ...baseInput, seed: SEED });
    const b = simulateInvestment({ ...baseInput, seed: SEED });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = simulateInvestment({ ...baseInput, seed: SEED + 1 });
    expect(c.total.p50).not.toBe(a.total.p50);
    expect(a.draws).toBe(500);
    expect(a.horizon).toBe(5);
    expect(a.totalByYear.length).toBe(5);
    expect(a.total.histogram.counts.length).toBe(HISTOGRAM_BINS);
    expect(a.total.histogram.counts.reduce((x, y) => x + y, 0)).toBe(500);
  });

  it("bands are ordered and sit inside the slice-1 deterministic low/high extremes around the mode", () => {
    const r = simulateInvestment({ ...baseInput, seed: SEED, draws: 2000 });
    const v = buildInvestmentVectors(baseInput);
    expect(r.mode.grandKrwM).toBe(v.mode.grandKrwM);
    expect(r.total.p05).toBeLessThanOrEqual(r.total.p50);
    expect(r.total.p50).toBeLessThanOrEqual(r.total.p95);
    expect(r.total.min).toBeGreaterThanOrEqual(v.low.grandKrwM - 0.05);
    expect(r.total.max).toBeLessThanOrEqual(v.high.grandKrwM + 0.05);
    expect(Math.abs(r.total.p50 - v.mode.grandKrwM) / v.mode.grandKrwM).toBeLessThan(0.05);
    for (const b of r.totalByYear) { expect(b.p05).toBeLessThanOrEqual(b.p50); expect(b.p50).toBeLessThanOrEqual(b.p95); }
    expect(r.byCategory.capability.total.p50).toBeGreaterThan(0);
    expect(r.byCategory.capability.byYear.length).toBe(5);
  });

  it("zero-width ranges collapse every band onto the deterministic mode", () => {
    const zero = { salaryRange: 0, salaryIncreaseRangePp: 0, onCostRangePp: 0, rampShiftHalfYears: 0, capabilityRange: 0, manualLineRange: 0 };
    const r = simulateInvestment({ ...baseInput, seed: SEED, draws: 100, overrides: zero });
    const mode = buildInvestmentVectors(baseInput).mode.grandKrwM;
    expect(r.total.p05).toBeCloseTo(mode, 1);
    expect(r.total.p50).toBeCloseTo(mode, 1);
    expect(r.total.p95).toBeCloseTo(mode, 1);
    expect(r.tornado.every((t) => t.swingKrwM === 0 && !t.active)).toBe(true);
  });

  it("tornado is ranked by swing, matches the analytic capability/manual swings, and keeps FX inert last", () => {
    const r = simulateInvestment({ ...baseInput, seed: SEED });
    const swings = r.tornado.map((t) => t.swingKrwM);
    expect(swings).toEqual([...swings].sort((a, b) => b - a));
    const cap = r.tornado.find((t) => t.key === "capability")!;
    const man = r.tornado.find((t) => t.key === "manualLines")!;
    expect(cap.swingKrwM).toBeCloseTo(800 * 0.6, 1); // +/-30% of 800
    expect(man.swingKrwM).toBeCloseTo(480 * 0.4, 1); // +/-20% of 360 + 120
    expect(cap.lowKrwM).toBeLessThan(cap.highKrwM);
    expect(r.tornado[0].key).toBe("capability");
    const fx = r.tornado.find((t) => t.key === "fx")!;
    expect(fx.swingKrwM).toBe(0);
    expect(fx.active).toBe(false);
    expect(r.tornado[r.tornado.length - 1].key).toBe("fx");
    expect(r.assumptions.fx).toEqual({ range: 0.1, active: false });
    const shares = r.tornado.reduce((a, t) => a + t.share, 0);
    expect(shares).toBeGreaterThan(0.97);
    expect(shares).toBeLessThan(1.03);
  });

  it("exceed probability: absent without an envelope; 0 above the max; 1 below the min; about half at p50", () => {
    const none = simulateInvestment({ ...baseInput, seed: SEED });
    expect(none.exceed).toBeNull();
    const hi = simulateInvestment({ ...baseInput, seed: SEED, envelopeKrwM: 1e9 });
    expect(hi.exceed).toEqual({ envelopeKrwM: 1e9, probability: 0, exceedCount: 0 });
    const lo = simulateInvestment({ ...baseInput, seed: SEED, envelopeKrwM: 1 });
    expect(lo.exceed!.probability).toBe(1);
    expect(lo.exceed!.exceedCount).toBe(500);
    const mid = simulateInvestment({ ...baseInput, seed: SEED, draws: 2000, envelopeKrwM: none.total.p50 });
    expect(mid.exceed!.probability).toBeGreaterThan(0.35);
    expect(mid.exceed!.probability).toBeLessThan(0.65);
    expect(mid.exceed!.exceedCount / mid.draws).toBeCloseTo(mid.exceed!.probability, 3);
    // The envelope never changes the distribution itself.
    expect(JSON.stringify({ ...hi, exceed: null })).toBe(JSON.stringify(none));
  });

  it("never fabricates a salary: rows without an entered salary stay uncosted in every draw", () => {
    const noSalary = staffingOf([staffRow({ avgAnnualBaseSalaryKrwM: null, recruitingOneOffKrwM: 0 })]);
    const r = simulateInvestment({ ...baseInput, staffing: noSalary, seed: SEED });
    expect(r.byCategory.staffing.total).toEqual({ p05: 0, p50: 0, p95: 0 });
    expect(r.tornado.find((t) => t.key === "salary")!.active).toBe(false);
    // Widening the salary range changes nothing for a plan with no salary base.
    const wide = simulateInvestment({ ...baseInput, staffing: noSalary, seed: SEED, overrides: { salaryRange: 5 } });
    expect(wide.byCategory.staffing.total).toEqual({ p05: 0, p50: 0, p95: 0 });
    // No staffing plan at all: nothing staffing-related exists.
    const none = simulateInvestment({ ...baseInput, staffing: null, seed: SEED });
    expect(none.byCategory.staffing.total).toEqual({ p05: 0, p50: 0, p95: 0 });
    expect(none.tornado.filter((t) => ["salary", "salaryIncrease", "onCost", "ramp"].includes(t.key)).every((t) => !t.active)).toBe(true);
  });

  it("with an analyst-entered salary the salary variable only range-shifts that base", () => {
    const r = simulateInvestment({ ...baseInput, seed: SEED, draws: 1000 });
    const sal = r.tornado.find((t) => t.key === "salary")!;
    expect(sal.active).toBe(true);
    const v = buildInvestmentVectors(baseInput);
    expect(r.byCategory.staffing.total.p05).toBeLessThan(v.mode.staffingKrwM);
    expect(r.byCategory.staffing.total.p95).toBeGreaterThan(v.mode.staffingKrwM);
  });

  it("input hash tracks the plan, ranges, seed and draws but not the envelope", () => {
    const h = simulationInputHash(baseInput, SEED, 500);
    expect(simulationInputHash(baseInput, SEED, 500)).toBe(h);
    expect(simulationInputHash(baseInput, SEED + 1, 500)).not.toBe(h);
    expect(simulationInputHash(baseInput, SEED, 600)).not.toBe(h);
    expect(simulationInputHash({ ...baseInput, overrides: { capabilityRange: 0.5 } }, SEED, 500)).not.toBe(h);
    expect(simulationInputHash({ ...baseInput, capLines: [capLine("cap-a", 1, 501), capLine("cap-b", 2, 300)] }, SEED, 500)).not.toBe(h);
    expect(simulationInputHash({ ...baseInput, staffing: null }, SEED, 500)).not.toBe(h);
  });
});
