// @version 1.0.0
/**
 * ADR-0178 slice 1 - pre-launch (year-0) investment flag: `startYear: 0` on an S5 capex lump-sum line.
 * Validator matrix, legacy bit-identity (frozen hashes), year-0 in S5 totals/schedule/bands/MC,
 * plan_hash, copy/promotion/re-import/pinned fidelity, the S8 copy-path safe behaviour (excluded from
 * the per-year vectors, counted, flagged), and the no-migration check. ASCII-only source (Korean via
 * \u escapes). DB-backed parts use a scratch SQLite like the sibling tests; the schema check is :memory:.
 */
import { test, expect, afterAll, beforeAll, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-s5-prelaunch-year0.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const cl = await import("../../app/web-next/lib/capability-cost-lines.ts");
const vec = await import("../../app/web-next/lib/investment-vectors.ts");
const simLib = await import("../../app/web-next/lib/investment-simulation.ts");
const pinLib = await import("../../app/web-next/lib/s5-plan-pin.ts");
const gen = await import("../../app/web-next/lib/business-case-generator.ts");
const inputLib = await import("../../app/web-next/lib/investment-simulation-input.ts");
const pinRepo = await import("../../db/repositories/s5-plan-pin.ts");
const importRepo = await import("../../db/repositories/s5-cost-import.ts");

const NOW = new Date().toISOString();
const ACTOR = "prelaunch-analyst";
const json = JSON.stringify;
const KO_CAPEX_ONLY = "\uc124\ube44\ud22c\uc790(capex) \ubd84\ub958\uc758 \uc77c\uc2dc\ubd88 \ud56d\ubaa9\uc5d0\ub9cc"; // capex lump sum only
const KO_PRE = "\uc2dc\uc791 \uc804"; // si-jak jeon
const KO_FLAG = "year-0 \uc740 s5_pnl \uae30\uc900\uc5d0\uc11c\ub9cc \ubc18\uc601\ub428";

const ml = (line: string, category: string, amount: number, period: string, startYear?: number, endYear?: number, over: Record<string, unknown> = {}) => ({
  line, category, amount, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period, startYear, endYear, ...over,
});
const actor = { userId: ACTOR, at: NOW };
const norm = (lines: unknown[]) => cl.normalizeBusinessCaseLines([...lines, { source: "plan_meta", horizonYears: 5 }], [], null, actor);

beforeAll(async () => {
  await createUser(db, { userId: ACTOR, role: "analyst", password: "pw-prelaunch-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: ACTOR, approvedBy: "test", now: NOW });
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("validator: startYear 0 accept/reject matrix", () => {
  test("accepted only for a capex lump-sum manual line without an end year; stored as 0, not coerced", () => {
    const r = norm([ml("Plant0", "capex", 1500, "lumpsum", 0)]);
    expect(r.ok).toBe(true);
    const line = (r as { lines: Array<Record<string, unknown>> }).lines.find((l) => l.line === "Plant0")!;
    expect(line.startYear).toBe(0);
    expect(line.amountKrwM).toBe(1500);
  });

  const reject = (l: unknown) => {
    const r = norm([l]);
    expect(r.ok).toBe(false);
    const e = (r as { error: { code: string; message: string } }).error;
    expect(e.code).toBe("invalid_request");
    expect(e.message).toContain(KO_CAPEX_ONLY);
    return e;
  };
  test("rejected with a clear 400 for every other category and for non-lump-sum periods", () => {
    reject(ml("L", "labor", 100, "lumpsum", 0));
    reject(ml("O", "opex", 100, "lumpsum", 0));
    reject(ml("R", "revenue", 100, "lumpsum", 0));
    reject(ml("G", "gov_rnd", 100, "lumpsum", 0));
    reject(ml("Y", "capex", 100, "yearly", 0));
    reject(ml("M", "capex", 100, "monthly", 0));
    reject(ml("Q", "capex", 100, "quarterly", 0));
  });
  test("a year-0 line with an end year is rejected, never silently fixed", () => {
    const r = norm([ml("E", "capex", 100, "lumpsum", 0, 3)]);
    expect(r.ok).toBe(false);
    expect((r as { error: { message: string } }).error.message).toContain("\uc885\ub8cc \uc5f0\ucc28"); // end year
  });
  test("capability lines cannot be pre-launch (400, not a silent drop)", () => {
    const rows = [{ id: "k1", capability: "Cap", resolution: "build", closing_cost_krw_m: 300, months_to_attain: 12, grade: "high", confirmed_at: NOW, stale: false }] as never[];
    const r = cl.normalizeBusinessCaseLines([{ source: "capability", capabilityKey: "k1", reflected: true, category: "capex", startYear: 0 }], rows, null, actor);
    expect(r.ok).toBe(false);
    expect((r as { error: { code: string } }).error.code).toBe("invalid_request");
  });
  test("legacy values keep their rules: 1..horizon accepted, beyond the horizon rejected, startYear unset unchanged", () => {
    expect(norm([ml("A", "capex", 1, "lumpsum", 1)]).ok).toBe(true);
    expect(norm([ml("B", "capex", 1, "lumpsum", 6)]).ok).toBe(false);
    expect(norm([ml("C", "opex", 1, "yearly")]).ok).toBe(true);
    expect(cl.validateLineYears({ startYear: 0, category: "capex", period: "lumpsum" }, 5)).toBeNull();
    expect(cl.validateLineYears({ startYear: 0 }, 5)).not.toBeNull();
    expect(cl.validateLineYears({ startYear: -1 }, 5)).toBe("\uc2dc\uc791 \uc5f0\ucc28\ub294 1 \uc774\uc0c1\uc758 \uc815\uc218\uc5ec\uc57c \ud569\ub2c8\ub2e4.");
  });
  test("normalizeLegacyLine carries 0 faithfully (the reload path does not coerce to Y1)", () => {
    expect(cl.normalizeLegacyLine(ml("P", "capex", 10, "lumpsum", 0)).startYear).toBe(0);
    expect(cl.normalizeLegacyLine(ml("P", "capex", 10, "lumpsum", -2)).startYear).toBeUndefined();
  });
});

describe("legacy plans are bit-identical (frozen hashes, no new keys)", () => {
  const baseInput = () => ({
    manual: [
      ml("m", "opex", 120, "yearly", 1, 3),
      ml("c", "capex", 500, "lumpsum", 1, 1),
    ] as never[],
    capLines: [{ capabilityKey: "cap-a", name: "cap-a", line: "cap-a", category: "opex", costKrwM: 400, startYear: 2, defaultStartYear: 2, monthsToAttain: null, subCategory: null, reflected: true, persisted: true }] as never[],
    horizon: 5,
    reflectedKeys: new Set(["cap-a"]),
    staffing: null,
  });
  test("simulationInputHash equals the frozen slice-0 baseline values", () => {
    expect(simLib.simulationInputHash(baseInput(), 424242, 200)).toBe("afff30b3f621ad47dd0f5e8e59009e30a863d963d7eed82a62d574b8a3f98db9");
    expect(simLib.simulationInputHash({ ...baseInput(), overrides: { capabilityRange: 0.5 } }, 7, 500)).toBe("a23ebbecae7da3dc787d5480d15a868b0b01f38eac0abfe2c2f09349c8bf3e0c");
  });
  test("no pre-launch key appears anywhere for a legacy plan", () => {
    const v = vec.buildInvestmentVectors(baseInput());
    for (const k of ["low", "mode", "high"] as const) expect("preLaunchKrwM" in v[k]).toBe(false);
    expect("p" in simLib.investmentInputPayload(baseInput())).toBe(false);
    const s = cl.buildInvestmentSummary(baseInput().manual as never, [], 5, new Set());
    expect("preLaunchKrwM" in s).toBe(false);
    expect("preLaunchKrwM" in cl.scheduleTotals(s)).toBe(false);
    expect("manualPreLaunchKrwM" in cl.investmentTotals({ lines: [], orphans: [], totals: { capabilityKrwM: 0, reflectedKrwM: 0, reflectedCount: 0, needsRejudgeCount: 0 } }, new Set(), baseInput().manual as never)).toBe(false);
    const sim = simLib.simulateInvestment({ ...baseInput(), seed: 5, draws: 100 });
    expect("preLaunch" in sim).toBe(false);
    expect("preLaunchKrwM" in sim.mode).toBe(false);
  });
});

describe("year-0 in S5 totals, schedule, bands and simulation", () => {
  const withPre = () => [ml("Plant", "capex", 1200, "lumpsum", 1), ml("Site0", "capex", 1500, "lumpsum", 0, undefined, { subCategory: "machinery" })];
  test("manualLineYearVector never moves a year-0 line into Y1; preLaunchAmountOf counts it", () => {
    const l = ml("Site0", "capex", 1500, "lumpsum", 0);
    expect(cl.manualLineYearVector(l as never, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(cl.preLaunchAmountOf([l])).toBe(1500);
    expect(cl.manualLineAmounts(l as never, 5)).toEqual({ annualKrwM: null, totalKrwM: 1500 });
    // unconfirmed unit / non-KRW / ineligible category never count
    expect(cl.preLaunchAmountOf([ml("U", "capex", 5, "lumpsum", 0, undefined, { amountUnitConfirmed: false, amountUnit: undefined })])).toBe(0);
    expect(cl.preLaunchAmountOf([ml("F", "capex", 5, "lumpsum", 0, undefined, { currency: "USD", amountUnit: "fx_m" })])).toBe(0);
    expect(cl.preLaunchAmountOf([ml("O", "opex", 5, "lumpsum", 0)])).toBe(0);
  });
  test("summary: tile, capex row and totals include the \uc2dc\uc791 \uc804 amount; Y1..YN columns are untouched", () => {
    const legacy = cl.buildInvestmentSummary([withPre()[0]] as never, [], 5, new Set());
    const s = cl.buildInvestmentSummary(withPre() as never, [], 5, new Set());
    expect(s.preLaunchKrwM).toBe(1500);
    expect(s.schedule).toEqual(legacy.schedule);
    expect(s.totalKrwM).toBe(legacy.totalKrwM + 1500);
    expect(s.lumpsumKrwM).toBe(legacy.lumpsumKrwM + 1500);
    expect(s.capexSubtotalKrwM).toBe(legacy.capexSubtotalKrwM + 1500);
    const capexRow = s.byCategory.find((r) => r.category === "capex")!;
    expect(capexRow.totalKrwM).toBe(2700);
    const fac = s.bySubCategory.find((g) => g.category === "capex")!.rows.find((r) => r.key === "machinery");
    expect(fac?.preLaunchKrwM).toBe(1500);
    expect(fac?.totalKrwM).toBe(1500);
    const st = cl.scheduleTotals(s);
    expect(st.preLaunchKrwM).toBe(1500);
    expect(st.grandKrwM).toBe(2700);
    expect(st.rowTotals.capex).toBe(2700);
    expect(st.yearTotals).toEqual(cl.scheduleTotals(legacy).yearTotals);
    expect(cl.buildInvestmentChartData(s).cumulative[0]).toBe(1500 + 1200);
    const t = cl.investmentTotals({ lines: [], orphans: [], totals: { capabilityKrwM: 0, reflectedKrwM: 0, reflectedCount: 0, needsRejudgeCount: 0 } }, new Set(), withPre() as never);
    expect(t.manualPreLaunchKrwM).toBe(1500);
    expect(t.manualKrwM).toBe(2700);
    expect(t.manualLumpsumKrwM).toBe(2700);
    expect(t.grandKrwM).toBe(2700);
  });
  test("bands: the \uc2dc\uc791 \uc804 amount carries the manual-line range; Y1..H arrays are identical to the legacy plan", () => {
    const inp = (m: unknown[]) => ({ manual: m as never[], capLines: [], horizon: 5, reflectedKeys: new Set<string>(), staffing: null });
    const legacy = vec.buildInvestmentVectors(inp([withPre()[0]]));
    const v = vec.buildInvestmentVectors(inp(withPre()));
    for (const k of ["low", "mode", "high"] as const) {
      expect(v[k].totalByYear).toEqual(legacy[k].totalByYear);
      expect(v[k].manualByYear).toEqual(legacy[k].manualByYear);
    }
    expect(v.mode.preLaunchKrwM).toBe(1500);
    expect(v.low.preLaunchKrwM).toBe(1200); // -20% manual range
    expect(v.high.preLaunchKrwM).toBe(1800);
    expect(v.mode.grandKrwM).toBe(legacy.mode.grandKrwM + 1500);
    expect(v.mode.manualKrwM).toBe(legacy.mode.manualKrwM + 1500);
    expect(v.low.grandKrwM).toBe(Math.round((legacy.low.grandKrwM + 1200) * 100) / 100);
  });
  test("simulation: seeded draws are unchanged for Y1..H, the total includes the scaled \uc2dc\uc791 \uc804 amount, hash changes only with a line", () => {
    const base = { manual: [withPre()[0]] as never[], capLines: [], horizon: 5, reflectedKeys: new Set<string>(), staffing: null };
    const withP = { ...base, manual: withPre() as never[] };
    const a = simLib.simulateInvestment({ ...base, seed: 11, draws: 200 });
    const b = simLib.simulateInvestment({ ...withP, seed: 11, draws: 200 });
    expect(b.totalByYear).toEqual(a.totalByYear);
    expect(b.mode.preLaunchKrwM).toBe(1500);
    expect(b.mode.grandKrwM).toBe(a.mode.grandKrwM + 1500);
    expect(b.preLaunch!.p05).toBeGreaterThanOrEqual(1200);
    expect(b.preLaunch!.p95).toBeLessThanOrEqual(1800);
    expect(b.total.p50).toBeGreaterThan(a.total.p50 + 1000);
    expect(simLib.simulationInputHash(base, 11, 200)).not.toBe(simLib.simulationInputHash(withP, 11, 200));
    expect(json(simLib.investmentInputPayload(withP))).toContain("\"p\":1500");
  });
});

describe("plan_hash changes only when a year-0 line exists", () => {
  const base = (manual: unknown[]) => ({ manual: manual as never[], capLines: [], horizon: 5, reflectedKeys: new Set<string>(), staffing: null });
  test("a pin made without the line is stale against the source with it (and vice versa)", () => {
    const without = base([ml("Plant", "capex", 1200, "lumpsum", 1)]);
    const withLine = base([ml("Plant", "capex", 1200, "lumpsum", 1), ml("Site0", "capex", 1500, "lumpsum", 0)]);
    expect(pinLib.s5PlanHashOf(without)).toBe(pinLib.s5PlanHashOf(base([ml("Plant", "capex", 1200, "lumpsum", 1)])));
    expect(pinLib.s5PlanHashOf(withLine)).not.toBe(pinLib.s5PlanHashOf(without));
    // moving the same amount from year 0 to year 1 also changes the hash (covers startYear)
    expect(pinLib.s5PlanHashOf(base([ml("Plant", "capex", 1200, "lumpsum", 1), ml("Site0", "capex", 1500, "lumpsum", 1)]))).not.toBe(pinLib.s5PlanHashOf(withLine));
    // snapshot round trip keeps the year-0 line
    const back = pinLib.parsePinSnapshot(pinLib.serializePinSnapshot(withLine))!;
    expect(pinLib.s5PlanHashOf(back)).toBe(pinLib.s5PlanHashOf(withLine));
  });
  test("pinPlanLinesOf carries start_year 0 verbatim and aggregatePlanLines reports it instead of indexing capexByYear[-1]", () => {
    const withLine = base([ml("Plant", "capex", 1200, "lumpsum", 1), ml("Site0", "capex", 1500, "lumpsum", 0)]);
    const { horizon, lines } = pinLib.pinPlanLinesOf(withLine);
    expect(lines.map((l) => l.start_year)).toEqual([1, 0]);
    const agg = pinLib.aggregatePlanLines(horizon, lines);
    expect(agg.capexByYear).toEqual([1200, 0, 0, 0, 0]);
    expect(agg.preLaunchKrwM).toBe(1500);
    expect(agg.preLaunchLines).toBe(1);
    expect(agg.skippedLines).toBe(0);
    const legacyAgg = pinLib.aggregatePlanLines(5, pinLib.pinPlanLinesOf(base([ml("Plant", "capex", 1200, "lumpsum", 1)])).lines);
    expect("preLaunchKrwM" in legacyAgg).toBe(false);
  });
  test("pinPlanLinesOf derives capability lines at 주기당 semantics (2026-10-19 decider report: 갱신 후에도 설비투자 미반영)", () => {
    // The pinned snapshot stores the SOURCE state (period + window); the annual
    // amount is derived at READ time — 월간 ×12, 연간 windowed, lumpsum at start.
    const cap = (over: Record<string, unknown>) => ({
      capabilityKey: "cap-a", name: "cap-a", line: "cap-a", category: "capex",
      costKrwM: 2000, startYear: 1, defaultStartYear: 1, monthsToAttain: null,
      subCategory: null, reflected: true, persisted: true, ...over,
    }) as never;
    const input = { manual: [] as never[], capLines: [
      cap({ period: "monthly", endYear: 5, category: "opex" }),
      cap({ period: "yearly", endYear: 2 }),
      cap({ period: "lumpsum", endYear: 1 }),
    ], horizon: 5, reflectedKeys: new Set<string>(), staffing: null };
    const derived = pinLib.pinPlanLinesOf(input as never).lines;
    expect(derived.map((l) => [l.annual_amount_krw_m, l.start_year, l.end_year])).toEqual([
      [24000, 1, 5], // 월 2,000 × 12, window kept
      [2000, 1, 2],  // 연간 = per-year amount over the window (NOT 균분)
      [2000, 1, 1],  // 일시불 total at start year
    ]);
  });
});

// -- DB-backed: promotion copy, S8 copy path, pinned path, re-import -------------------------------
function makeOpp(lines: unknown[]): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ACTOR, NOW, json({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), 80000, 0.06]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "r", "alt", ACTOR, NOW]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ACTOR, NOW]);
  }
  db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), oppId, "s", "a", "r", ACTOR, NOW, NOW, json(lines)]);
  return oppId;
}
const promote = (oppId: string): string => promoteOpportunity(oppId, { promotedBy: ACTOR, needToKnowBasis: "t" }).project.id;
const oppOf = (pid: string): string => (db.query("SELECT source_opportunity_id AS o FROM md_project WHERE id = ?").get(pid) as { o: string }).o;
const setLines = (oppId: string, lines: unknown[]) => db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [json(lines), oppId]);
const optIn = (pid: string, v: 0 | 1 = 1) => gen.recordBusinessCaseParams(db, { projectId: pid, params: { s5_source: v }, rationale: "t", actor: ACTOR });
const setBasis = (pid: string, b: "ratio" | "s5_plan" | "s5_plan_full") => gen.recordBusinessCaseParams(db, { projectId: pid, params: { investment_basis: b }, rationale: "t", actor: ACTOR });
const copiedLines = (pid: string) => db.query("SELECT name, category, start_year, end_year, annual_amount_krw_m, unit FROM business_case_line WHERE model_id IN (SELECT id FROM business_case_model WHERE project_id = ? AND kind = 'greenfield_cost' AND archived_at IS NULL) ORDER BY name").all(pid) as Array<{ name: string; category: string; start_year: number; end_year: number | null; annual_amount_krw_m: number; unit: string }>;

const SAVED = [
  ml("Plant", "capex", 1200, "lumpsum", 1),
  ml("Staff", "labor", 40, "monthly", 1),
  ml("Site0", "capex", 1500, "lumpsum", 0),
  { source: "plan_meta", horizonYears: 5 },
];
const SAVED_LEGACY = SAVED.filter((l) => (l as { line?: string }).line !== "Site0");

describe("copy / promotion / re-import carry year 0 faithfully", () => {
  test("promotion copy stores start_year 0 / end_year 0 (not coerced to 1)", () => {
    const pid = promote(makeOpp(SAVED));
    const rows = copiedLines(pid);
    const site = rows.find((r) => r.name === "Site0")!;
    expect(site).toMatchObject({ category: "capex", start_year: 0, end_year: 0, annual_amount_krw_m: 1500, unit: "KRW_M" });
    expect(rows.find((r) => r.name === "Plant")!.start_year).toBe(1);
  });
  test("human re-import carries it, and a re-import after removing the line drops it", () => {
    const pid = promote(makeOpp(SAVED_LEGACY));
    expect(copiedLines(pid).some((r) => r.start_year === 0)).toBe(false);
    setLines(oppOf(pid), SAVED);
    importRepo.applyS5Reimport(db, pid, ACTOR);
    expect(copiedLines(pid).find((r) => r.name === "Site0")).toMatchObject({ start_year: 0, end_year: 0, annual_amount_krw_m: 1500 });
    setLines(oppOf(pid), SAVED_LEGACY);
    importRepo.applyS5Reimport(db, pid, ACTOR);
    expect(copiedLines(pid).some((r) => r.start_year === 0)).toBe(false);
  });
  test("the loader (reload path) keeps startYear 0 on the manual line", () => {
    const input = inputLib.loadInvestmentVectorsInput(db, oppOf(promote(makeOpp(SAVED))))!;
    expect(input.manual.find((m) => m.line === "Site0")?.startYear).toBe(0);
    expect(vec.buildInvestmentVectors(input).mode.preLaunchKrwM).toBe(1500);
  });
});

describe("S8 COPY path: safe behaviour until s5_pnl (slice 2)", () => {
  test("year-0 lines are excluded from the per-year vectors, counted, never moved into year 1 or dropped", () => {
    const withPre = gen.resolveS5InvestmentPlan(db, promote(makeOpp(SAVED)))!;
    const without = gen.resolveS5InvestmentPlan(db, promote(makeOpp(SAVED_LEGACY)))!;
    expect(withPre.capexByYear).toEqual(without.capexByYear);
    expect(withPre.capexByYear[0]).toBe(1200); // NOT 2700: the 1500 was not moved into year 1
    expect(withPre.laborOpexByYear).toEqual(without.laborOpexByYear);
    expect(withPre.skippedLines).toBe(without.skippedLines); // not "skipped": surfaced separately
    expect(withPre.preLaunchKrwM).toBe(1500);
    expect(withPre.preLaunchLines).toBe(1);
    expect(withPre.lineHash).not.toBe(without.lineHash); // provenance sees the extra line
    expect("preLaunchKrwM" in without).toBe(false);
  });
  test("s5_plan run note carries prelaunch_krw_m and the visible flag; legacy notes are unchanged", async () => {
    const pid = promote(makeOpp(SAVED));
    await setBasis(pid, "s5_plan");
    await gen.generateBusinessCases(pid, { actor: ACTOR });
    const notes = (db.query("SELECT DISTINCT note FROM valuation_simulation WHERE project_id = ?").all(pid) as Array<{ note: string }>).map((r) => r.note);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      expect(n).toContain("prelaunch_krw_m=1500.00");
      expect(n).toContain("prelaunch_lines=1");
      expect(n).toContain(KO_FLAG);
    }
    const pid2 = promote(makeOpp(SAVED_LEGACY));
    await setBasis(pid2, "s5_plan");
    await gen.generateBusinessCases(pid2, { actor: ACTOR });
    const legacyNotes = (db.query("SELECT DISTINCT note FROM valuation_simulation WHERE project_id = ?").all(pid2) as Array<{ note: string }>).map((r) => r.note);
    expect(legacyNotes.every((n) => !n.includes("prelaunch"))).toBe(true);
  });
  test("S9 capex reconciliation counts the single year-0 outlay (no silent drop)", () => {
    // the copy rows are what the reconciliation reads: start_year 0 contributes once, as entered
    const pid = promote(makeOpp(SAVED));
    const modelId = (db.query("SELECT id FROM business_case_model WHERE project_id = ? AND kind = 'greenfield_cost' ORDER BY created_at DESC LIMIT 1").get(pid) as { id: string }).id;
    const rows = db.query("SELECT annual_amount_krw_m, start_year, end_year, growth_rate FROM business_case_line WHERE model_id = ? AND category = 'capex'").all(modelId) as Array<{ annual_amount_krw_m: number; start_year: number; end_year: number | null; growth_rate: number }>;
    expect(rows.map((r) => r.start_year).sort()).toEqual([0, 1]);
    const src = readFileSync(join(PROJECT_ROOT, "app/web-next/lib/greenfield-execution.ts"), "utf-8");
    expect(src).toContain("l.start_year === 0");
  });
});

describe("pinned path: the pin carries year 0, same safe behaviour, stale vs a pin without it", () => {
  test("pinned plan equals the copy's (vectors + pre-launch), the summary reports pre_launch_total, and the pin goes stale when the line is added", async () => {
    const opp = makeOpp(SAVED_LEGACY);
    const pid = promote(opp);
    const firstPin = pinRepo.previewS5Repin(db, pid);
    expect(firstPin.current.pre_launch_total).toBe(0);
    const oldHash = firstPin.pinned!.plan_hash;
    setLines(opp, SAVED);
    const prev = pinRepo.previewS5Repin(db, pid);
    expect(prev.changes.plan).toBe(true); // a pin without the year-0 line is stale against a source with it
    expect(prev.current.pre_launch_total).toBe(1500);
    expect(prev.current.plan_hash).not.toBe(oldHash);
    expect(prev.current.by_year.capex[0]).toBe(1200); // not moved into year 1
  });
  test("pin + copy refreshed together give the same plan; opt-in switches the path without changing the vectors", async () => {
    const opp = makeOpp(SAVED);
    const pid = promote(opp); // initial pin made at promotion includes the line
    const copy = gen.resolveS5InvestmentPlan(db, pid)!;
    await optIn(pid, 1);
    const pinned = gen.resolveS5InvestmentPlan(db, pid)!;
    expect(pinned.pinId).toBeDefined();
    expect(pinned.capexByYear).toEqual(copy.capexByYear);
    expect(pinned.laborOpexByYear).toEqual(copy.laborOpexByYear);
    expect(pinned.preLaunchKrwM).toBe(1500);
    expect(pinned.preLaunchLines).toBe(1);
    await setBasis(pid, "s5_plan");
    await gen.generateBusinessCases(pid, { actor: ACTOR });
    const notes = (db.query("SELECT DISTINCT note FROM valuation_simulation WHERE project_id = ?").all(pid) as Array<{ note: string }>).map((r) => r.note);
    for (const n of notes) { expect(n).toContain("s5_pin="); expect(n).toContain(KO_FLAG); }
  });
});

describe("no migration: business_case_line.start_year already accepts 0 (0143-0147 schema)", () => {
  test(":memory: schema through 0147 stores start_year 0 and end_year 0", () => {
    const DIR = join(PROJECT_ROOT, "db", "migrations");
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(files.some((f) => f.startsWith("0143_"))).toBe(true);
    expect(files.some((f) => f.startsWith("0147_"))).toBe(true);
    const d = new Database(":memory:");
    d.run("PRAGMA foreign_keys = ON");
    d.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) {
      if (f > "0147_zzz") break;
      for (const s of splitSqlStatements(readFileSync(join(DIR, f), "utf-8"))) d.run(s);
    }
    const info = (d.query("PRAGMA table_info(business_case_line)").all() as Array<{ name: string; type: string; notnull: number }>).find((c) => c.name === "start_year")!;
    expect(info.type).toBe("INTEGER");
    const ddl = (d.query("SELECT sql FROM sqlite_master WHERE name = 'business_case_line'").get() as { sql: string }).sql;
    expect(ddl).not.toMatch(/CHECK\s*\(\s*start_year/i);
    d.run("INSERT INTO md_project (id, project_no, created_at, origin) VALUES ('p','PRJ-0',?,'internal')", [NOW]);
    d.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES ('m','p','greenfield_cost','n',5,'u',?)", [NOW]);
    d.run("INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, unit, start_year, end_year, growth_rate, created_by, created_at) VALUES ('l','m','capex','x',10,'KRW_M',0,0,0,'u',?)", [NOW]);
    const r = d.query("SELECT start_year AS s, end_year AS e FROM business_case_line WHERE id = 'l'").get() as { s: number; e: number };
    expect(r).toEqual({ s: 0, e: 0 });
    expect(KO_PRE.length).toBeGreaterThan(0);
  });
});
