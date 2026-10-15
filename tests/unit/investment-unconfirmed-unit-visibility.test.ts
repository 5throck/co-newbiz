// Regression: S5 opex lines stored with a unit but amountUnitConfirmed:false (live DB shape of the
// "key-account team opex" and "parts hub stock / 3PL" lines) were excluded from every total while
// the row's unit select already showed the unit, so the person could not see or fix the exclusion.
import { describe, expect, test } from "bun:test";
import * as cl from "../../app/web-next/lib/capability-cost-lines.ts";

const stored = [
  { line: "key-account \ud300 \uc6b4\uc601\ube44", category: "opex", amount: 9, amountUnit: "krw_m", amountUnitConfirmed: false, amountKrwM: null, currency: "KRW", period: "monthly", startYear: 1, endYear: 5, note: "", growthRate: 0.05 },
  { line: "\ubd80\ud488 \ud5c8\ube0c \uc7ac\uace0\u00b73PL", category: "opex", amount: 14, amountUnit: "krw_m", amountUnitConfirmed: false, amountKrwM: null, currency: "KRW", period: "monthly", startYear: 1, endYear: 5, note: "", growthRate: 0.03 },
];

describe("unconfirmed stored unit is shown as unset, never as chosen", () => {
  test("load clears the untrusted unit and keeps the amount and other fields", () => {
    const m = stored.map((l) => cl.normalizeLegacyLine(l));
    for (const [i, l] of m.entries()) {
      expect(l.amountUnit).toBeUndefined();
      expect(l.amountUnitConfirmed).toBe(false);
      expect(l.amount).toBe(stored[i].amount);
      expect(l.category).toBe("opex");
      expect(l.period).toBe("monthly");
      expect(cl.manualLineIssues(l)).toEqual(["unit"]);
    }
  });

  test("still excluded and counted until a unit is picked; no price or unit is invented", () => {
    const m = stored.map((l) => cl.normalizeLegacyLine(l));
    const view = cl.deriveCapabilityCostLines([], []);
    const t = cl.investmentTotals(view, new Set(), m, null, 5);
    expect(t.manualKrwM).toBe(0);
    expect(t.manualExcludedNeedsConfirm).toBe(2);
    const rows = cl.unifiedInvestmentRows(m, [], {});
    expect(rows.length).toBe(2);
    const footer = cl.unifiedFooter(rows, t);
    expect(footer.count).toBe(2);
    expect(footer.text).toContain("\ud655\uc778 \ud544\uc694 2\uac74");
  });

  test("picking the unit confirms the line and it enters the totals over the horizon", () => {
    const m = stored.map((l) => ({ ...cl.normalizeLegacyLine(l), amountUnit: "krw_m" as const, amountUnitConfirmed: true }));
    const view = cl.deriveCapabilityCostLines([], []);
    const t = cl.investmentTotals(view, new Set(), m, null, 5);
    expect(t.manualExcludedNeedsConfirm).toBe(0);
    expect(t.manualKrwM).toBe((9 + 14) * 12 * 5);
    const s = cl.buildInvestmentSummary(m, [], 5, new Set());
    expect(s.byCategory.find((r) => r.category === "opex")?.totalKrwM).toBe((9 + 14) * 12 * 5);
  });

  test("confirmed lines keep their unit on load", () => {
    const l = cl.normalizeLegacyLine({ ...stored[0], amountUnitConfirmed: true });
    expect(l.amountUnit).toBe("krw_m");
    expect(l.amountUnitConfirmed).toBe(true);
  });
});

describe("currency change keeps a confirmed unit or clears it", () => {
  test("confirmed KRW baek-man/eok map to the FX counterpart and stay confirmed", () => {
    expect(cl.unitOnCurrencyChange({ amountUnit: "krw_m", amountUnitConfirmed: true }, "USD")).toEqual({ amountUnit: "fx_m", amountUnitConfirmed: true });
    expect(cl.unitOnCurrencyChange({ amountUnit: "krw_eok", amountUnitConfirmed: true }, "USD")).toEqual({ amountUnit: "fx_eok", amountUnitConfirmed: true });
  });
  test("unconfirmed or unmappable units are cleared, never left looking chosen", () => {
    expect(cl.unitOnCurrencyChange({ amountUnit: "krw_m", amountUnitConfirmed: false }, "USD")).toEqual({ amountUnit: undefined, amountUnitConfirmed: false });
    expect(cl.unitOnCurrencyChange({ amountUnit: "krw_k", amountUnitConfirmed: true }, "USD")).toEqual({ amountUnit: undefined, amountUnitConfirmed: false });
  });
});

describe("S5 unit select highlight and excluded note are wired", async () => {
  const src = await Bun.file(new URL("../../app/web-next/components/stages/GreenfieldStage.tsx", import.meta.url)).text();
  test("unset unit select gets the highlight class; note carries the hint", () => {
    expect(src).toContain("invest-ctl-unset");
    expect(src).toContain("unitOnCurrencyChange(l, c)");
    expect(src).toContain("분류·주기·단위를 고르면 반영</p>");
  });
});
