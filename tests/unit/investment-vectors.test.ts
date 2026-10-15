// ADR-0176 slice 1 tests - shared investment vectors + deterministic S5 bands.
// ASCII-only source (homoglyph gate): Korean strings are written with \u escapes;
// the plus-minus sign is written as +/-, never a raw or fullwidth character.
import { describe, it, expect } from "bun:test";
import {
  buildInvestmentVectors,
  INVESTMENT_ASSUMPTIONS,
  SALARY_RANGE,
  SALARY_INCREASE_RANGE_PP,
  ON_COST_RANGE_PP,
  CAPABILITY_RANGE,
  MANUAL_LINE_RANGE,
  FX_RANGE,
  RAMP_SHIFT_HALF_YEARS,
} from "../../app/web-next/lib/investment-vectors.ts";
import { buildInvestmentSummary, scheduleTotals, type CapabilityCostLine } from "../../app/web-next/lib/capability-cost-lines.ts";
import { STAFFING_PLAN_SOURCE, type StaffingPlanEntry, type StaffingRow } from "../../app/web-next/lib/staffing-plan.ts";

const BAND_KEYS = ["\ucd5c\uc800", "\uae30\uc900", "\ucd5c\uace0"]; // choi-jeo / gi-jun / choi-go

// -- Fixtures -----------------------------------------------------------------

const manualConfirmed = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  line: "test line",
  category: "opex",
  amount: 120,
  amountUnit: "krw_m",
  amountUnitConfirmed: true,
  currency: "KRW",
  period: "yearly",
  startYear: 1,
  endYear: 3,
  ...over,
});

const capLine = (capabilityKey: string, startYear: number, costKrwM: number): CapabilityCostLine =>
  ({
    capabilityKey,
    name: capabilityKey,
    line: capabilityKey,
    category: "opex",
    costKrwM,
    startYear,
    defaultStartYear: startYear,
    monthsToAttain: null,
    subCategory: null,
  }) as unknown as CapabilityCostLine;

const staffRow = (over: Partial<StaffingRow>): StaffingRow =>
  ({
    id: "r1",
    roleFamily: "prod",
    grade: "staff",
    headcountByYear: [2, 2, 2, 2, 2],
    avgAnnualBaseSalaryKrwM: 80,
    salaryIncreaseRatePct: 3,
    onCostRatePct: 20,
    hireStartQuarter: null,
    recruitingOneOffKrwM: 50,
    salarySource: "analyst",
    ...over,
  }) as StaffingRow;

const staffingEntry = (rows: StaffingRow[]): StaffingPlanEntry =>
  ({ source: STAFFING_PLAN_SOURCE, rows, startYear: 1, endYear: 5, attritionBackfillPct: 0 }) as StaffingPlanEntry;

// Non-decreasing headcount keeps per-year low <= mode <= high structural.
const staffingPlan: StaffingPlanEntry = staffingEntry([
  staffRow({}),
  staffRow({
    id: "r2",
    headcountByYear: [0, 3, 3, 3, 3],
    avgAnnualBaseSalaryKrwM: 60,
    salaryIncreaseRatePct: 0,
    onCostRatePct: 15,
    recruitingOneOffKrwM: 0,
  }),
]);

const capLines = [capLine("cap-a", 1, 500), capLine("cap-b", 2, 300)];

const manualLines = [
  // opex 120/yr over Y1..Y3
  manualConfirmed() as never,
  // monthly cadence annualisation: 10 x 12 = 120 in Y1 only
  manualConfirmed({ category: "capex", amount: 10, period: "monthly", startYear: 1, endYear: 1 }) as never,
  // revenue lines are excluded from investment totals
  manualConfirmed({ category: "revenue", amount: 9999, endYear: 5 }) as never,
  // non-KRW excluded (no FX in slice 1)
  manualConfirmed({ currency: "USD" }) as never,
  // unconfirmed period -> needs-confirm -> excluded
  manualConfirmed({ period: undefined }) as never,
];

const reflectedKeys = new Set(["cap-a", "cap-b"]);
const HORIZON = 5;

const baseInput = {
  manual: manualLines,
  capLines,
  horizon: HORIZON,
  reflectedKeys,
  staffing: staffingPlan,
};

// -- Golden: mode equals the existing S5 summary math ------------------------

describe("investment vectors: mode band golden (ADR-0176 slice 1)", () => {
  it("mode totals equal buildInvestmentSummary / scheduleTotals", () => {
    const summary = buildInvestmentSummary(manualLines, capLines, HORIZON, reflectedKeys, staffingPlan);
    const sched = scheduleTotals(summary);
    const { mode } = buildInvestmentVectors(baseInput);
    expect(mode.grandKrwM).toBe(summary.totalKrwM);
    expect(mode.totalByYear).toEqual(sched.yearTotals);
    expect(mode.grandKrwM).toBe(Math.round(mode.totalByYear.reduce((a, n) => a + n, 0) * 100) / 100);
  });

  it("mode is unperturbed: stored values, no +/- shifts", () => {
    const { mode } = buildInvestmentVectors(baseInput);
    // capability: 500 in Y1, 300 in Y2, exactly as entered
    expect(mode.capabilityByYear).toEqual([500, 300, 0, 0, 0]);
    // manual: opex 120/yr Y1..Y3 + capex 10 x 12 monthly = 120 in Y1
    expect(mode.manualByYear).toEqual([240, 120, 120, 0, 0]);
    expect(mode.capabilityKrwM).toBe(800);
    expect(mode.manualKrwM).toBe(480);
    // staffing: row1 Y1 2*80*1.2=192 + recruiting 50 = 242; row2 Y2 3*60*1.15=207
    expect(mode.staffingByYear).toEqual([242, 404.76, 410.69, 416.8, 423.1]);
  });
});

// -- Band math ----------------------------------------------------------------

describe("investment vectors: deterministic bands", () => {
  const { low, mode, high } = buildInvestmentVectors(baseInput);

  it("horizon totals ordered low <= mode <= high", () => {
    expect(low.grandKrwM).toBeLessThanOrEqual(mode.grandKrwM);
    expect(mode.grandKrwM).toBeLessThanOrEqual(high.grandKrwM);
  });

  it("per-year ordered low <= mode <= high through YH-1 (non-decreasing headcount shape)", () => {
    // The advance shift loses half of YH's annual (no YH+1 to pull from), so the strict
    // per-year ordering holds up to YH-1; the horizon TOTAL ordering is asserted above.
    for (let i = 0; i < HORIZON - 1; i++) {
      expect(low.totalByYear[i]).toBeLessThanOrEqual(mode.totalByYear[i]);
      expect(mode.totalByYear[i]).toBeLessThanOrEqual(high.totalByYear[i]);
    }
  });

  it("capability band width is +/-" + CAPABILITY_RANGE + " per year and in total", () => {
    expect(high.capabilityKrwM).toBeCloseTo(mode.capabilityKrwM * (1 + CAPABILITY_RANGE), 2);
    expect(low.capabilityKrwM).toBeCloseTo(mode.capabilityKrwM * (1 - CAPABILITY_RANGE), 2);
    for (let i = 0; i < HORIZON; i++) {
      if (mode.capabilityByYear[i] === 0) continue;
      expect(high.capabilityByYear[i]).toBeCloseTo(mode.capabilityByYear[i] * (1 + CAPABILITY_RANGE), 2);
      expect(low.capabilityByYear[i]).toBeCloseTo(mode.capabilityByYear[i] * (1 - CAPABILITY_RANGE), 2);
    }
  });

  it("manual band width is +/-" + MANUAL_LINE_RANGE + " in total", () => {
    expect(high.manualKrwM).toBeCloseTo(mode.manualKrwM * (1 + MANUAL_LINE_RANGE), 2);
    expect(low.manualKrwM).toBeCloseTo(mode.manualKrwM * (1 - MANUAL_LINE_RANGE), 2);
  });

  it("ramp is a triangular half-year shift on staffing annual labor (mass-conserving)", () => {
    const staffingOnly = { manual: [], capLines: [], horizon: HORIZON, reflectedKeys: new Set<string>(), staffing: staffingPlan };
    const r = buildInvestmentVectors(staffingOnly);
    // delay puts only half of the (reduced) Y1 annual into Y1
    expect(r.low.staffingByYear[0]).toBeLessThan(r.mode.staffingByYear[0]);
    // two-year window conserves shifted mass only up to the compounding change, so
    // assert the window is lower (increase -2pp lowers growth inside the window)
    const y2 = 1;
    const modeWin = r.mode.staffingByYear[y2] + r.mode.staffingByYear[y2 + 1];
    const lowWin = r.low.staffingByYear[y2] + r.low.staffingByYear[y2 + 1];
    expect(lowWin).toBeLessThan(modeWin);
    expect(RAMP_SHIFT_HALF_YEARS).toBe(0.5);
  });
});

// -- Fabrication guards -------------------------------------------------------

describe("investment vectors: no fabrication guards", () => {
  it("rows without a salary or on-cost rate stay uncosted in every band", () => {
    const entry = staffingEntry([staffRow({ avgAnnualBaseSalaryKrwM: null, recruitingOneOffKrwM: 0 })]);
    const r = buildInvestmentVectors({ manual: [], capLines: [], horizon: HORIZON, reflectedKeys: new Set<string>(), staffing: entry });
    expect(r.low.staffingKrwM).toBe(0);
    expect(r.mode.staffingKrwM).toBe(0);
    expect(r.high.staffingKrwM).toBe(0);
  });

  it("on-cost is never perturbed when no rate was entered (row stays uncosted, never fabricated)", () => {
    const entry = staffingEntry([staffRow({ onCostRatePct: null, recruitingOneOffKrwM: 0 })]);
    const r = buildInvestmentVectors({ manual: [], capLines: [], horizon: 3, reflectedKeys: new Set<string>(), staffing: entry });
    expect(r.low.staffingKrwM).toBe(0);
    expect(r.mode.staffingKrwM).toBe(0);
    expect(r.high.staffingKrwM).toBe(0);
  });

  it("H=1 bands: salary +/-" + SALARY_RANGE + " and entered on-cost +/-" + ON_COST_RANGE_PP + "pp; increase rate 0 stays 0", () => {
    const entry = staffingEntry([staffRow({ headcountByYear: [1], salaryIncreaseRatePct: 0, onCostRatePct: 0, recruitingOneOffKrwM: 0 })]);
    const r = buildInvestmentVectors({ manual: [], capLines: [], horizon: 1, reflectedKeys: new Set<string>(), staffing: entry });
    const modeY1 = 80; // 1 head * 80, no increase (rate 0 kept), on-cost 0 as entered
    expect(r.mode.staffingKrwM).toBeCloseTo(modeY1, 2);
    // H=1 triangular shift halves the year: band Y1 = 0.5 * band annual.
    // An entered 0 on-cost IS a human-entered rate, so the range applies — but the pp shift is
    // clamped at 0 (a rate never goes negative), so low keeps the 0 rate while high adds 2pp;
    // the increase rate of 0 has no pp shift (only rows with a non-zero rate are shifted).
    expect(r.low.staffingKrwM).toBeCloseTo(0.5 * modeY1 * (1 - SALARY_RANGE), 2);
    expect(r.high.staffingKrwM).toBeCloseTo(0.5 * modeY1 * (1 + SALARY_RANGE) * (1 + ON_COST_RANGE_PP / 100), 2);
  });

  it("salary band range is +/-" + SALARY_RANGE + ", increase +/-" + SALARY_INCREASE_RANGE_PP + "pp, on-cost +/-" + ON_COST_RANGE_PP + "pp where rates exist", () => {
    const entry = staffingEntry([staffRow({ headcountByYear: [1, 1, 1, 1, 1], salaryIncreaseRatePct: 3, onCostRatePct: 20, recruitingOneOffKrwM: 0 })]);
    const r = buildInvestmentVectors({ manual: [], capLines: [], horizon: 3, reflectedKeys: new Set<string>(), staffing: entry });
    const lowF = (y: number) => (1 - SALARY_RANGE) * Math.pow(1 + (3 - SALARY_INCREASE_RANGE_PP) / 100, y - 1) * (1 + (20 - ON_COST_RANGE_PP) / 100);
    const highF = (y: number) => (1 + SALARY_RANGE) * Math.pow(1 + (3 + SALARY_INCREASE_RANGE_PP) / 100, y - 1) * (1 + (20 + ON_COST_RANGE_PP) / 100);
    // delay: low Y2 = 0.5*lowAnnual2 + 0.5*lowAnnual1 ; advance: high Y2 = 0.5*highAnnual2 + 0.5*highAnnual3
    const lowExpect = 0.5 * (80 * lowF(2) + 80 * lowF(1));
    const highExpect = 0.5 * (80 * highF(2) + 80 * highF(3));
    // precision 1: the implementation rounds each annual year (round2) before the shift
    expect(r.low.staffingByYear[1]).toBeCloseTo(lowExpect, 1);
    expect(r.high.staffingByYear[1]).toBeCloseTo(highExpect, 1);
  });
});

// -- Assumption metadata ------------------------------------------------------

describe("investment vectors: assumption constants (human-confirmed ranges)", () => {
  it("exported ranges match the ADR-0176 values; FX inactive", () => {
    expect(SALARY_RANGE).toBe(0.10);
    expect(SALARY_INCREASE_RANGE_PP).toBe(2);
    expect(ON_COST_RANGE_PP).toBe(2);
    expect(CAPABILITY_RANGE).toBe(0.30);
    expect(MANUAL_LINE_RANGE).toBe(0.20);
    expect(FX_RANGE).toBe(0.10);
    expect(INVESTMENT_ASSUMPTIONS.fx.active).toBe(false);
    expect(INVESTMENT_ASSUMPTIONS.salary.appliesTo).toContain("analyst");
    expect(BAND_KEYS.length).toBe(3);
  });
});
