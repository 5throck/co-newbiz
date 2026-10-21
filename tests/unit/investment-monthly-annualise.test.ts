// Regression: monthly (and quarterly) manual cost lines are annualised (x12 / x4) on every active
// year before they reach the yearly plan, by-category table, tiles, totals and chart series.
// Fixtures go through the same path the UI uses: POSTed payload -> normalizeBusinessCaseLines
// (what saveInvestmentLines persists) -> normalizeLegacyLine (what the stage loads) -> builders.
import { test, expect, describe } from "bun:test";

const cl = await import("../../app/web-next/lib/capability-cost-lines.ts");

const A = 10; // per-month amount, million KRW
const H = 5;
const NOW = "2026-10-15T00:00:00Z";

/** Round-trip a posted manual line exactly as the UI saves and reloads it. */
function persistAndLoad(lines: Array<Record<string, unknown>>): ReturnType<typeof cl.normalizeLegacyLine>[] {
  const res = cl.normalizeBusinessCaseLines([{ source: "plan_meta", horizonYears: H }, ...lines], [], null, { userId: "u", at: NOW });
  if (!res.ok) throw new Error(res.error.message);
  return (res.lines as Array<Record<string, unknown>>).filter((l) => !cl.isPlanMetaEntry(l)).map(cl.normalizeLegacyLine);
}

const uiLine = (o: Record<string, unknown> = {}) => ({ line: "rent", category: "opex", amount: A, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "monthly", ...o });

function all(manual: ReturnType<typeof persistAndLoad>) {
  const summary = cl.buildInvestmentSummary(manual, [], H, new Set());
  const totals = cl.investmentTotals(cl.deriveCapabilityCostLines([], null), new Set(), manual, null, H);
  const chart = cl.buildInvestmentChartData(summary);
  return { summary, totals, chart };
}

describe("monthly opex is annualised in every view", () => {
  test("blank start/end year: every year = 12*A, totals = 12*A*H, chart equals the table", () => {
    const manual = persistAndLoad([uiLine()]);
    expect(manual[0].period).toBe("monthly");
    const { summary, totals, chart } = all(manual);
    for (const s of summary.schedule) { expect(s.opex).toBe(12 * A); expect(s.investmentTotal).toBe(12 * A); }
    expect(summary.totalKrwM).toBe(12 * A * H);
    expect(summary.annualRecurringKrwM).toBe(12 * A);
    expect(summary.byCategory.find((r) => r.category === "opex")).toEqual({ category: "opex", annualKrwM: 12 * A, lumpsumKrwM: 0, totalKrwM: 12 * A * H });
    expect(totals.manualKrwM).toBe(12 * A * H);
    expect(totals.grandKrwM).toBe(12 * A * H);
    expect(chart.stacks.opex).toEqual(Array(H).fill(12 * A));
    expect(chart.cumulative[H - 1]).toBe(12 * A * H);
    expect(chart.totalKrwM).toBe(12 * A * H);
  });

  test("start/end window Y2..Y4: active years = 12*A, others 0, total = 12*A*3", () => {
    const { summary, totals, chart } = all(persistAndLoad([uiLine({ startYear: 2, endYear: 4 })]));
    expect(summary.schedule.map((s) => s.opex)).toEqual([0, 12 * A, 12 * A, 12 * A, 0]);
    expect(summary.totalKrwM).toBe(12 * A * 3);
    expect(totals.manualKrwM).toBe(12 * A * 3);
    expect(chart.stacks.opex).toEqual([0, 12 * A, 12 * A, 12 * A, 0]);
  });

  test("period spelled as Korean/English variants or legacy fields is recognised and annualised", () => {
    const variants: Array<Record<string, unknown>> = [
      { period: "\uC6D4" }, { period: "\uB9E4\uC6D4" }, { period: "Monthly" }, { period: "month" }, { period: " MONTHLY " },
      { period: undefined, cadence: "monthly" }, { period: undefined, periodicity: "\uC6D4" }, { period: undefined, frequency: "month" },
    ];
    for (const v of variants) {
      const manual = persistAndLoad([uiLine(v)]);
      expect(manual[0].period).toBe("monthly");
      const { summary, totals } = all(manual);
      expect(summary.schedule.map((s) => s.opex)).toEqual(Array(H).fill(12 * A));
      expect(totals.manualKrwM).toBe(12 * A * H);
      expect(summary.excludedNeedsConfirm).toBe(0);
    }
    expect(cl.normalizePeriod("\uBD84\uAE30")).toBe("quarterly");
    expect(cl.normalizePeriod("annual")).toBe("yearly");
    expect(cl.normalizePeriod("\uC77C\uC2DC\uBD88")).toBe("lumpsum");
    expect(cl.normalizePeriod("weekly")).toBeUndefined();
  });

  test("a stale stored amountKrwM never overrides the edited amount (client view and server save)", () => {
    const edited = uiLine({ amount: 20, amountKrwM: A });
    expect(cl.manualLineKrwM(edited)).toBe(20);
    const manual = persistAndLoad([edited]);
    expect(manual[0].amountKrwM).toBe(20);
    expect(all(manual).summary.totalKrwM).toBe(12 * 20 * H);
  });

  test("per-row readout uses the same helper: annual = 12*A, total = 12*A*years", () => {
    const [m] = persistAndLoad([uiLine({ startYear: 2 })]);
    expect(cl.manualLineAmounts(m, H)).toEqual({ annualKrwM: 12 * A, totalKrwM: 12 * A * 4 });
    const [q] = persistAndLoad([uiLine({ period: "quarterly" })]);
    expect(cl.manualLineAmounts(q, H)).toEqual({ annualKrwM: 4 * A, totalKrwM: 4 * A * H });
    const [ls] = persistAndLoad([uiLine({ period: "lumpsum", startYear: 3 })]);
    expect(cl.manualLineAmounts(ls, H)).toEqual({ annualKrwM: null, totalKrwM: A });
  });

  test("monthly revenue inflow is annualised too and stays out of the investment total", () => {
    const { summary, chart } = all(persistAndLoad([uiLine({ category: "revenue" })]));
    expect(summary.schedule.map((s) => s.revenue)).toEqual(Array(H).fill(12 * A));
    expect(summary.totalKrwM).toBe(0);
    expect(chart.revenue).toEqual(Array(H).fill(12 * A));
  });

  test("capability lump sum and staffing labour combine with the monthly line without double-annualising", () => {
    const manual = persistAndLoad([uiLine()]);
    const view = cl.deriveCapabilityCostLines([{ id: "k1", capability: "cap", resolution: "build", category: null, closing_cost_krw_m: 300, months_to_attain: 0, grade: "high", confirmed_at: NOW, stale: false, period: null }], [{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 300, amountUnit: "krw_m", amountUnitConfirmed: true }]);
    const staffing = { source: "staffing_plan" as const, startYear: 1, endYear: H, attritionBackfillPct: 0, rows: [{ id: "r1", roleFamily: "ops", grade: "staff", headcountByYear: [1, 2, 2, 2, 2], avgAnnualBaseSalaryKrwM: 50, salaryIncreaseRatePct: 0, onCostRatePct: 0, hireStartQuarter: null, recruitingOneOffKrwM: 0, salarySource: "analyst" }] };
    const keys = new Set(["k1"]);
    const summary = cl.buildInvestmentSummary(manual, view.lines, H, keys, staffing);
    expect(summary.schedule.map((s) => s.opex)).toEqual(Array(H).fill(12 * A));
    expect(summary.schedule.map((s) => s.labor)).toEqual([50, 100, 100, 100, 100]);
    expect(summary.capexSubtotalKrwM).toBe(300);
    const totals = cl.investmentTotals(view, keys, manual, staffing, H);
    expect(totals.grandKrwM).toBe(summary.totalKrwM);
    expect(summary.totalKrwM).toBe(12 * A * H + 450 + 300);
  });
});
