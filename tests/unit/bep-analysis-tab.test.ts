// 재무분석 탭 (BEP Analysis · 연도별 재무 명세, 2026-10-19 decider ask):
// deterministicCaseYearTable breaks the deterministic case into per-year
// 매출/운영비/설비투자/순현금흐름 matching the legacy FCF vector, respects the
// spending window (종료 이후 0), and the tab structure carries the new key.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { caseInputsForProject, deterministicCaseYearTable, deterministicCashflows } from "../../app/web-next/lib/business-case-generator.ts";

describe("deterministicCaseYearTable (재무분석 탭 데이터)", () => {
  test("per-year breakdown reconciles exactly with the legacy FCF vector", () => {
    const inputs = caseInputsForProject("01M1MXQN21DP8KYHNW3GDSE4PW");
    const legacy = deterministicCashflows(inputs, "base");
    for (const scenario of ["base", "downside", "upside"] as const) {
      const t = deterministicCaseYearTable(inputs, scenario);
      expect(["ratio", "s5_plan", "s5_pnl"]).toContain(t.basis);
      const fcf = t.rows.map((r) => r.fcf);
      expect(fcf).toEqual(legacy.map((v) => v) && deterministicCashflows(inputs, scenario));
      expect(fcf[0]).toBeLessThan(0);
      expect(t.npv).not.toBeNaN();
    }
    const base = deterministicCaseYearTable(inputs, "base");
    expect(base.bepYear).not.toBeNull();
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
});
