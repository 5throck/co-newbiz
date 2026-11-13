// S8 scenario-metrics UX (ADR-0178 follow-up, 2026-10-16): IRR no-flow chip,
// greenfield column hygiene, and the capex-missing warning. Source-reading
// checks (display-only wiring) + pure unit tests of the derivations. ASCII-only:
// Korean string literals are \u escapes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planCapexTotalOf } from "../../app/web-next/lib/s5-plan-capex.ts";
import { s5ParamLinkage } from "../../app/web-next/lib/s5-linkage-labels.ts";
import type { InvestmentVectorsInput } from "../../app/web-next/lib/investment-vectors.ts";

const WEB = join(import.meta.dirname, "../../app/web-next");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");
// i18n (design 2026-10-23-i18n-ui-adoption): warning copy resolves through the
// catalog — wording pins below assert the key call site in the component source
// and the ko master catalog value (the original Korean label).
const koCatalog = await import("../../app/web-next/locales/ko.json");
const koOf = (key: string): string =>
  key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog) as string;

const STAGE = read("components/stages/BusinessCaseStage.tsx");
const CONNECT = read("components/business-case/S5ConnectBlock.tsx");
const PARAMS = read("components/business-case/ParamsPanel.tsx");

describe("IRR no-flow chip (scenario comparison)", () => {
  test("chip condition: irr null + s5 basis (s5_plan* or s5_pnl) + payload says plan capex zero", () => {
    // Whitespace-tolerant: biome format wraps the long const across lines; the
    // pin asserts the CONDITION, not the layout.
    expect(STAGE).toMatch(
      /const irrNoFlowChip =\s*irrV == null &&\s*\(nb\.startsWith\("s5_plan"\) \|\| nb === "s5_pnl"\) &&\s*data\?\.s5_plan_capex_zero === true;/,
    );
    expect(STAGE).toContain('const nb = note.basis ?? "";');
  });
  test("s5_pnl basis is covered (ADR-0178 slice 2) alongside s5_plan*", () => {
    const cond = STAGE.indexOf("irrNoFlowChip =");
    const line = STAGE.slice(cond, STAGE.indexOf(";", cond));
    expect(line).toContain('nb === "s5_pnl"');
    expect(line).toContain('nb.startsWith("s5_plan")');
  });
  test("chip renders only in the null branch - a computed IRR is never replaced", () => {
    const irr = STAGE.indexOf('data-testid="scenario-irr-cell"');
    const cell = STAGE.slice(irr, STACE_END(STAGE, irr));
    expect(cell.indexOf("irrV != null")).toBeLessThan(cell.indexOf("irrNoFlowChip"));
  });
  test("chip text and tooltip explain the zero-capex cause and the fix", () => {
    expect(STAGE).toContain('data-testid="irr-no-flow-chip"');
    // i18n: chip text and tooltip are catalog keys; the ko values carry the wording.
    expect(STAGE).toContain('{t("noInvestmentFlowsTheS5")}');
    expect(STAGE).toContain('title={t("thatIsWhyThePayback")}');
    expect(koOf("stages.s8.stage.noInvestmentFlowsTheS5")).toBe("투자 플로우 없음 — S5 계획에 설비투자(capex) 줄이 없습니다");
    const tooltip = koOf("stages.s8.stage.thatIsWhyThePayback");
    expect(tooltip).toContain("BEP");
    expect(tooltip).toContain("capex");
  });
  test("payload flag is additive on the business-case GET only", () => {
    const route = read("app/api/projects/[id]/business-case/route.ts");
    expect(route).toContain("s5_plan_capex_zero: s5PlanCapexZero");
    expect(route).toContain('pinnedPlanCapexTotal');
  });
});

function STACE_END(src: string, from: number): number {
  const close = src.indexOf("</td>", from);
  return close === -1 ? from + 400 : close;
}

describe("greenfield column hygiene (scenario comparison)", () => {
  test("greenfield column width set exists and sums to 100", () => {
    expect(STAGE).toContain("SCENARIO_CASE_COL_PCT_GF = [11, 14, 9, 9, 9, 9, 6, 33] as const");
    const sum = [11, 14, 9, 9, 9, 9, 6, 33].reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
  test("ColGroup switches on greenfield", () => {
    expect(STAGE).toContain("<ColGroup widths={greenfield ? SCENARIO_CASE_COL_PCT_GF : SCENARIO_CASE_COL_PCT} />");
  });
  test("both brownfield-only headers are hidden for greenfield", () => {
    // Whitespace-tolerant: biome format moves the <th> to its own line inside the
    // conditional; the pin asserts the two guarded headers, not the layout.
    expect(STAGE.match(/\{!greenfield && \(\s*<th scope="col" className="num"/g)?.length).toBe(2);
    expect(STAGE.match(/\{!greenfield && \(\s*<th scope="col"/g)?.length).toBe(2);
  });
  test("both brownfield-only cells are hidden for greenfield", () => {
    expect(STAGE.match(/\{!greenfield && \(\s*<td className="num/g)?.length).toBe(2);
  });
  test("brownfield keeps the full 10-column footer and greenfield uses 8", () => {
    expect(STAGE).toContain("colSpan={10}");
    expect(STAGE).toContain("colSpan={8}");
  });
});

describe("capex-missing warnings (S5 connect + params)", () => {
  test("params GET carries the pinned plan capex total (greenfield only)", () => {
    const route = read("app/api/projects/[id]/business-case/params/route.ts");
    expect(route).toContain("s5_pin_capex_total_krw_m: track === \"greenfield\" ? pinnedPlanCapexTotal(getDb(), id) : null");
  });
  test("S5ConnectBlock warns when pinned AND pinned plan capex total is 0", () => {
    expect(CONNECT).toContain("const capexZero = pinned && data.s5_pin_capex_total_krw_m === 0;");
    expect(CONNECT).toContain('data-testid="s8-s5-connect-capex-warning"');
    // i18n: chip text ("설비투자 없음") and body copy are catalog keys.
    expect(CONNECT).toContain('{t("noCapex")}');
    expect(koOf("stages.s8.s5ConnectBlock.noCapex")).toBe("설비투자 없음");
    expect(CONNECT).toContain('{t("theS5PlanHasNo")}');
    expect(koOf("stages.s8.s5ConnectBlock.theS5PlanHasNo")).toContain("S5 계획에 설비투자(capex) 줄이 없습니다");
  });
  test("ParamsPanel warns under the current-params table on the same condition", () => {
    expect(PARAMS).toContain('data-testid="s8-params-capex-warning"');
    expect(PARAMS).toContain("s5_pin_capex_total_krw_m");
    expect(PARAMS).toContain('{t("theS5PlanHasNo")}');
    expect(koOf("stages.s8.paramsPanel.theS5PlanHasNo")).toContain("설비투자가 있다면 S5 투자비 탭에 입력하세요");
  });
});

describe("s5ParamLinkage capex-zero annotation (pure)", () => {
  const base = { basis: "s5_plan_full" as const, run: null, s8Iterations: 2000 };
  test("capex cell annotates when the plan has no capex line", () => {
    const cell = s5ParamLinkage("capex", { ...base, planCapexZero: true });
    expect(cell.kind).toBe("s5");
    expect(cell.detail).toContain("\ub2e8, \uacc4\ud68d\uc5d0 \uc124\ube44\ud22c\uc790 \uc904\uc774 \uc5c6\uc2b5\ub2c8\ub2e4");
  });
  test("capex cell stays clean when the plan carries capex", () => {
    const cell = s5ParamLinkage("capex", { ...base });
    expect(cell.detail).not.toContain("\ub2e8,");
  });
  test("initial (year-0) cell annotates the zero cause", () => {
    const cell = s5ParamLinkage("initial", { ...base, planCapexZero: true });
    expect(cell.detail).toContain("\uc5c6\uc5b4 0\uc785\ub2c8\ub2e4");
  });
  test("ratio basis never annotates (S5 not in use)", () => {
    const cell = s5ParamLinkage("capex", { basis: "ratio", run: null, s8Iterations: 1, planCapexZero: true });
    expect(cell.kind).toBe("assumed");
  });
});

describe("planCapexTotalOf (pure derivation)", () => {
  const input = (manual: InvestmentVectorsInput["manual"]): InvestmentVectorsInput => ({
    manual,
    capLines: [],
    horizon: 5,
    reflectedKeys: new Set<string>(),
    staffing: null,
  });
  const capex = (amount: number, extra: Record<string, unknown> = {}) => ({
    line: "\uacf5\uc7a5 \uc124\ube44",
    category: "capex",
    period: "yearly",
    currency: "KRW",
    amountUnit: "krw_m",
    amountUnitConfirmed: true,
    amount,
    startYear: 1,
    endYear: 3,
    ...extra,
  });
  test("sums confirmed capex lines over the plan", () => {
    expect(planCapexTotalOf(input([capex(100)]))).toBe(300);
  });
  test("no capex lines means 0 - not null", () => {
    expect(planCapexTotalOf(input([]))).toBe(0);
    expect(planCapexTotalOf(input([{ category: "labor", period: "yearly", currency: "KRW", amountUnit: "krw_m", amountUnitConfirmed: true, amount: 50, startYear: 1 }]))).toBe(0);
  });
  test("unconfirmed-unit or non-KRW capex lines are filtered out (same filters as the copy path)", () => {
    expect(planCapexTotalOf(input([capex(100, { amountUnitConfirmed: false })]))).toBe(0);
    expect(planCapexTotalOf(input([capex(100, { currency: "USD" })]))).toBe(0);
  });
});
