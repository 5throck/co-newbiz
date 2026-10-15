// @version 1.0.0
/**
 * ADR-0178 slice 0 - S5 plan pin (S5 single source, S8 pinned reference).
 * Migration 0147 schema, hash definition, pin lifecycle, pinned read path (parity with the copy),
 * stale rules, human-only re-pin route, params opt-in, promotion initial pin, Brown Field untouched.
 * Real route handlers + scratch SQLite; migration test on :memory:. ASCII-only source (Korean via
 * \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-s5-plan-pin.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { runAsPrincipal } = await import("../../app/web-next/lib/mcp/principal-context.ts");
const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const pinRoute = await import("../../app/web-next/app/api/projects/[id]/business-case/s5-pin/route.ts");
const gen = await import("../../app/web-next/lib/business-case-generator.ts");
const pinLib = await import("../../app/web-next/lib/s5-plan-pin.ts");
const pinS8 = await import("../../app/web-next/lib/s5-plan-pin-s8.ts");
const simLib = await import("../../app/web-next/lib/investment-simulation.ts");
const inputLib = await import("../../app/web-next/lib/investment-simulation-input.ts");
const s8 = await import("../../app/web-next/lib/investment-simulation-s8.ts");
const vec = await import("../../app/web-next/lib/investment-vectors.ts");
const runRepo = await import("../../db/repositories/investment-simulation-run.repository.ts");
const pinRepo = await import("../../db/repositories/s5-plan-pin.ts");

const NOW = new Date().toISOString();
const ANALYST = "pin-analyst";
const VIEWER = "pin-viewer";
let cookie = "";
let viewerCookie = "";
const json = JSON.stringify;

const CAP_ROW = {
  id: "cap1", capability: "Cap One", source: "manual", resolution: "hire", held: { status: "unmet" },
  attainability: { closingCostKrwM: 400, monthsToAttain: 12, grade: "medium", rationale: "r", evidence: [], draftedBy: "human", confirmedBy: "u", confirmedAt: NOW, category: "capex" },
};
const ml = (line: string, category: string, amount: number, period: string, startYear?: number, endYear?: number) => ({
  line, category, amount, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period, startYear, endYear,
});
const LINES = [
  ml("Plant", "capex", 1200, "lumpsum", 1),
  ml("Staff", "labor", 40, "monthly", 1),
  ml("Ops", "opex", 150, "yearly", 2, 4),
  ml("Grant", "gov_rnd", 100, "lumpsum", 2),
  { line: "NoUnit", category: "opex", amount: 3 },
  { source: "capability", capabilityKey: "cap1", reflected: true, category: "capex", startYear: 2, line: "Cap One" },
  { source: "plan_meta", horizonYears: 5 },
];

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
function makeOpp(track: "greenfield" | "brownfield", lines: unknown[] | null, withCap = true): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ANALYST, NOW, json({ rows: withCap ? [CAP_ROW] : [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), 80000, 0.06]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, track, "r", "alt", ANALYST, NOW]);
  for (const gate of track === "greenfield" ? ["screening", "pre_fs"] : ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ANALYST, NOW]);
  }
  if (track === "greenfield") {
    db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), oppId, "s", "a", "r", ANALYST, NOW, NOW, lines ? json(lines) : null]);
  } else {
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), oppId, "T", "shortlisted", 1, NOW, NOW]);
  }
  return oppId;
}
const promote = (oppId: string): string => promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "t" }).project.id;
const oppOf = (pid: string): string => (db.query("SELECT source_opportunity_id AS o FROM md_project WHERE id = ?").get(pid) as { o: string }).o;
const setLines = (oppId: string, lines: unknown[]) => db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [json(lines), oppId]);
const pinRows = (pid: string) => db.query("SELECT * FROM s5_plan_pin WHERE project_id = ? ORDER BY pinned_at, id").all(pid) as Array<Record<string, unknown>>;
const optIn = (pid: string, v: 0 | 1 = 1) => gen.recordBusinessCaseParams(db, { projectId: pid, params: { s5_source: v }, rationale: "t", actor: ANALYST });
const setBasis = (pid: string, b: "ratio" | "s5_plan" | "s5_plan_full") => gen.recordBusinessCaseParams(db, { projectId: pid, params: { investment_basis: b }, rationale: "t", actor: ANALYST });
const url = (id: string) => `/api/projects/${id}/business-case/s5-pin`;
const planCmp = (p: NonNullable<ReturnType<typeof gen.resolveS5InvestmentPlan>>) => ({ capex: p.capexByYear, labor: p.laborOpexByYear, gov: p.govRndByYear, covered: p.opexCovered, capexCap: p.capexCapabilityByYear, laborCap: p.laborOpexCapabilityByYear, skipped: p.skippedLines, horizon: p.horizonYears });
function confirmRun(oppId: string, hash: string, seed = 99) {
  const run = runRepo.insertInvestmentSimulationRun({ opportunityId: oppId, inputHash: hash, seed, drawCount: 200, horizonYears: 5, envelopeKrwM: null, assumptions: { salaryRange: 0.1, salaryIncreaseRangePp: 2, onCostRangePp: 2, rampShiftHalfYears: 0.5, capabilityRange: 0.3, manualLineRange: 0.2 }, results: {}, actor: ANALYST, now: new Date().toISOString() }, db);
  runRepo.confirmInvestmentSimulationRun(oppId, run.id, ANALYST, new Date().toISOString(), db);
  return run;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-pin-analyst-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-pin-viewer-123", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-pin-analyst-12");
  viewerCookie = await login(VIEWER, "pw-pin-viewer-123");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// -- migration 0147 ------------------------------------------------------------------------------
describe("migration 0147 s5_plan_pin", () => {
  const DIR = join(PROJECT_ROOT, "db", "migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const TARGET = files.find((f) => f.startsWith("0147_"))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");
  const runSql = (d: Database, sql: string) => { for (const s of splitSqlStatements(sql)) d.run(s); };
  function through(last: string): Database {
    const d = new Database(":memory:");
    d.run("PRAGMA foreign_keys = ON");
    d.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) { if (f > last) break; runSql(d, readFileSync(join(DIR, f), "utf-8")); }
    return d;
  }
  const seed = (d: Database) => {
    d.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES ('o1','opp','u',?)", [NOW]);
    d.run("INSERT INTO md_project (id, project_no, created_at, origin, source_opportunity_id, track) VALUES ('p1','PRJ-X',?,'internal','o1','greenfield')", [NOW]);
  };
  const ins = (d: Database, id: string, over: Record<string, unknown> = {}) => {
    const r = { id, project_id: "p1", opportunity_id: "o1", plan_hash: "h", s5_sim_run_id: null, s5_sim_input_hash: null, input_snapshot_json: "{}", pinned_by: "u", pinned_at: NOW, superseded_at: null, superseded_by: null, reason: "initial", audit_id: null, ...over };
    d.run("INSERT INTO s5_plan_pin (id, project_id, opportunity_id, plan_hash, s5_sim_run_id, s5_sim_input_hash, input_snapshot_json, pinned_by, pinned_at, superseded_at, superseded_by, reason, audit_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [r.id, r.project_id, r.opportunity_id, r.plan_hash, r.s5_sim_run_id, r.s5_sim_input_hash, r.input_snapshot_json, r.pinned_by, r.pinned_at, r.superseded_at, r.superseded_by, r.reason, r.audit_id]);
  };

  test("declared reversible with rollback SQL; applies on top of 0143-0146 together", () => {
    expect(SQL).toContain("@reversible: true");
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    const d = through("0146_zzz");
    expect(d.query("SELECT 1 FROM sqlite_master WHERE name = 's5_plan_pin'").get()).toBeNull();
    d.transaction(() => runSql(d, SQL))();
    const cols = (d.query("PRAGMA table_info(s5_plan_pin)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "project_id", "opportunity_id", "plan_hash", "s5_sim_run_id", "s5_sim_input_hash", "input_snapshot_json", "pinned_by", "pinned_at", "superseded_at", "superseded_by", "reason"]));
    // the earlier objects of 0143-0146 are all present next to it
    for (const n of ["investment_simulation_run", "idx_isr_confirmed", "idx_s5_plan_pin_current"]) expect(d.query("SELECT 1 FROM sqlite_master WHERE name = ?").get(n)).not.toBeNull();
    expect(files.filter((f) => f >= "0143_" && f < "0148_").length).toBeGreaterThanOrEqual(5);
  });

  test("one current row per project; supersede chain; append-only guard triggers", () => {
    const d = through(TARGET);
    seed(d);
    ins(d, "a");
    expect(() => ins(d, "b")).toThrow(); // second current row for the project
    // supersede a -> b in one transaction (superseded_by is deferrable)
    d.transaction(() => {
      d.run("UPDATE s5_plan_pin SET superseded_at = ?, superseded_by = 'b' WHERE id = 'a'", [NOW]);
      ins(d, "b", { reason: "repin" });
    })();
    expect((d.query("SELECT COUNT(*) AS n FROM s5_plan_pin WHERE superseded_at IS NULL").get() as { n: number }).n).toBe(1);
    expect(() => d.run("DELETE FROM s5_plan_pin WHERE id = 'a'")).toThrow(/append-only/);
    expect(() => d.run("UPDATE s5_plan_pin SET plan_hash = 'x' WHERE id = 'b'")).toThrow(/immutable/);
    expect(() => d.run("UPDATE s5_plan_pin SET input_snapshot_json = '{\"x\":1}' WHERE id = 'b'")).toThrow(/immutable/);
    expect(() => d.run("UPDATE s5_plan_pin SET superseded_at = NULL, superseded_by = NULL WHERE id = 'a'")).toThrow(); // a superseded row never reopens
    // CHECKs
    expect(() => ins(d, "c", { project_id: "p1", reason: "bogus" })).toThrow();
    expect(() => ins(d, "d", { superseded_at: NOW })).toThrow(); // superseded_at without superseded_by
    expect(() => ins(d, "e", { input_snapshot_json: "not json" })).toThrow();
  });

  test("additive: header rollback restores the pre-0147 shape", () => {
    const d = through(TARGET);
    const block = SQL.slice(SQL.indexOf("ROLLBACK-SQL-BEGIN"), SQL.indexOf("ROLLBACK-SQL-END"));
    const stmts = block.split("\n").slice(1).map((l) => l.replace(/^--\s*/, "").trim()).filter((l) => l.endsWith(";"));
    expect(stmts.length).toBeGreaterThanOrEqual(5);
    for (const s of stmts) d.run(s);
    expect(d.query("SELECT 1 FROM sqlite_master WHERE name LIKE '%s5_plan_pin%'").get()).toBeNull();
  });
});

// -- hash definition -----------------------------------------------------------------------------
describe("plan_hash and the shared S5 input hash", () => {
  const baseInput = () => ({
    manual: [
      { line: "m", category: "opex", amount: 120, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, endYear: 3 },
      { line: "c", category: "capex", amount: 500, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", startYear: 1, endYear: 1 },
    ] as never[],
    capLines: [{ capabilityKey: "cap-a", name: "cap-a", line: "cap-a", category: "opex", costKrwM: 400, startYear: 2, defaultStartYear: 2, monthsToAttain: null, subCategory: null, reflected: true, persisted: true }] as never[],
    horizon: 5,
    reflectedKeys: new Set(["cap-a"]),
    staffing: null,
  });

  test("simulationInputHash is byte-identical to the pre-refactor definition (frozen on the baseline)", () => {
    expect(simLib.simulationInputHash(baseInput(), 424242, 200)).toBe("afff30b3f621ad47dd0f5e8e59009e30a863d963d7eed82a62d574b8a3f98db9");
    expect(simLib.simulationInputHash({ ...baseInput(), overrides: { capabilityRange: 0.5 } }, 7, 500)).toBe("a23ebbecae7da3dc787d5480d15a868b0b01f38eac0abfe2c2f09349c8bf3e0c");
  });

  test("plan_hash is stable, survives the snapshot round trip, and shares the simulation payload", () => {
    const input = baseInput();
    const h = pinLib.s5PlanHashOf(input);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(pinLib.s5PlanHashOf(baseInput())).toBe(h);
    const back = pinLib.parsePinSnapshot(pinLib.serializePinSnapshot(input))!;
    expect(pinLib.s5PlanHashOf(back)).toBe(h);
    expect(pinLib.serializePinSnapshot(back)).toBe(pinLib.serializePinSnapshot(input));
    expect(JSON.stringify(simLib.investmentInputPayload(input))).toContain("\"h\":5");
  });

  test("plan_hash changes with a category move, a timing change, a gov_rnd line and a range override", () => {
    const h = pinLib.s5PlanHashOf(baseInput());
    const moved = baseInput();
    (moved.manual[0] as { category: string }).category = "labor";
    expect(pinLib.s5PlanHashOf(moved)).not.toBe(h);
    const timed = baseInput();
    (timed.manual[1] as { startYear: number; endYear: number }).startYear = 2;
    (timed.manual[1] as { startYear: number; endYear: number }).endYear = 2;
    expect(pinLib.s5PlanHashOf(timed)).not.toBe(h);
    const gov = baseInput();
    gov.manual.push(ml("g", "gov_rnd", 50, "lumpsum", 2) as never);
    expect(pinLib.s5PlanHashOf(gov)).not.toBe(h);
    expect(pinLib.s5PlanHashOf({ ...baseInput(), overrides: { manualLineRange: 0.4 } })).not.toBe(h);
    expect(pinLib.s5PlanHashOf({ ...baseInput(), horizon: 6 })).not.toBe(h);
  });

  test("verification (b): a gov_rnd line is not part of the S5 simulation (neither vectors nor draws)", () => {
    const withGov = baseInput();
    withGov.manual.push(ml("g", "gov_rnd", 5000, "lumpsum", 2) as never);
    expect(vec.buildInvestmentVectors(withGov).mode.manualByYear).toEqual(vec.buildInvestmentVectors(baseInput()).mode.manualByYear);
    expect(simLib.simulationInputHash(withGov, 1, 100)).toBe(simLib.simulationInputHash(baseInput(), 1, 100));
    expect(simLib.simulateInvestment({ ...withGov, seed: 5, draws: 100 })).toEqual(simLib.simulateInvestment({ ...baseInput(), seed: 5, draws: 100 }));
  });
});

// -- promotion, lifecycle, parity ----------------------------------------------------------------
describe("promotion writes the initial pin but keeps the copy path", () => {
  test("Green Field with an importable plan: copy model + one current pin (reason=initial); params stay on copy", () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    const rows = pinRows(pid);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ reason: "initial", pinned_by: ANALYST, superseded_at: null, opportunity_id: opp, s5_sim_run_id: null });
    expect(rows[0].plan_hash).toBe(pinLib.s5PlanHashOf(inputLib.loadInvestmentVectorsInput(db, opp)!));
    const p = gen.resolveBusinessCaseParams(db, pid);
    expect(p.s5Source).toBe("copy");
    expect(p.s5PinId).toBeNull();
    const plan = gen.resolveS5InvestmentPlan(db, pid)!;
    expect(plan.pinId).toBeUndefined();
    expect(plan.modelId).not.toMatch(/^pin:/);
    expect(db.query("SELECT COUNT(*) AS n FROM assumption WHERE assumption_key = 'bc.s5_source'").get()).toEqual({ n: 0 });
    expect((db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 's5_plan_pin.pinned' AND target LIKE ?").get(`${pid}#%`) as { n: number }).n).toBe(1);
  });

  test("nothing importable, no plan, and Brown Field: no pin row", () => {
    expect(pinRows(promote(makeOpp("greenfield", [{ line: "NoUnit", category: "opex", amount: 3 }]))).length).toBe(0);
    expect(pinRows(promote(makeOpp("greenfield", null))).length).toBe(0);
    const bf = promote(makeOpp("brownfield", null));
    expect(pinRows(bf).length).toBe(0);
    expect(gen.resolveS5InvestmentPlan(db, bf)).toBeNull();
    expect(gen.resolveBusinessCaseParams(db, bf).s5Source).toBe("copy");
  });
});

describe("pinned read path", () => {
  test("opt-in off with a pin: copy path, bit-identical (same plan object as without any pin)", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const before = JSON.stringify(gen.resolveS5InvestmentPlan(db, pid));
    expect(pinRows(pid).length).toBe(1);
    expect(JSON.stringify(gen.resolveS5InvestmentPlan(db, pid))).toBe(before);
    expect(gen.resolveS5InvestmentPlan(db, pid)!.pinId).toBeUndefined();
    await optIn(pid, 0);
    expect(gen.resolveS5InvestmentPlan(db, pid)!.pinId).toBeUndefined();
  });

  test("opt-in without a current pin falls back to the copy", async () => {
    const pid = promote(makeOpp("greenfield", [{ line: "NoUnit", category: "opex", amount: 3 }]));
    await optIn(pid);
    expect(gen.resolveS5InvestmentPlan(db, pid)).toBeNull();
    expect(gen.resolveBusinessCaseParams(db, pid).s5Source).toBe("copy");
  });

  test("PARITY: pinned plan vectors equal the copy's for the same source (capability, monthly, lump sum, gov_rnd, skipped lines)", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const copy = gen.resolveS5InvestmentPlan(db, pid)!;
    expect(copy.capexCapabilityByYear!.some((v) => v > 0)).toBe(true); // the fixture really exercises the capability split
    expect(copy.govRndByYear.some((v) => v > 0)).toBe(true);
    await optIn(pid);
    const pinned = gen.resolveS5InvestmentPlan(db, pid)!;
    expect(pinned.pinId).toBeDefined();
    expect(planCmp(pinned)).toEqual(planCmp(copy));
    expect(gen.resolveBusinessCaseParams(db, pid)).toMatchObject({ s5Source: "pinned", s5PinId: pinned.pinId, s5PlanHorizonYears: copy.horizonYears });
    // identical simulation results for s5_plan and s5_plan_full on the same project seed
    for (const basis of ["s5_plan", "s5_plan_full"] as const) {
      await setBasis(pid, basis);
      await optIn(pid, 0);
      const a = gen.caseInputsForProject(pid);
      await optIn(pid, 1);
      const b = gen.caseInputsForProject(pid);
      expect(a.s5Plan!.pinId).toBeUndefined();
      expect(b.s5Plan!.pinId).toBeDefined();
      for (const scenario of ["base", "downside"] as const) {
        expect(gen.runSeededSimulation(b, scenario)).toEqual(gen.runSeededSimulation(a, scenario));
        expect(gen.deterministicCashflows(b, scenario)).toEqual(gen.deterministicCashflows(a, scenario));
      }
    }
  });

  test("PARITY with a confirmed S5 run: the pinned variant consumes the pinned run and matches the copy's draws", async () => {
    const opp = makeOpp("greenfield", LINES);
    const run = confirmRun(opp, "h-run");
    const pid = promote(opp); // the confirmed run is in force at pin time
    expect(pinRows(pid)[0]).toMatchObject({ s5_sim_run_id: run.id, s5_sim_input_hash: "h-run" });
    await setBasis(pid, "s5_plan");
    const copyInputs = gen.caseInputsForProject(pid);
    await optIn(pid);
    const pinnedInputs = gen.caseInputsForProject(pid);
    expect(copyInputs.s5Sim!.runId).toBe(run.id);
    expect(pinnedInputs.s5Sim).toEqual(copyInputs.s5Sim);
    expect(gen.runSeededSimulation(pinnedInputs, "base")).toEqual(gen.runSeededSimulation(copyInputs, "base"));
    // a NEWER confirmed run does not move the pinned consumption (rule 2 raises the stale flag instead)
    const newer = confirmRun(opp, "h-newer", 1234);
    expect(s8.resolveS5SimConsumption(db, opp)!.runId).toBe(newer.id);
    expect(gen.caseInputsForProject(pid).s5Sim!.runId).toBe(run.id);
    expect(pinS8.resolvePinnedS5SimConsumption(db, pinRows(pid)[0] as never)!.runId).toBe(run.id);
  });

  test("S8 computes against the PINNED snapshot, not live S5; a re-pin moves it", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    await setBasis(pid, "s5_plan");
    await optIn(pid);
    const before = gen.resolveS5InvestmentPlan(db, pid)!;
    setLines(opp, [...LINES.slice(0, 1).map((l) => ({ ...l, amount: 9999 })), ...LINES.slice(1)]);
    expect(gen.resolveS5InvestmentPlan(db, pid)!.capexByYear).toEqual(before.capexByYear); // live edit invisible
    const res = await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const after = gen.resolveS5InvestmentPlan(db, pid)!;
    expect(after.capexByYear[0]).toBeGreaterThan(before.capexByYear[0] + 8000);
    expect(after.pinId).not.toBe(before.pinId);
  });

  test("generated cases carry s5_pin= and plan_hash= only on the pinned path", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    await setBasis(pid, "s5_plan");
    await gen.generateBusinessCases(pid, { actor: ANALYST });
    const notes = () => (db.query("SELECT DISTINCT note FROM valuation_simulation WHERE project_id = ?").all(pid) as Array<{ note: string }>).map((r) => r.note);
    expect(notes().every((n) => !n.includes("s5_pin=") && !n.includes("plan_hash="))).toBe(true);
    expect(notes().every((n) => n.includes("s5_line_hash="))).toBe(true);
    await optIn(pid);
    await gen.generateBusinessCases(pid, { actor: ANALYST });
    const pinId = pinRows(pid)[0].id as string;
    const pinnedNotes = notes().filter((n) => n.includes("s5_pin="));
    expect(pinnedNotes.length).toBeGreaterThan(0);
    for (const n of pinnedNotes) {
      expect(n).toContain(`s5_pin=${pinId}`);
      expect(n).toContain(`plan_hash=${pinRows(pid)[0].plan_hash}`);
      expect(n).toContain(`s5_model=pin:${pinId}`);
    }
  });
});

// -- stale rules ---------------------------------------------------------------------------------
describe("stale rules (design 4A.4)", () => {
  test("fresh pin is in effect; not applicable without a pin", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const st = pinS8.s5PinStatusForProject(db, pid);
    expect(st).toMatchObject({ state: "in_effect", stale: false, reasons: [], path: "copy", optedIn: false });
    const none = promote(makeOpp("greenfield", null));
    expect(pinS8.s5PinStatusForProject(db, none)).toMatchObject({ state: "not_applicable", pin: null });
  });

  test("rule 1: a changed S5 source (lines, staffing, plan_meta or capability judgement) hashes differently", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    setLines(opp, LINES.map((l) => (l.line === "Ops" ? { ...l, amount: 175 } : l)));
    expect(pinS8.s5PinStatusForProject(db, pid)).toMatchObject({ state: "stale", reasons: ["source_changed"] });
    // restoring the source clears it (the hash is content-based)
    setLines(opp, LINES);
    expect(pinS8.s5PinStatusForProject(db, pid).state).toBe("in_effect");
    // a capability judgement change
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: [{ ...CAP_ROW, attainability: { ...CAP_ROW.attainability, closingCostKrwM: 450 } }], updatedAt: NOW }), opp]);
    expect(pinS8.s5PinStatusForProject(db, pid).reasons).toEqual(["source_changed"]);
    // plan_meta horizon
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: [CAP_ROW], updatedAt: NOW }), opp]);
    setLines(opp, LINES.map((l) => (l.source === "plan_meta" ? { ...l, horizonYears: 6 } : l)));
    expect(pinS8.s5PinStatusForProject(db, pid).reasons).toEqual(["source_changed"]);
  });

  test("rule 2: a newer confirmed run; the pinned run superseded", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    const r1 = confirmRun(opp, "h1");
    expect(pinS8.s5PinStatusForProject(db, pid).reasons).toEqual(["newer_confirmed_run"]); // pin was made with no run
    await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(pinRows(pid).at(-1)).toMatchObject({ s5_sim_run_id: r1.id });
    expect(pinS8.s5PinStatusForProject(db, pid).state).toBe("in_effect");
    // an unconfirmed re-run supersedes the pinned run (ADR-0176 keeps the confirmation, the pin flags it)
    runRepo.insertInvestmentSimulationRun({ opportunityId: opp, inputHash: "h2", seed: 5, drawCount: 200, horizonYears: 5, envelopeKrwM: null, assumptions: {}, results: {}, actor: ANALYST, now: new Date().toISOString() }, db);
    expect(pinS8.s5PinStatusForProject(db, pid).reasons).toEqual(["pinned_run_superseded"]);
    const r3 = confirmRun(opp, "h3", 7);
    expect(pinS8.s5PinStatusForProject(db, pid).reasons).toEqual(["newer_confirmed_run", "pinned_run_superseded"]);
    // re-pin follows the latest confirmed run and clears it
    await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(pinRows(pid).at(-1)).toMatchObject({ s5_sim_run_id: r3.id });
    expect(pinS8.s5PinStatusForProject(db, pid).state).toBe("in_effect");
  });

  test("rule 3 + never changes results: a case generated on an older pin shows stale; rows are untouched by a re-pin", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    await setBasis(pid, "s5_plan");
    await optIn(pid);
    await gen.generateBusinessCases(pid, { actor: ANALYST });
    expect(pinS8.s5PinStatusForProject(db, pid)).toMatchObject({ state: "in_effect", caseGeneratedOnPin: pinRows(pid)[0].id });
    const snapshotRows = () => json(db.query("SELECT id, model_id, scenario, percentile, npv_krw_m, irr, note FROM valuation_simulation WHERE project_id = ? ORDER BY id").all(pid));
    const rowsBefore = snapshotRows();
    const modelsBefore = json(db.query("SELECT id, archived_at FROM business_case_model WHERE project_id = ? AND kind != 'greenfield_cost' ORDER BY id").all(pid));
    setLines(opp, LINES.map((l) => (l.line === "Plant" ? { ...l, amount: 1500 } : l)));
    expect(pinS8.s5PinStatusForProject(db, pid).reasons).toEqual(["source_changed"]);
    const res = await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const st = pinS8.s5PinStatusForProject(db, pid);
    expect(st).toMatchObject({ state: "stale", reasons: ["case_on_older_pin"] });
    expect(snapshotRows()).toBe(rowsBefore);
    expect(json(db.query("SELECT id, archived_at FROM business_case_model WHERE project_id = ? AND kind != 'greenfield_cost' ORDER BY id").all(pid))).toBe(modelsBefore);
    // regenerating on the new pin clears it
    await gen.generateBusinessCases(pid, { actor: ANALYST });
    expect(pinS8.s5PinStatusForProject(db, pid).state).toBe("in_effect");
  });

  test("verification (a): editing a bc.* assumption does not mark existing cases stale", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    await setBasis(pid, "s5_plan");
    await gen.generateBusinessCases(pid, { actor: ANALYST });
    const before = json(db.query("SELECT id, note FROM valuation_simulation WHERE project_id = ? ORDER BY id").all(pid));
    await gen.recordBusinessCaseParams(db, { projectId: pid, params: { capture_rate: 0.02, opex_ratio: 0.5 }, rationale: "edit", actor: ANALYST });
    expect(json(db.query("SELECT id, note FROM valuation_simulation WHERE project_id = ? ORDER BY id").all(pid))).toBe(before);
    expect(s8.s5SimStatusForProject(db, pid).state).not.toBe("stale");
    expect(pinS8.s5PinStatusForProject(db, pid).state).toBe("in_effect");
  });
});

// -- re-pin lifecycle (repository) ---------------------------------------------------------------
describe("pin lifecycle", () => {
  test("one current row, supersede chain, audit, no-op re-pin writes nothing", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    const first = pinRows(pid)[0];
    const same = pinRepo.createS5PlanPin(db, { projectId: pid, actor: ANALYST });
    expect(same).toMatchObject({ written: false, action: null });
    expect(pinRows(pid).length).toBe(1);
    setLines(opp, LINES.map((l) => (l.line === "Ops" ? { ...l, amount: 175 } : l)));
    const second = pinRepo.createS5PlanPin(db, { projectId: pid, actor: ANALYST });
    expect(second).toMatchObject({ written: true, action: "s5_plan_pin.repinned", superseded_pin_id: first.id });
    setLines(opp, LINES.map((l) => (l.line === "Ops" ? { ...l, amount: 190 } : l)));
    const third = pinRepo.createS5PlanPin(db, { projectId: pid, actor: ANALYST });
    const rows = pinRows(pid);
    expect(rows.length).toBe(3);
    expect(rows.filter((r) => r.superseded_at === null).length).toBe(1);
    expect(rows[0].superseded_by).toBe(second.pin.id);
    expect(rows[1].superseded_by).toBe(third.pin.id);
    expect(rows.map((r) => r.reason)).toEqual(["initial", "repin", "repin"]);
    expect(pinS8.getCurrentS5PlanPin(db, pid)!.id).toBe(third.pin.id);
    expect(pinS8.listS5PlanPins(db, pid).map((r) => r.id)).toEqual([third.pin.id, second.pin.id, first.id as string]);
    // the OLD snapshot stays re-readable and hashes to its own plan_hash
    const old = pinLib.parsePinSnapshot(rows[0].input_snapshot_json as string)!;
    expect(pinLib.s5PlanHashOf(old)).toBe(first.plan_hash as string);
    expect(() => db.run("DELETE FROM s5_plan_pin WHERE id = ?", [first.id])).toThrow(/append-only/);
    const audits = db.query("SELECT action, target FROM audit_log WHERE action LIKE 's5_plan_pin.%' AND target LIKE ?").all(`${pid}#%`) as Array<{ action: string; target: string }>;
    expect(audits.map((a) => a.action)).toEqual(["s5_plan_pin.pinned", "s5_plan_pin.repinned", "s5_plan_pin.repinned"]);
    expect(audits[1].target).toContain(`old=${first.id}`);
  });

  test("Brown Field and projects without an S5 plan cannot be pinned", () => {
    const bf = promote(makeOpp("brownfield", null));
    expect(() => pinRepo.createS5PlanPin(db, { projectId: bf, actor: ANALYST })).toThrow(/Green Field/);
    const noPlan = promote(makeOpp("greenfield", null));
    expect(() => pinRepo.createS5PlanPin(db, { projectId: noPlan, actor: ANALYST })).toThrow(/S5/);
    expect(pinRows(bf).length + pinRows(noPlan).length).toBe(0);
  });
});

// -- route: human only, analyst+, Green Field only -----------------------------------------------
describe("s5-pin route", () => {
  test("GET previews pinned vs current; POST re-pins AND refreshes the compat copy in one step; cases are not regenerated", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    const copyModels = () => db.query("SELECT id, archived_at FROM business_case_model WHERE project_id = ? AND kind = 'greenfield_cost' ORDER BY created_at, id").all(pid) as Array<{ id: string; archived_at: string | null }>;
    expect(copyModels().length).toBe(1);
    setLines(opp, LINES.map((l) => (l.line === "Plant" ? { ...l, amount: 2000 } : l)));
    const pv = (await (await nextRequest(url(pid), { headers: { cookie } })).json()).data;
    expect(pv.preview).toMatchObject({ has_pin: true, changed: true, changes: { plan: true, run: false } });
    expect(pv.preview.current.totals.capex - pv.preview.pinned.totals.capex).toBeCloseTo(800, 5);
    expect(pv.status).toMatchObject({ state: "stale", reasons: ["source_changed"] });
    const res = await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const out = (await res.json()).data;
    expect(out).toMatchObject({ written: true, action: "s5_plan_pin.repinned", copy_refreshed: true });
    expect(out.status.state).toBe("in_effect");
    const models = copyModels();
    expect(models.length).toBe(2);
    expect(models.filter((m) => m.archived_at === null).length).toBe(1);
    expect(db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'business_case.s5_reimport' AND target LIKE ?").get(`${pid}:%`)).toEqual({ n: 1 });
    expect(db.query("SELECT COUNT(*) AS n FROM valuation_simulation WHERE project_id = ?").get(pid)).toEqual({ n: 0 }); // nothing regenerated
    expect(db.query("SELECT COUNT(*) AS n FROM assumption WHERE assumption_key IN ('bc.s5_source','bc.investment_basis') AND run_id IN (SELECT id FROM run WHERE project_id = ?)").get(pid)).toEqual({ n: 0 });
    // an unchanged second press writes no new pin row
    const again = (await (await nextRequest(url(pid), { method: "POST", headers: { cookie } })).json()).data;
    expect(again.written).toBe(false);
  });

  test("an unpinned Green Field project gets its INITIAL pin from POST (no copy refresh); PR #590 route unchanged", async () => {
    const opp = makeOpp("greenfield", null);
    const pid = promote(opp);
    expect(pinRows(pid).length).toBe(0);
    setLines(opp, LINES);
    const res = await nextRequest(url(pid), { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ written: true, action: "s5_plan_pin.pinned", copy_refreshed: false });
    expect(pinRows(pid)[0].reason).toBe("initial");
    const reimport = await nextRequest(`/api/projects/${pid}/business-case/s5-reimport`, { method: "POST", headers: { cookie } });
    expect(reimport.status).toBe(200); // the interim re-import keeps working as before
  });

  test("agents, viewers and Brown Field are refused; registered human-only", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const principal = { userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" };
    const before = pinRows(pid).length;
    const asAgent = await runAsPrincipal(principal, () => pinRoute.POST(new Request("http://x/s5-pin", { method: "POST" }), { params: Promise.resolve({ id: pid }) }));
    expect(asAgent.status).toBe(403);
    expect((await asAgent.json()).error.code).toBe("human_only");
    const asAgentGet = await runAsPrincipal(principal, () => pinRoute.GET(new Request("http://x/s5-pin"), { params: Promise.resolve({ id: pid }) }));
    expect(asAgentGet.status).toBe(403);
    expect((await nextRequest(url(pid), { method: "POST", headers: { cookie: viewerCookie } })).status).toBe(403);
    expect((await nextRequest(url(pid), { method: "POST" })).status).toBe(401);
    expect(isHumanOnly("POST", url(pid), {})).toBe(true);
    expect(pinRows(pid).length).toBe(before);
    const bf = promote(makeOpp("brownfield", null));
    const r = await nextRequest(url(bf), { method: "POST", headers: { cookie } });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("not_greenfield");
    const none = promote(makeOpp("greenfield", null));
    const r2 = await nextRequest(url(none), { method: "POST", headers: { cookie } });
    expect(r2.status).toBe(409);
    expect((await r2.json()).error.code).toBe("no_s5_plan");
    expect(pinRows(bf).length + pinRows(none).length).toBe(0);
  });
});

// -- params opt-in -------------------------------------------------------------------------------
describe("bc.s5_source opt-in (params route)", () => {
  const paramsUrl = (id: string) => `/api/projects/${id}/business-case/params`;
  const post = (id: string, params: Record<string, unknown>, c = cookie) => nextRequest(paramsUrl(id), { method: "POST", headers: { cookie: c }, body: json({ params, rationale: "t" }) });

  test("a person with analyst role opts in; GET reports the source, pin state and stale flag", async () => {
    const opp = makeOpp("greenfield", LINES);
    const pid = promote(opp);
    const r = await post(pid, { s5_source: 1 });
    expect(r.status).toBe(201);
    const body = (await r.json()).data;
    expect(body.params).toMatchObject({ s5Source: "pinned" });
    const get = (await (await nextRequest(paramsUrl(pid), { headers: { cookie } })).json()).data;
    expect(get.s5_pin).toMatchObject({ path: "pinned", optedIn: true, state: "in_effect" });
    expect(get.params.s5PinId).toBe(pinRows(pid)[0].id);
    setLines(opp, LINES.map((l) => (l.line === "Ops" ? { ...l, amount: 175 } : l)));
    expect((await (await nextRequest(paramsUrl(pid), { headers: { cookie } })).json()).data.s5_pin).toMatchObject({ stale: true, reasons: ["source_changed"] });
    expect((await post(pid, { s5_source: 0 })).status).toBe(201);
    expect((await (await nextRequest(paramsUrl(pid), { headers: { cookie } })).json()).data.params.s5Source).toBe("copy");
  });

  test("agents cannot opt in; viewers cannot; no pin / Brown Field / bad value are 400", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const principal = { userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" };
    const paramsRoute = await import("../../app/web-next/app/api/projects/[id]/business-case/params/route.ts");
    const asAgent = await runAsPrincipal(principal, () => paramsRoute.POST(new Request("http://x/p", { method: "POST", headers: { cookie }, body: json({ params: { s5_source: 1 }, rationale: "t" }) }), { params: Promise.resolve({ id: pid }) }));
    expect(asAgent.status).toBe(403);
    expect((await asAgent.json()).error.code).toBe("human_only");
    expect(gen.resolveBusinessCaseParams(db, pid).s5Source).toBe("copy");
    expect((await post(pid, { s5_source: 1 }, viewerCookie)).status).toBe(403);
    expect((await post(pid, { s5_source: 2 })).status).toBe(400);
    const noPin = promote(makeOpp("greenfield", [{ line: "NoUnit", category: "opex", amount: 3 }]));
    expect((await post(noPin, { s5_source: 1 })).status).toBe(400);
    const bf = promote(makeOpp("brownfield", null));
    expect((await post(bf, { s5_source: 1 })).status).toBe(400);
    expect(gen.resolveBusinessCaseParams(db, bf).s5Source).toBe("copy");
  });
});

// -- implementation-time verification (c) --------------------------------------------------------
describe("verification (c): which model the S10 carry can read", () => {
  test("the adopt API only checks project membership and archive state - not the model kind", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const copy = db.query("SELECT id, kind FROM business_case_model WHERE project_id = ? AND kind = 'greenfield_cost'").get(pid) as { id: string; kind: string };
    const { adoptBusinessCase } = await import("../../app/web-next/lib/business-case.ts");
    let outcome = "adopted";
    try { adoptBusinessCase(pid, copy.id, ANALYST, { goalsAck: { acknowledged: true, note: "t" } }); } catch (e) { outcome = e instanceof Error ? e.message : String(e); }
    // recorded as observed behaviour: the copy is adoptable at API level (no kind guard), so the S10
    // carry (adoptedModelId -> capex lines of that model) CAN read the promotion copy if a person adopts it.
    expect(outcome).toBe("adopted");
  });
});
