// @version 1.0.0
/**
 * ADR-0173 amendment 2026-10-15: investment amounts are 백만원 everywhere (amountUnit "krw_m"); legacy lines without the
 * marker hold 억 and are converted value-preserving. Also the explicit reflection action (saved/unsaved diff, summary,
 * partial payload) and the strategy-only save. Pure helpers + source-structure checks; no network, no real LLM.
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const cl = await import("../../app/web-next/lib/capability-cost-lines.ts");

describe("unit conversion without drift", () => {
  test("억 to 백만원 is exact to 0.01", () => {
    expect(cl.eokToKrwM(0.35)).toBe(35);
    expect(cl.eokToKrwM(0.07)).toBe(7);
    expect(cl.eokToKrwM(1.15)).toBe(115);
    expect(cl.eokToKrwM(12)).toBe(1200);
    expect(cl.eokToKrwM(2.675)).toBe(267.5);
    expect(cl.eokToKrwM(0.0001)).toBe(0.01);
    expect(cl.eokToKrwM(Number.NaN)).toBe(0);
  });
  test("a line without amountUnit is 억, with krw_m it is 백만원; non-KRW converts the same way", () => {
    expect(cl.lineAmountKrwM({ amount: 0.35 })).toBe(35);
    expect(cl.lineAmountKrwM({ amount: 35, amountUnit: "krw_m" })).toBe(35);
    expect(cl.lineAmountKrwM({ amount: "2" })).toBe(200);
    expect(cl.lineAmountKrwM({})).toBe(0);
    expect(cl.formatKrwM(1250)).toBe("1,250백만원");
    expect(cl.formatKrwM(1234.5)).toBe("1,234.5백만원");
  });
});

describe("server normalization writes the unit marker", () => {
  const rows = [{ id: "k1", capability: "가공", resolution: "build", closing_cost_krw_m: 3000, months_to_attain: 12, grade: "medium", confirmed_at: "t", stale: false, required_level: "", current_level: "", necessity: "essential", held_status: "none" }] as any;
  const norm = (incoming: unknown) => cl.normalizeBusinessCaseLines(incoming, rows, null, { userId: "u", at: "t" });
  test("legacy manual lines are rewritten value-preserving; krw_m lines are untouched; foreign currency also x100", () => {
    const r = norm([
      { line: "a", category: "opex", amount: 0.35, currency: "KRW", period: "yearly" },
      { line: "b", category: "opex", amount: 35, amountUnit: "krw_m", currency: "KRW", period: "yearly" },
      { line: "c", category: "capex", amount: 1.2, currency: "USD", period: "lumpsum" },
    ]);
    expect(r.ok && r.lines).toEqual([
      { line: "a", category: "opex", amount: 35, amountUnit: "krw_m", currency: "KRW", period: "yearly" },
      { line: "b", category: "opex", amount: 35, amountUnit: "krw_m", currency: "KRW", period: "yearly" },
      { line: "c", category: "capex", amount: 120, amountUnit: "krw_m", currency: "USD", period: "lumpsum" },
    ]);
  });
  test("capability amount is compared in 백만원; a unit-less client amount is read as 억", () => {
    expect(norm([{ source: "capability", capabilityKey: "k1", reflected: true, amount: 3000, amountUnit: "krw_m" }]).ok).toBe(true);
    expect(norm([{ source: "capability", capabilityKey: "k1", reflected: true, amount: 30 }]).ok).toBe(true); // legacy 억
    const bad = norm([{ source: "capability", capabilityKey: "k1", reflected: true, amount: 30, amountUnit: "krw_m" }]);
    expect(bad.ok === false && bad.error.code).toBe("amount_mismatch");
    expect(bad.ok === false && bad.error.message).toContain("백만원");
    const stored = norm([{ source: "capability", capabilityKey: "k1", reflected: true }]);
    expect(stored.ok && stored.lines[0]).toMatchObject({ amount: 3000, amountUnit: "krw_m", costKrwM: 3000 });
  });
  test("totals are 백만원; legacy manual amounts count as 억 x100; promotion keeps the legacy x100 and krw_m is not multiplied", () => {
    const view = cl.deriveCapabilityCostLines(rows.map((r: any) => ({ ...r })), []);
    const t = cl.investmentTotals(view, new Set(["k1"]), [{ category: "opex", amount: 5, currency: "KRW", period: "lumpsum" }, { category: "opex", amount: 100, amountUnit: "krw_m", currency: "KRW", period: "monthly" }]);
    expect(t).toMatchObject({ reflectedKrwM: 3000, manualKrwM: 1700, grandKrwM: 4700, capabilityKrwM: 3000 });
    const repo = read("db/repositories/project.repository.ts");
    expect(repo).toContain("lineAmountKrwM(l) * periodMult");
    expect(cl.lineAmountKrwM({ amount: 12 }) * 1).toBe(1200); // legacy 12억 -> 1200
    expect(cl.lineAmountKrwM({ amount: 100, amountUnit: "krw_m" }) * 12).toBe(1200); // 100 백만원 monthly -> 1200 annual
  });
});

describe("reflection action helpers", () => {
  const src = (over: Record<string, unknown> = {}) => ({ id: "k1", capability: "가공", resolution: "build", closing_cost_krw_m: 3000, months_to_attain: 12, grade: "medium", confirmed_at: "t", stale: false, required_level: "", current_level: "", necessity: "essential", held_status: "none", ...over }) as any;
  const view = cl.deriveCapabilityCostLines([src(), src({ id: "k2", capability: "채용", closing_cost_krw_m: 1000 })], [{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 3000, amountUnit: "krw_m" }]);
  const stored = [{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 3000, amountUnit: "krw_m" }];
  test("saved / unsaved / none per line and the dirty flag", () => {
    let lines = cl.applySelection(view, {});
    let st = cl.lineSaveStates(lines, stored, {});
    expect(st.k1).toBe("saved");
    expect(st.k2).toBe("unsaved"); // reflectable by default but never stored
    st = cl.lineSaveStates(cl.applySelection(view, { k2: { reflected: false } }), stored, { k2: { reflected: false } });
    expect(st.k2).toBe(null);
    expect(cl.hasUnsavedReflection(st)).toBe(false);
    const sel = { k1: { reflected: false } };
    lines = cl.applySelection(view, sel);
    st = cl.lineSaveStates(lines, stored, sel);
    expect(st.k1).toBe("unsaved"); // un-checking a stored reflection
    expect(cl.hasUnsavedReflection(st)).toBe(true);
    const cat = { k1: { category: "opex" as const } };
    expect(cl.lineSaveStates(cl.applySelection(view, cat), stored, cat).k1).toBe("unsaved");
  });
  test("payload carries ONLY business_case_lines (manual lines + capability selections in 백만원)", () => {
    const lines = cl.applySelection(view, {});
    const body = cl.reflectionBody([{ line: "임대", category: "opex", amount: 10, amountUnit: "krw_m" } as any, { line: "  " } as any], lines, {});
    expect(Object.keys(body)).toEqual(["business_case_lines"]);
    expect(body.business_case_lines[0]).toMatchObject({ line: "임대" });
    expect(body.business_case_lines).toContainEqual({ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 3000, amountUnit: "krw_m" });
    expect(body.business_case_lines).toHaveLength(3);
  });
  test("summary message", () => {
    expect(cl.reflectionSummary({ reflectedCount: 2, reflectedKrwM: 4000, grandKrwM: 4700 })).toBe("2건 반영, 반영 합계 4,000백만원 — 투자비 전체 합계 4,700백만원");
  });
});

describe("source structure", () => {
  const block = read("app/web-next/components/stages/CapabilityCostBlock.tsx");
  const page = read("app/web-next/components/stages/GreenfieldStage.tsx");
  const sec = read("app/web-next/components/stages/EntryStrategySection.tsx");
  test("reflection button, chips, notes, promotion line and warning, unit labels", () => {
    for (const k of ["선택한 비용을 투자비에 반영", "저장하지 않은 변경", "반영됨 · 저장됨", "저장 전", "저장 전 변경 있음", "S8 사업성 분석 입력: 프로젝트 승격 시 반영된", "투자비 입력으로 복사됩니다",
      "이미 승격된 프로젝트 — S5의 변경은 S8에 자동 전달되지 않습니다 (재가져오기는 이후 단계)", "금액 (단위: 백만원)", "formatKrwM", "aria-describedby"]) expect(block).toContain(k);
    expect(block).not.toMatch(/\.toFixed\(2\)\}억|억<\/b>/);
    for (const k of ["단위: 백만원(KRW)", "금액(백만원)", "금액(백만 ", "reflectionBody(bcLines, capLines, capSel)", "amount_mismatch", "setAttRows(null)", "promoted_at"]) expect(page).toContain(k);
    expect(page).not.toContain("금액(억)");
  });
  test("the reflection POST is partial and reloads only the cost part; the strategy save posts only strategy fields", () => {
    const refl = page.slice(page.indexOf("async function reflectCosts"), page.indexOf("if (!selected) {\n    return ("));
    expect(refl).toContain("reflectionBody(");
    expect(refl).not.toMatch(/entry_strategy|alternatives_considered|rationale:/);
    expect(refl).toContain('"cost"');
    const strat = page.slice(page.indexOf("async function saveStrategy"), page.indexOf("// 선택한 비용을 투자비에 반영"));
    expect(strat).toContain("entry_strategy: serializeEntryStrategy(entryModes, entryStrategy)");
    expect(strat).toContain("alternatives_considered");
    expect(strat).not.toMatch(/business_case_lines|rationale:/);
    expect(strat).toContain('"strategy"');
    expect(strat).toContain("저장됨 · ");
  });
  test("strategy section save UI", () => {
    for (const k of ["진출전략 저장", "저장하지 않은 변경", "btn-primary", "btn-ghost", "저장 결과 닫기", "entry-save-error", "저장할 변경이 없습니다"]) expect(sec).toContain(k);
  });
  test("docs mention the unit and the new routes", () => {
    expect(read("docs/architecture/api-spec.md")).toContain("amountUnit");
    expect(read("docs/architecture/openapi.yaml")).toContain("amountUnit");
    expect(read("docs/architecture/ui-spec.md")).toContain("선택한 비용을 투자비에 반영");
    expect(read("docs/adr/0173-capability-cost-and-milestone-linkage.md")).toContain("OD-5 display unit changed");
  });
});
