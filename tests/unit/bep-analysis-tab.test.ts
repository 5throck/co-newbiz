// 재무분석 탭 (BEP Analysis · 연도별 재무 명세, 2026-10-19 decider ask):
// deterministicCaseYearTable breaks the deterministic case into per-year
// 매출/운영비/설비투자/순현금흐름 matching the legacy FCF vector, respects the
// spending window (종료 이후 0), and the tab structure carries the new key.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import {
  deterministicCaseYearTable,
  deterministicCashflows,
  resolveBusinessCaseParamsDefaults,
  type BusinessCaseParams,
  type CaseInputs,
} from "../../app/web-next/lib/business-case-generator.ts";

/** Synthetic s5_plan_full inputs — reading the live dev db here made this test
 *  depend on local state AND on suite order (business-case.test.ts re-points
 *  CO_NEWBIZ_DB_PATH for the rest of the process). */
function inputsFor(basis: BusinessCaseParams["investmentBasis"], overrides?: Partial<CaseInputs>): CaseInputs {
  return {
    projectId: "01TESTPROJECT0000000000",
    marketSizeKrwM: 100000,
    anchorGrowth: 0.03,
    wacc: { value: 0.08, source: "default", assumption_id: null, run_id: null, as_of: null, rationale: null, anchor_ref: null },
    bcParams: { ...resolveBusinessCaseParamsDefaults(), investmentBasis: basis },
    s5Plan: {
      modelId: "model-1",
      horizonYears: 5,
      capexByYear: [2200, 2000, 0, 0, 0],
      laborOpexByYear: [6360, 6360, 6360, 6360, 6360],
      govRndByYear: [0, 0, 0, 0, 0],
      opexCovered: [true, true, true, true, true],
      skippedLines: 0,
      lineHash: "abc",
    },
    ...overrides,
  } as CaseInputs;
}

describe("deterministicCaseYearTable (재무분석 탭 데이터)", () => {
  test("per-year breakdown reconciles exactly with the legacy FCF vector", () => {
    const inputs = inputsFor("s5_plan_full");
    for (const scenario of ["base", "downside", "upside"] as const) {
      const legacy = deterministicCashflows(inputs, scenario);
      const t = deterministicCaseYearTable(inputs, scenario);
      expect(t.basis).toBe("s5_plan");
      expect(t.rows.map((r) => r.fcf)).toEqual(legacy);
      expect(t.rows[0].fcf).toBeLessThan(0);
      expect(t.npv).not.toBeNaN();
    }
    const base = deterministicCaseYearTable(inputs, "base");
    expect(base.initialInvestment).toBe(2200); // plan 연차 1 capex → year 0 (OD-3)
    expect(base.rows[1].capex).toBe(2000); // plan 연차 2 capex → cashflow year 1
    expect(base.bepYear === null || base.bepYear > 0).toBe(true); // payback depends on the revenue anchor
  });
  test("손익분기 매출 fires on fixed-opex years and solves each branch's fcf structure", () => {
    const plan = inputsFor("s5_plan_full");
    const t = deterministicCaseYearTable(plan, "base");
    const y1 = t.rows[1];
    // s5_plan branch: fcf = (rev − opex)·util − capex → BEP rev = opex + capex/util
    expect(y1.breakEvenRevenue).toBeCloseTo(y1.opex + y1.capex / y1.utilization, 6);
    expect(t.rows.every((r) => r.year === 0 || r.breakEvenRevenue !== null)).toBe(true);
    // ratio basis: opex is revenue-proportional — no break-even revenue exists
    const ratio = deterministicCaseYearTable(inputsFor("ratio"), "base");
    expect(ratio.rows.every((r) => r.year === 0 || r.breakEvenRevenue === null)).toBe(true);
    // s5_plan (non-full): covered flag irrelevant — opex stays ratio-based
    const nonFull = deterministicCaseYearTable(inputsFor("s5_plan"), "base");
    expect(nonFull.rows.every((r) => r.year === 0 || r.breakEvenRevenue === null)).toBe(true);
  });
  test("s5_pnl keeps the utilization-into-revenue break-even form", () => {
    const pnl = inputsFor("s5_pnl");
    const t = deterministicCaseYearTable(pnl, "base");
    const y1 = t.rows[1];
    // fcf = rev·util − opex − capex → BEP rev = (opex + capex)/util
    expect(y1.breakEvenRevenue).toBeCloseTo((y1.opex + y1.capex) / y1.utilization, 6);
  });
});

describe("S8 tab restructure: 재무분석 → 대상회사 + 신규 재무분석(bep) 탭", () => {
  const read = (f: string) => readFileSync(f, "utf8");

  test("stage-tabs carries 대상회사 (renamed) and the new 재무분석(bep) sub-tab", () => {
    const src = read("app/web-next/lib/stage-tabs.ts");
    expect(src).toContain('label: "대상회사"');
    expect(src).toContain('query: "bep", label: "재무분석"');
    const goals = read("app/web-next/lib/business-goals-view.ts");
    expect(goals).toContain('"bep"');
    expect(goals).toContain('"financial-analysis", "bep", "params"');
  });

  test("the stage renders the BEP panel; the old panel keeps its route", () => {
    const stage = read("app/web-next/components/stages/BusinessCaseStage.tsx");
    expect(stage).toContain('{tab === "bep" && <BepAnalysisPanel projectId={projectId} />}');
    expect(stage).toContain('label: "대상회사"');
    expect(read("app/web-next/components/stages/BepAnalysisPanel.tsx")).toContain("BEP Analysis");
  });

  test("the panel reads the scenario tables off the route payload's `scenarios` key (regression: flat read stuck the tab on 불러오는 중)", () => {
    const panel = read("app/web-next/components/stages/BepAnalysisPanel.tsx");
    expect(panel).toContain("interface BepPayload");
    expect(panel).toContain("r.data?.scenarios ?? null");
    // and the route actually nests the tables under `scenarios`
    const route = read("app/web-next/app/api/projects/[id]/business-case/bep/route.ts");
    expect(route).toContain("scenarios: Object.fromEntries");
  });
});
