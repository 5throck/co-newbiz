// @version 1.0.0
/** S5 investment chart data builder (pure, no DB, no browser): years, stacks, composition, cumulative, inflow, empty. */
import { test, expect, describe } from "bun:test";

const cl = await import("../../app/web-next/lib/capability-cost-lines.ts");
const sp = await import("../../app/web-next/lib/staffing-plan.ts");

const line = (o: Record<string, unknown>) => ({ line: "x", amount: 100, amountUnit: "krw_m", amountUnitConfirmed: true, amountKrwM: 100, currency: "KRW", ...o }) as any;
const build = (lines: any[], h = 3, staffing: any = null) => cl.buildInvestmentChartData(cl.buildInvestmentSummary(lines, [], h, new Set(), staffing));

describe("buildInvestmentChartData", () => {
  test("years, per-category stacks and cumulative follow the summary schedule", () => {
    const d = build([
      line({ category: "capex", period: "lumpsum", startYear: 1, amount: 300, amountKrwM: 300 }),
      line({ category: "opex", period: "yearly", startYear: 2, endYear: 3, amount: 50, amountKrwM: 50 }),
    ]);
    expect(d.years).toEqual(["Y1", "Y2", "Y3"]);
    expect(d.stacks.capex).toEqual([300, 0, 0]);
    expect(d.stacks.opex).toEqual([0, 50, 50]);
    expect(d.stacks.labor).toEqual([0, 0, 0]);
    expect(d.cumulative).toEqual([300, 350, 400]);
    expect(d.totalKrwM).toBe(400);
  });
  test("composition shares sum to the total with one-decimal percentages", () => {
    const d = build([
      line({ category: "capex", period: "lumpsum", amount: 200, amountKrwM: 200 }),
      line({ category: "opex", period: "lumpsum", amount: 100, amountKrwM: 100 }),
    ]);
    const capex = d.composition.find((c) => c.category === "capex")!;
    expect(capex.label).toBe("설비투자");
    expect(capex.totalKrwM).toBe(200);
    expect(capex.percent).toBe(66.7);
    expect(d.composition.find((c) => c.category === "opex")!.percent).toBe(33.3);
    expect(d.composition.find((c) => c.category === "labor")!.percent).toBe(0);
  });
  test("staffing-derived labour is inside the labour stack and reported separately", () => {
    const v = sp.normalizeStaffingPlanEntry({ source: "staffing_plan", rows: [{ id: "r1", roleFamily: "A", grade: "B", headcountByYear: [5, 10, 10], avgAnnualBaseSalaryKrwM: 60, salaryIncreaseRatePct: 0, onCostRatePct: 20 }] }, 3) as any;
    const d = build([line({ category: "labor", period: "lumpsum", amount: 100, amountKrwM: 100 })], 3, v.entry);
    expect(d.stacks.labor).toEqual([460, 720, 720]);
    expect(d.staffingLaborKrwM).toBe(1800);
    expect(d.composition.find((c) => c.category === "labor")!.totalKrwM).toBe(1900);
  });
  test("revenue and gov R&D stay out of the investment stacks and cumulative", () => {
    const d = build([
      line({ category: "opex", period: "lumpsum", amount: 10, amountKrwM: 10 }),
      line({ category: "revenue", period: "yearly", amount: 500, amountKrwM: 500 }),
      line({ category: "gov_rnd", period: "lumpsum", amount: 70, amountKrwM: 70 }),
    ]);
    expect(d.revenue).toEqual([500, 500, 500]);
    expect(d.govRnd).toEqual([70, 0, 0]);
    expect(d.cumulative).toEqual([10, 10, 10]);
    expect(d.totalKrwM).toBe(10);
  });
  test("needs-confirm rows are excluded and counted; rounding stays at two decimals", () => {
    const d = build([
      line({ category: "opex", period: "lumpsum", amount: 0.333, amountKrwM: 0.333 }),
      line({ category: "capex", period: "lumpsum", amountUnitConfirmed: false }),
    ]);
    expect(d.excludedNeedsConfirm).toBe(1);
    expect(d.stacks.opex[0]).toBe(0.33);
  });
  test("empty: nothing to plot", () => {
    const d = build([]);
    expect(d.hasData).toBe(false);
    expect(d.totalKrwM).toBe(0);
    expect(d.composition.every((c) => c.percent === 0)).toBe(true);
    expect(d.cumulative).toEqual([0, 0, 0]);
  });
  test("inflow only still counts as data", () => {
    expect(build([line({ category: "revenue", period: "yearly" })]).hasData).toBe(true);
  });
});
