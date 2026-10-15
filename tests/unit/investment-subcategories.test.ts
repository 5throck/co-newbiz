// @version 1.0.0
/**
 * ADR-0177 slice 1 (investment account sub-categories) and the yearly investment plan per-year totals.
 * Vocabulary integrity vs the design counts, parent validation (lib + route 400), round-trip
 * save/load, summary sub-category subtotals incl. the unassigned row, staffing defaults, duplicate
 * guards, and the schedule totals. Temp DB only, fake LLM (provider=none), no browser was used.
 * ASCII-only source: Korean text appears as \u escapes.
 */
import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(ROOT, "db/data/test-investment-subcategories.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const cl = await import("../../app/web-next/lib/capability-cost-lines.ts");
const sp = await import("../../app/web-next/lib/staffing-plan.ts");

const NOW = new Date().toISOString();
const json = JSON.stringify;
const ACTOR = { userId: "u1", at: NOW };
const krw = (o: Record<string, unknown>) => ({ line: "x", amount: 100, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", ...o });
const capRow = (o: Record<string, unknown> = {}) => ({ id: "r1", capability: "cap A", resolution: "build", category: "capex", closing_cost_krw_m: 300, months_to_attain: 6, grade: "high", confirmed_at: NOW, stale: false, ...o }) as never;

describe("vocabulary (design section 2)", () => {
  test("22 keys: capex 9, opex 10, labor 3; none under revenue/gov_rnd", () => {
    expect(cl.SUB_CATEGORIES).toHaveLength(22);
    expect(new Set(cl.SUB_CATEGORIES.map((d) => d.key)).size).toBe(22);
    expect(cl.subCategoriesOf("capex")).toHaveLength(9);
    expect(cl.subCategoriesOf("opex")).toHaveLength(10);
    expect(cl.subCategoriesOf("labor")).toHaveLength(3);
    expect(cl.subCategoriesOf("revenue")).toHaveLength(0);
    expect(cl.subCategoriesOf("gov_rnd")).toHaveLength(0);
  });
  test("labels non-empty, keys stable ASCII, parents valid, OD-2 patent maintenance under opex", () => {
    for (const d of cl.SUB_CATEGORIES) {
      expect(d.key).toMatch(/^[a-z_]+$/);
      expect(d.label.trim().length).toBeGreaterThan(0);
      expect(["labor", "opex", "capex"]).toContain(d.parent);
      expect(["monthly", "yearly", "lumpsum"]).toContain(d.defaultPeriod);
      expect(cl.SUB_CATEGORY_LABEL[d.key]).toBe(d.label);
      expect(cl.SUB_CATEGORY_PARENT[d.key]).toBe(d.parent);
    }
    expect(cl.SUB_CATEGORY_PARENT.patent_maintenance).toBe("opex");
    expect(cl.SUB_CATEGORY_PARENT.patent_filing).toBe("capex");
    expect(cl.SUB_CATEGORY_PARENT.direct_labor).toBe("labor");
  });
  test("no default prices or amounts in the vocabulary", () => {
    const allowed = new Set(["key", "label", "parent", "defaultPeriod", "group", "hint"]);
    for (const d of cl.SUB_CATEGORIES) for (const k of Object.keys(d)) expect(allowed.has(k)).toBe(true);
    for (const d of cl.SUB_CATEGORIES) for (const v of Object.values(d)) expect(typeof v).toBe("string");
  });
  test("validSubCategory checks the parent", () => {
    expect(cl.validSubCategory("capex", "machinery")).toBe(true);
    expect(cl.validSubCategory("opex", "machinery")).toBe(false);
    expect(cl.validSubCategory("revenue", "machinery")).toBe(false);
    expect(cl.validSubCategory("capex", "nope")).toBe(false);
    expect(cl.validSubCategory("capex", undefined)).toBe(false);
  });
  test("judgement suggestion follows resolution, falls back to the category default", () => {
    expect(cl.suggestSubCategory("build", "capex")).toBe("machinery");
    expect(cl.suggestSubCategory("hire", "labor")).toBe("direct_labor");
    expect(cl.suggestSubCategory("partner", "opex")).toBe("outsourcing");
    expect(cl.suggestSubCategory("build", "labor")).toBe("direct_labor");
    expect(cl.suggestSubCategory(null, "opex")).toBe("outsourcing");
    expect(cl.suggestSubCategory(null, null)).toBeNull();
  });
});

describe("normalizeBusinessCaseLines: parent validation and persistence", () => {
  test("valid sub-category is persisted on a manual line", () => {
    const r = cl.normalizeBusinessCaseLines([krw({ category: "capex", subCategory: "machinery" })], [], null, ACTOR);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines[0]).toMatchObject({ category: "capex", subCategory: "machinery" });
  });
  test("parent mismatch -> subcategory_parent_mismatch", () => {
    const r = cl.normalizeBusinessCaseLines([krw({ category: "opex", subCategory: "machinery" })], [], null, ACTOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("subcategory_parent_mismatch");
  });
  test("revenue / gov_rnd lines cannot carry a sub-category", () => {
    for (const category of ["revenue", "gov_rnd"]) {
      const r = cl.normalizeBusinessCaseLines([krw({ category, subCategory: "materials" })], [], null, ACTOR);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("subcategory_parent_mismatch");
    }
  });
  test("unknown key -> invalid_sub_category", () => {
    const r = cl.normalizeBusinessCaseLines([krw({ category: "capex", subCategory: "spaceship" })], [], null, ACTOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_sub_category");
  });
  test("no category: the parent is derived from the sub-category", () => {
    const r = cl.normalizeBusinessCaseLines([krw({ category: undefined, subCategory: "rent_utility" })], [], null, ACTOR);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines[0]).toMatchObject({ category: "opex", subCategory: "rent_utility" });
  });
  test("legacy lines without a sub-category stay valid; legacySubCategory is never stored", () => {
    const r = cl.normalizeBusinessCaseLines([krw({ category: "capex" }), krw({ category: "capex", legacySubCategory: "old" })], [], null, ACTOR);
    expect(r.ok).toBe(true);
    if (r.ok) for (const l of r.lines as Array<Record<string, unknown>>) { expect(l.subCategory).toBeUndefined(); expect(l.legacySubCategory).toBeUndefined(); }
  });
  test("capability entry: sub-category validated against its category and stored", () => {
    const ok = cl.normalizeBusinessCaseLines([{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex", subCategory: "it_software" }], [capRow()], null, ACTOR);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.lines[0]).toMatchObject({ source: "capability", subCategory: "it_software" });
    const bad = cl.normalizeBusinessCaseLines([{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex", subCategory: "direct_labor" }], [capRow()], null, ACTOR);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("subcategory_parent_mismatch");
  });
});

describe("read path", () => {
  test("normalizeLegacyLine keeps a valid key, moves an unknown/mismatched one to legacySubCategory", () => {
    expect(cl.normalizeLegacyLine(krw({ category: "opex", subCategory: "materials" })).subCategory).toBe("materials");
    const bad = cl.normalizeLegacyLine(krw({ category: "opex", subCategory: "machinery" }));
    expect(bad.subCategory).toBeUndefined();
    expect(bad.legacySubCategory).toBe("machinery");
    expect(cl.normalizeLegacyLine(krw({ category: "opex" })).subCategory).toBeUndefined();
  });
  test("derived capability line: stored sub kept when it fits, dropped when the category moved; suggestion offered", () => {
    const keep = cl.deriveCapabilityCostLines([capRow()], [{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex", subCategory: "machinery" }]);
    expect(keep.lines[0].subCategory).toBe("machinery");
    const moved = cl.deriveCapabilityCostLines([capRow({ category: "opex" })], [{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex", subCategory: "machinery" }]);
    expect(moved.lines[0].subCategory).toBeNull();
    expect(moved.lines[0].suggestedSubCategory).toBe("outsourcing");
  });
  test("selection overlay: pick, payload, unsaved state, and clearing on an incompatible category", () => {
    const view = cl.deriveCapabilityCostLines([capRow()], [{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex", amount: 300, amountUnit: "krw_m" }]);
    const picked = cl.applySelection(view, { r1: { subCategory: "machinery" } });
    expect(picked[0].subCategory).toBe("machinery");
    expect(cl.selectionPayload(picked, { r1: { subCategory: "machinery" } })[0].subCategory).toBe("machinery");
    expect(cl.lineSaveStates(picked, [{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex" }], { r1: { subCategory: "machinery" } }).r1).toBe("unsaved");
    expect(cl.lineSaveStates(picked, [{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex", subCategory: "machinery" }], { r1: { subCategory: "machinery" } }).r1).toBe("saved");
    const moved = cl.applySelection(view, { r1: { subCategory: "machinery", category: "labor" } });
    expect(moved[0].subCategory).toBeNull();
  });
});

describe("summary sub-category subtotals", () => {
  const staffing = { source: "staffing_plan", rows: [{ id: "s1", roleFamily: "prod", grade: "g", headcountByYear: [1, 1, 1], avgAnnualBaseSalaryKrwM: 50, salaryIncreaseRatePct: 0, onCostRatePct: 20, recruitingOneOffKrwM: 10 }], startYear: 1, endYear: 3, attritionBackfillPct: 0 } as never;
  const manual = [
    krw({ category: "capex", subCategory: "machinery", amount: 1000 }),
    krw({ category: "capex", amount: 200 }), // unassigned
    krw({ category: "opex", subCategory: "rent_utility", amount: 1, period: "monthly", startYear: 1, endYear: 3 }), // 12/yr x 3
    krw({ category: "opex", subCategory: "product_cert", amount: 50 }),
    krw({ category: "revenue", amount: 999, period: "yearly" }),
  ];
  const view = cl.deriveCapabilityCostLines([capRow()], [{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex", subCategory: "it_software" }]);
  const summary = cl.buildInvestmentSummary(manual, view.lines, 3, new Set(["r1"]), staffing);
  const group = (c: string) => summary.bySubCategory.find((g) => g.category === c)!;

  test("rows (incl. unassigned) reconcile exactly to each category total", () => {
    for (const g of summary.bySubCategory) {
      const cat = summary.byCategory.find((r) => r.category === g.category)!;
      expect(g.totalKrwM).toBe(cat.totalKrwM);
      expect(Math.round(g.rows.reduce((a, r) => a + r.totalKrwM, 0) * 100) / 100).toBe(cat.totalKrwM);
    }
  });
  test("capex: machinery 1000, it_software 300 (capability), unassigned 200", () => {
    const rows = group("capex").rows;
    expect(rows.find((r) => r.key === "machinery")?.totalKrwM).toBe(1000);
    expect(rows.find((r) => r.key === "it_software")?.totalKrwM).toBe(300);
    const un = rows.find((r) => r.key === null)!;
    expect(un.totalKrwM).toBe(200);
    expect(un.label).toBe(cl.UNASSIGNED_SUB_LABEL);
    expect(rows[rows.length - 1].key).toBeNull();
  });
  test("opex: monthly annualised over the horizon; one-off certification flagged as s5_plan-excluded", () => {
    const rows = group("opex").rows;
    expect(rows.find((r) => r.key === "rent_utility")?.totalKrwM).toBe(36);
    expect(rows.find((r) => r.key === "product_cert")).toMatchObject({ totalKrwM: 50, s5PlanExcluded: true });
    expect(rows.find((r) => r.key === null)).toBeUndefined();
  });
  test("labor: staffing salaries -> direct_labor, recruiting one-off -> recruiting_training", () => {
    const rows = group("labor").rows;
    expect(rows.find((r) => r.key === "direct_labor")?.totalKrwM).toBe(180); // 50 x 1.2 x 3 years
    expect(rows.find((r) => r.key === "recruiting_training")?.totalKrwM).toBe(10);
    expect(rows.find((r) => r.key === null)).toBeUndefined();
  });
});

describe("sub-category rows inside the yearly table", () => {
  const staffing = { source: "staffing_plan", rows: [{ id: "s1", roleFamily: "prod", grade: "g", headcountByYear: [1, 1, 1], avgAnnualBaseSalaryKrwM: 50, salaryIncreaseRatePct: 0, onCostRatePct: 20, recruitingOneOffKrwM: 10 }], startYear: 1, endYear: 3, attritionBackfillPct: 0 } as never;
  const manual = [
    krw({ category: "capex", subCategory: "machinery", amount: 1000, startYear: 2 }),
    krw({ category: "capex", amount: 200 }),
    krw({ category: "opex", subCategory: "rent_utility", amount: 1, period: "monthly", startYear: 1, endYear: 3 }),
    krw({ category: "opex", subCategory: "product_cert", amount: 50 }),
    krw({ category: "revenue", amount: 999, period: "yearly" }),
  ];
  const view = cl.deriveCapabilityCostLines([capRow()], [{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex", subCategory: "it_software" }]);
  const summary = cl.buildInvestmentSummary(manual, view.lines, 3, new Set(["r1"]), staffing);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  test("per year, sub-category cells sum exactly to the category schedule value", () => {
    for (const g of summary.bySubCategory) {
      summary.schedule.forEach((s, i) => {
        expect(r2(g.rows.reduce((a, r) => a + r.yearly[i], 0))).toBe(s[g.category as "labor" | "opex" | "capex"]);
      });
      for (const r of g.rows) expect(r.totalKrwM).toBe(r2(r.yearly.reduce((a, n) => a + n, 0)));
    }
  });
  test("category rows add up to the grand total per year and overall", () => {
    const t = cl.scheduleTotals(summary);
    summary.schedule.forEach((s, i) => expect(r2(summary.bySubCategory.reduce((a, g) => a + g.rows.reduce((b, r) => b + r.yearly[i], 0), 0))).toBe(t.yearTotals[i]));
    expect(t.grandKrwM).toBe(summary.totalKrwM);
  });
  test("cadence and timing: machinery starts Y2, rent monthly x12 each year, staffing split by year", () => {
    const cap = summary.bySubCategory.find((g) => g.category === "capex")!.rows;
    expect(cap.find((r) => r.key === "machinery")!.yearly).toEqual([0, 1000, 0]);
    expect(summary.bySubCategory.find((g) => g.category === "opex")!.rows.find((r) => r.key === "rent_utility")!.yearly).toEqual([12, 12, 12]);
    expect(summary.bySubCategory.find((g) => g.category === "labor")!.rows.find((r) => r.key === "recruiting_training")!.totalKrwM).toBe(10);
  });
  test("unassigned row present only when needed, zero rows hidden", () => {
    expect(summary.bySubCategory.find((g) => g.category === "capex")!.rows.some((r) => r.key === null)).toBe(true);
    const opex = summary.bySubCategory.find((g) => g.category === "opex")!.rows;
    expect(opex.some((r) => r.key === null)).toBe(false);
    for (const g of summary.bySubCategory) for (const r of g.rows) expect(r.yearly.some((v) => v !== 0)).toBe(true);
  });
  test("UI: sub-category rows live in the yearly table; the separate subtotal table is gone", () => {
    const src = readFileSync(join(ROOT, "app/web-next/components/stages/GreenfieldStage.tsx"), "utf8");
    expect(src).not.toContain("invest-summary-subcategory");
    expect(src).not.toContain("\uC138\uBD80 \uACFC\uBAA9\uBCC4 \uC18C\uACC4");
    expect(src).toContain("invest-summary-sub-");
    expect(src).toContain('className="invest-sub-row-label"');
    expect(src).not.toContain("noteSubCleared");
    const css = readFileSync(join(ROOT, "app/web-next/app/styles.css"), "utf8");
    expect(css).toMatch(/\.invest-sticky-first th\.invest-sub-row-label\s*\{[^}]*padding-inline-start:\s*1\.5rem/);
    expect(src).toContain("invest-subcategory-s8-note");
  });
});

describe("yearly totals (task A)", () => {
  const manual = [
    krw({ category: "capex", amount: 500, startYear: 2 }),
    krw({ category: "opex", amount: 10, period: "quarterly", startYear: 1, endYear: 4 }),
    krw({ category: "labor", amount: 120, period: "yearly", startYear: 3 }),
    krw({ category: "revenue", amount: 1000, period: "yearly" }),
    krw({ category: "gov_rnd", amount: 77, startYear: 1 }),
  ];
  const view = cl.deriveCapabilityCostLines([capRow()], [{ source: "capability", capabilityKey: "r1", reflected: true, category: "capex" }]);
  const summary = cl.buildInvestmentSummary(manual, view.lines, 5, new Set(["r1"]));
  const t = cl.scheduleTotals(summary);
  const totals = cl.investmentTotals(view, new Set(["r1"]), manual, null, 5);

  test("each year total is the sum of the three investment categories (inflows excluded)", () => {
    summary.schedule.forEach((s, i) => {
      expect(t.yearTotals[i]).toBe(Math.round((s.labor + s.opex + s.capex) * 100) / 100);
      expect(t.yearTotals[i]).toBe(s.investmentTotal);
    });
    expect(t.yearTotals).toEqual([340, 540, 160, 160, 120]);
  });
  test("grand total = sum of year totals = summary total = investmentTotals.grandKrwM", () => {
    expect(t.grandKrwM).toBe(Math.round(t.yearTotals.reduce((a, n) => a + n, 0) * 100) / 100);
    expect(t.grandKrwM).toBe(summary.totalKrwM);
    expect(t.grandKrwM).toBe(totals.grandKrwM);
    expect(t.rowTotals.labor + t.rowTotals.opex + t.rowTotals.capex).toBe(t.grandKrwM);
  });
  test("revenue and gov R&D are reported separately and never inside the total", () => {
    expect(t.inflow).toEqual({ revenue: 5000, govRnd: 77 });
  });
  test("UI renders the emphasised total row and labelled inflow rows from scheduleTotals", () => {
    const src = readFileSync(join(ROOT, "app/web-next/components/stages/GreenfieldStage.tsx"), "utf8");
    expect(src).toContain('className="invest-total-row" data-testid="invest-summary-year-total"');
    expect(src).toContain("schedTotals.yearTotals.map");
    expect(src).toContain("{fmtM(schedTotals.grandKrwM)}");
    expect(src).toContain("\ud569\uacc4 \uc81c\uc678"); // "excluded from total" label on the inflow rows
  });
});

describe("duplicate guards compare the sub-category", () => {
  test("capability guard: same sub-category warns even when names differ; different sub stays silent", () => {
    const reflected = [{ capabilityKey: "r1", name: "alpha", subCategory: "machinery" as const }];
    const w = cl.findDuplicateWarnings(reflected, [{ line: "omega", subCategory: "machinery" }, { line: "zeta", subCategory: "land_building" }]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ manualIndex: 0, reason: "sub_category" });
    expect(cl.findDuplicateWarnings(reflected, [{ line: "alpha" }])[0].reason).toBeUndefined();
    expect(cl.findDuplicateWarnings(reflected, [{ line: "omega", subCategory: "machinery", dupDismissed: ["r1"] }])).toHaveLength(0);
  });
  test("staffing guard: direct_labor always warns; management_labor only against management roles", () => {
    const rows = [{ id: "s1", roleFamily: "production", grade: "g" }, { id: "s2", roleFamily: "management", grade: "g" }] as never;
    const direct = sp.findStaffingDuplicateWarnings(rows, [{ line: "salaries", category: "labor", subCategory: "direct_labor" }]);
    expect(direct.map((w) => w.rowId)).toEqual(["s1", "s2"]);
    const mgmt = sp.findStaffingDuplicateWarnings(rows, [{ line: "board pay", category: "labor", subCategory: "management_labor" }]);
    expect(mgmt.map((w) => w.rowId)).toEqual(["s2"]);
    const noMgmt = sp.findStaffingDuplicateWarnings([{ id: "s1", roleFamily: "production", grade: "g" }] as never, [{ line: "production", category: "labor", subCategory: "management_labor" }]);
    expect(noMgmt).toHaveLength(0);
    // Unset sub-category keeps the name rule.
    expect(sp.findStaffingDuplicateWarnings(rows, [{ line: "production", category: "labor" }]).map((w) => w.rowId)).toEqual(["s1"]);
  });
});

describe("route: POST /api/greenfield/[oppId] round trip (temp DB)", () => {
  const LEAD = "subcat-lead";
  let cookie = "";
  let oppId = "";
  const post = (body: unknown) => nextRequest(`/api/greenfield/${oppId}`, { method: "POST", headers: { cookie }, body: json(body) });
  const get = () => nextRequest(`/api/greenfield/${oppId}`, { headers: { cookie } });

  beforeAll(async () => {
    await createUser(db, { userId: LEAD, role: "analyst", password: `pw-${LEAD}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: LEAD, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId: LEAD, password: `pw-${LEAD}-12345` }) });
    cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
    oppId = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "subcat opp", "ind", "selected", LEAD, NOW]);
    db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "test", "alt", LEAD, NOW]);
  });

  test("valid sub-categories save and load back", async () => {
    const res = await post({ business_case_lines: [
      { source: "plan_meta", horizonYears: 5 },
      krw({ line: "plant", category: "capex", subCategory: "machinery", amount: 1200 }),
      krw({ line: "legacy", category: "opex", amount: 30 }),
    ] });
    expect(res.status).toBe(200);
    const body = await (await get()).json() as { data: { assessment: { business_case_lines: Array<Record<string, unknown>> } } };
    const lines = body.data.assessment.business_case_lines;
    expect(lines.find((l) => l.line === "plant")).toMatchObject({ category: "capex", subCategory: "machinery", amountKrwM: 1200 });
    expect(lines.find((l) => l.line === "legacy")?.subCategory).toBeUndefined();
  });
  test("parent mismatch -> 400 subcategory_parent_mismatch, stored lines unchanged", async () => {
    const before = (db.query("SELECT business_case_lines_json j FROM greenfield_assessment WHERE opportunity_id = ?").get(oppId) as { j: string }).j;
    const res = await post({ business_case_lines: [krw({ line: "bad", category: "labor", subCategory: "machinery" })] });
    expect(res.status).toBe(400);
    const err = await res.json() as { error?: { code?: string } };
    expect(JSON.stringify(err)).toContain("subcategory_parent_mismatch");
    const after = (db.query("SELECT business_case_lines_json j FROM greenfield_assessment WHERE opportunity_id = ?").get(oppId) as { j: string }).j;
    expect(after).toBe(before);
  });
  test("unknown key -> 400 invalid_sub_category", async () => {
    const res = await post({ business_case_lines: [krw({ line: "bad", category: "capex", subCategory: "warp_drive" })] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("invalid_sub_category");
  });
});
