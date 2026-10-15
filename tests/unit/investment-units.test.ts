// @version 1.0.0
/**
 * Unit-confirm trust model for S5 investment lines (ADR-0173 amendment 2026-10-15): every manual line
 * carries amountUnit (krw|krw_k|krw_m|krw_eok|fx_m|fx_eok) and amountUnitConfirmed — true only after a
 * person picked the unit in the UI. Legacy/old-shape lines are normalized WITHOUT conversion, stay
 * unconfirmed, and are excluded from totals and promotion until confirmed. Pure helpers + source-structure
 * checks; no network, no real LLM.
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
  test("KRW-family units convert exactly; fx units and unknown units do not convert", () => {
    // 5,200,000원 -> 5.2백만원
    expect(cl.manualLineKrwM({ amount: 5_200_000, amountUnit: "krw", currency: "KRW" })).toBe(5.2);
    // 0.35억 -> 35백만원 (legacy 억 stamp handled by lineAmountKrwM)
    expect(cl.lineAmountKrwM({ amount: 0.35 })).toBe(35);
    expect(cl.manualLineKrwM({ amount: 35, amountUnit: "krw_m", currency: "KRW" })).toBe(35);
    // 2,500천원 -> 2.5백만원
    expect(cl.manualLineKrwM({ amount: 2500, amountUnit: "krw_k", currency: "KRW" })).toBe(2.5);
    // 1.2억 -> 120백만원
    expect(cl.manualLineKrwM({ amount: 1.2, amountUnit: "krw_eok", currency: "KRW" })).toBe(120);
    // no fx conversion, ever (boundary: no fabricated rates)
    expect(cl.manualLineKrwM({ amount: 1.2, amountUnit: "fx_m", currency: "USD" })).toBeNull();
    expect(cl.manualLineKrwM({ amount: 1.2, amountUnit: "fx_eok", currency: "EUR" })).toBeNull();
    // unknown unit
    expect(cl.manualLineKrwM({ amount: 1.2, amountUnit: "yard", currency: "KRW" })).toBeNull();
    // stored canonical wins
    expect(cl.manualLineKrwM({ amount: 1, amountUnit: "krw_m", currency: "KRW", amountKrwM: 42.555 })).toBe(42.56);
  });
});

describe("legacy detection and normalization without conversion", () => {
  test("the demo revenue line is legacy: category revenue, no unit stamp trusted, growth kept read-only", () => {
    const m = cl.normalizeLegacyLine({ line: "유럽 브레이커", kind: "revenue", amount: 5_200_000, growth_rate: 0.12, amountUnit: "krw_m" });
    expect(m.category).toBe("revenue");
    expect(m.amount).toBe(5_200_000); // untouched — no silent unit migration
    expect(m.amountUnit).toBeUndefined(); // the old krw_m stamp came from the previous silent conversion
    expect(m.amountUnitConfirmed).toBe(false);
    expect(m.currency).toBe("KRW"); // missing currency defaults to KRW
    expect(m.period).toBeUndefined(); // stays unset; yearly is only a UI suggestion (growth_rate present)
    expect(m.growthRate).toBe(0.12);
    expect(cl.manualLineIssues(m)).toEqual(["period", "unit"]);
    expect(cl.manualLineNeedsConfirm(m)).toBe(true);
    expect(cl.manualLineIsLegacy({ line: "x", kind: "cost" })).toBe(true);
  });
  test("an old-shape cost line never defaults to labor; a confirmed krw_m line stays confirmed", () => {
    const cost = cl.normalizeLegacyLine({ line: "설비", kind: "cost", amount: 12, amountUnit: "krw_m" });
    expect(cost.category).toBeUndefined();
    expect(cost.amountUnit).toBeUndefined();
    expect(cost.amountUnitConfirmed).toBe(false);
    const fresh = cl.normalizeLegacyLine({ line: "임대료", category: "opex", amount: 10, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "monthly" });
    expect(fresh.amountUnitConfirmed).toBe(true);
    expect(cl.manualLineIssues(fresh)).toEqual([]);
  });
});

describe("server normalization: no silent conversion, unknown units rejected", () => {
  const rows = [{ id: "k1", capability: "가공", resolution: "build", closing_cost_krw_m: 3000, months_to_attain: 12, grade: "medium", confirmed_at: "t", stale: false, required_level: "", current_level: "", necessity: "essential", held_status: "none" }] as any;
  const norm = (incoming: unknown) => cl.normalizeBusinessCaseLines(incoming, rows, null, { userId: "u", at: "t" });
  test("legacy manual lines keep their raw amount and stay unconfirmed; complete confirmed lines gain amountKrwM", () => {
    const r = norm([
      { line: "a", category: "opex", amount: 0.35, currency: "KRW", period: "yearly" },
      { line: "b", category: "opex", amount: 35, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly" },
      { line: "c", category: "capex", amount: 1.2, currency: "USD", period: "lumpsum", amountUnit: "fx_m", amountUnitConfirmed: true },
    ]);
    expect(r.ok).toBe(true);
    const [a, b, c] = (r as { ok: true; lines: any[] }).lines;
    expect(a).toMatchObject({ line: "a", amount: 0.35, amountUnit: undefined, amountUnitConfirmed: false, amountKrwM: null });
    expect(b).toMatchObject({ line: "b", amount: 35, amountUnit: "krw_m", amountUnitConfirmed: true, amountKrwM: 35 });
    expect(c).toMatchObject({ line: "c", amount: 1.2, amountUnit: "fx_m", amountUnitConfirmed: true, amountKrwM: null }); // fx: no conversion
  });
  test("unknown units are rejected with invalid_amount_unit", () => {
    const bad = norm([{ line: "x", category: "opex", amount: 1, amountUnit: "billion", currency: "KRW", period: "yearly" }]);
    expect(bad.ok === false && bad.error.code).toBe("invalid_amount_unit");
  });
  test("capability amount is compared in 백만원; a unit-less client amount is read as 억", () => {
    expect(norm([{ source: "capability", capabilityKey: "k1", reflected: true, amount: 3000, amountUnit: "krw_m" }]).ok).toBe(true);
    expect(norm([{ source: "capability", capabilityKey: "k1", reflected: true, amount: 30 }]).ok).toBe(true); // legacy 억
    const bad = norm([{ source: "capability", capabilityKey: "k1", reflected: true, amount: 30, amountUnit: "krw_m" }]);
    expect(bad.ok === false && bad.error.code).toBe("amount_mismatch");
    expect(bad.ok === false && bad.error.message).toContain("백만원");
    const stored = norm([{ source: "capability", capabilityKey: "k1", reflected: true }]);
    expect(stored.ok && stored.lines[0]).toMatchObject({ amount: 3000, amountUnit: "krw_m", amountUnitConfirmed: true, costKrwM: 3000 });
  });
});

describe("totals: confirmed lines only, 일시불/연간 split, exclusion counters", () => {
  test("unconfirmed and non-KRW lines are excluded and counted; lumpsum vs recurring split is exact", () => {
    const rows = [{ id: "k1", capability: "가공", resolution: "build", closing_cost_krw_m: 3000, months_to_attain: 12, grade: "medium", confirmed_at: "t", stale: false, required_level: "", current_level: "", necessity: "essential", held_status: "none" }] as any;
    const view = cl.deriveCapabilityCostLines(rows.map((r: any) => ({ ...r })), []);
    const conf = { amountUnit: "krw_m" as const, amountUnitConfirmed: true };
    const t = cl.investmentTotals(view, new Set(["k1"]), [
      { category: "opex", amount: 100, currency: "KRW", period: "monthly", ...conf }, // 1,200 annual
      { category: "capex", amount: 26, currency: "KRW", period: "lumpsum", amountUnit: "krw_eok", amountUnitConfirmed: true }, // 26억 = 2,600백만원
      { category: "opex", amount: 5, currency: "KRW", period: "yearly" }, // unconfirmed — excluded
      { category: "capex", amount: 9_900_000, currency: "KRW", period: "yearly", amountUnit: "krw", amountUnitConfirmed: true }, // 9.9
      { category: "capex", amount: 100, currency: "USD", period: "lumpsum", amountUnit: "fx_m", amountUnitConfirmed: true }, // fx — excluded
    ]);
    expect(t).toMatchObject({
      reflectedKrwM: 3000, manualKrwM: 3_809.9, grandKrwM: 6_809.9,
      manualLumpsumKrwM: 2_600, manualRecurringKrwM: 1_209.9,
      manualExcludedNeedsConfirm: 1, manualExcludedNonKrw: 1,
    });
    // sanity chips (decision support, never a cap)
    expect(cl.sanityLineOversize(100_001)).toBe(true);
    expect(cl.sanityLineOversize(100_000)).toBe(false);
    expect(cl.sanityLineOversize(null)).toBe(false);
    expect(cl.sanityTotalOversize(1_000_001)).toBe(true);
    expect(cl.sanityTotalOversize(1_000_000)).toBe(false);
  });
});

describe("promotion: unconfirmed and non-KRW manual lines are skipped with reasons", () => {
  test("splitForPromotion lists skippedManual with unit_unconfirmed / currency_non_krw", () => {
    const s = cl.splitForPromotion([
      { line: "확인됨", category: "opex", amount: 10, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly" },
      { line: "단위 미확인", category: "opex", amount: 5, currency: "KRW", period: "yearly" },
      { line: "외화 항목", category: "capex", amount: 2, amountUnit: "fx_m", amountUnitConfirmed: true, currency: "USD", period: "lumpsum" },
    ], []);
    expect(s.manual).toHaveLength(1);
    expect(s.skippedManual).toEqual([
      { line: "단위 미확인", reason: "unit_unconfirmed" },
      { line: "외화 항목", reason: "currency_non_krw" },
    ]);
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
    expect(body.business_case_lines).toContainEqual({ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", amount: 3000, amountUnit: "krw_m", amountUnitConfirmed: true });
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
    for (const k of ["금액(백만원)", "reflectionBody(bcLines, capLines, capSel)", "amount_mismatch", "setAttRows(null)", "promoted_at"]) expect(page).toContain(k);
    expect(page).not.toContain("금액(억)");
  });
  test("unit-confirm UI: unit select beside the amount, placeholder, chips, unit text, excluded note, sanity guard", () => {
    for (const k of [
      'aria-label="금액 단위"', '<option value="" disabled>선택</option>', "invest-confirm-chip-", "confirmUnitOnAmountEdit",
      "invest-excluded-note", "합계에서 제외됨", "invest-total-sanity", "금액이 매우 큽니다 — 단위를 확인하세요",
      "normalizeLegacyLine", "manualLineIssues", "manualLineKrwM", "sanityLineOversize", "sanityTotalOversize",
      "amountUnitConfirmed: true", "amountUnitLabel",
    ]) expect(page).toContain(k);
    for (const k of ["invest-unit-text-", "단위 확인 필요", "단위를 고르면 금액이 계산됩니다", "환율 미반영 — 합계 제외"]) expect(page).not.toContain(k);
    expect(page).not.toMatch(/`= \$\{formatKrwM/);
  });
  test("implicit unit confirmation on amount edit; legacy rows stay excluded with the single note", () => {
    const fresh = { line: "a", amount: 0, amountUnit: "krw_m" as const, amountUnitConfirmed: false };
    expect(cl.confirmUnitOnAmountEdit({ ...fresh, amount: 9 }).amountUnitConfirmed).toBe(true);
    expect(cl.confirmUnitOnAmountEdit(fresh).amountUnitConfirmed).toBe(false);
    const legacy = cl.normalizeLegacyLine({ line: "old", amount: 9, kind: "cost", amountUnit: "krw_m" });
    expect(legacy.amountUnit).toBeUndefined();
    expect(cl.confirmUnitOnAmountEdit(legacy).amountUnitConfirmed).toBe(false);
    expect(cl.manualLineIssues(legacy)).toContain("unit");
    expect(page).toContain("invest-excluded-note");
    expect(page).not.toContain("invest-unit-marker-");
    expect(page).not.toContain("unitPending");
  });
  test("the promotion copy uses the canonical 백만원 and audits skipped manual lines", () => {
    const repo = read("db/repositories/project.repository.ts");
    expect(repo).toContain("(manualLineKrwM(l) ?? 0) * periodMult");
    expect(repo).toContain("greenfield_cost.promotion_skipped");
    expect(repo).not.toContain("lineAmountKrwM(l) * periodMult");
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
  test("docs mention the unit model and the new rejection code", () => {
    expect(read("docs/architecture/api-spec.md")).toContain("amountUnit");
    expect(read("docs/architecture/openapi.yaml")).toContain("amountUnitConfirmed");
    expect(read("docs/architecture/ui-spec.md")).toContain("confirmUnitOnAmountEdit");
    expect(read("docs/adr/0173-capability-cost-and-milestone-linkage.md")).toContain("OD-5 display unit changed");
  });
});
