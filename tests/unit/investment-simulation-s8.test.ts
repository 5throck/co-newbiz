// ADR-0176 slice 3 tests - S8 consumption of the confirmed S5 investment simulation run,
// provenance (s5_sim=<hash>), staleness and the human-only confirmation.
// ASCII-only source (homoglyph gate): Korean via \u escapes, plus-minus written as +/-.
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
// Type-only namespace for the dynamically imported generator module (value usages go through `gen` below).
import type * as genT from "../../app/web-next/lib/business-case-generator.ts";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-investment-simulation-s8.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { isHumanOnly, InProcessRestPort } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const sim = await import("../../app/web-next/lib/investment-simulation.ts");
const s8 = await import("../../app/web-next/lib/investment-simulation-s8.ts");
const vec = await import("../../app/web-next/lib/investment-vectors.ts");
const gen = await import("../../app/web-next/lib/business-case-generator.ts");
const inputLib = await import("../../app/web-next/lib/investment-simulation-input.ts");
const repo = await import("../../db/repositories/investment-simulation-run.repository.ts");

const NOW = new Date().toISOString();
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
const json = JSON.stringify;
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const LEAD = "s8sim-lead";
const VIEWER = "s8sim-viewer";
let leadCookie = "";
let viewerCookie = "";
let oppId = "";
let projectId = "";
const simUrl = () => `/api/greenfield/${oppId}/investment-simulation`;

const LINES = [
  { line: "equipment", category: "capex", amount: 1000, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", startYear: 1, endYear: 1 },
  { line: "ops", category: "opex", amount: 200, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, endYear: 5 },
];
const setLines = (lines: unknown[]) => db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [json(lines), oppId]);

beforeAll(async () => {
  for (const [id, role] of [[LEAD, "analyst"], [VIEWER, "viewer"]] as const) {
    await createUser(db, { userId: id, role, password: `pw-${id}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  leadCookie = await loginCookie(LEAD, `pw-${LEAD}-12345`);
  viewerCookie = await loginCookie(VIEWER, `pw-${VIEWER}-12345`);
  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "s8sim opp", "scope", "selected", LEAD, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "test", "alt", LEAD, NOW]);
  db.run(
    "INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), oppId, "direct", "alt", "test", LEAD, NOW, NOW, json(LINES)],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [json({ rows: [{ id: "r1", capability: "cap", source: "manual", held: { status: "unmet" } }], updatedAt: NOW }), oppId]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", LEAD, NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: LEAD, needToKnowBasis: "s8sim test" }).project.id;
});

// -- shared draw stream ------------------------------------------------------------------------
describe("per-draw pairing", () => {
  const baseInput = {
    manual: [
      { line: "m", category: "opex", amount: 120, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "yearly", startYear: 1, endYear: 3 },
      { line: "c", category: "capex", amount: 500, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", startYear: 1, endYear: 1 },
    ] as never[],
    capLines: [{ capabilityKey: "cap-a", name: "cap-a", line: "cap-a", category: "opex", costKrwM: 400, startYear: 2, defaultStartYear: 2, monthsToAttain: null, subCategory: null }] as never[],
    horizon: 5,
    reflectedKeys: new Set(["cap-a"]),
    staffing: null,
  };

  test("a draw index is the same factor draw at S5 and S8: S5 totals equal the totals rebuilt from the shared factor stream", () => {
    const seed = 424242;
    const draws = 200;
    const res = sim.simulateInvestment({ ...baseInput, seed, draws });
    const v = vec.buildInvestmentVectors(baseInput);
    const factors = sim.drawInvestmentFactors(seed, draws, vec.effectiveAssumptions(undefined));
    expect(factors.length).toBe(draws);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const totals = factors.map((f) => v.mode.capabilityByYear.reduce((a, c, i) => a + r2(r2(c * f.cap) + r2(v.mode.manualByYear[i] * f.man)), 0));
    expect(r2(Math.min(...totals))).toBeCloseTo(res.total.min, 1);
    expect(r2(Math.max(...totals))).toBeCloseTo(res.total.max, 1);
    expect(r2(totals.reduce((a, n) => a + n, 0) / draws)).toBeCloseTo(res.total.mean, 1);
    // a different seed gives a different stream (the pairing is seed-keyed)
    expect(sim.drawInvestmentFactors(seed + 1, draws, vec.effectiveAssumptions(undefined))[0].cap).not.toBe(factors[0].cap);
  });

  test("S8 iteration it uses S5 draw it % drawCount", () => {
    expect(s8.pairedDrawIndex(0, 500)).toBe(0);
    expect(s8.pairedDrawIndex(499, 500)).toBe(499);
    expect(s8.pairedDrawIndex(500, 500)).toBe(0);
    expect(s8.pairedDrawIndex(1234, 500)).toBe(234);
  });
});

// -- generator: bit-identical without a run, paired draws with one ---------------------------
function caseInputs(basis: "ratio" | "s5_plan" | "s5_plan_full", s5Sim: genT.CaseInputs["s5Sim"], plan?: genT.CaseInputs["s5Plan"]): genT.CaseInputs {
  return {
    projectId: "01TESTPROJECT0000000000",
    marketSizeKrwM: 100000,
    anchorGrowth: 0.03,
    wacc: { value: 0.08, source: "default", assumption_id: null, run_id: null, as_of: null, rationale: null, anchor_ref: null } as never,
    bcParams: { ...gen.resolveBusinessCaseParamsDefaults(), investmentBasis: basis, iterations: 400 },
    s5Plan: plan === undefined ? ({ modelId: "m1", horizonYears: 5, capexByYear: [500, 300, 0, 0, 0], laborByYear: [0, 0, 0, 0, 0], opexByYear: [200, 200, 200, 200, 200], laborOpexByYear: [200, 200, 200, 200, 200], govRndByYear: [0, 0, 0, 0, 0], opexCovered: [true, true, true, true, true], skippedLines: 0, lineHash: "abc" }) : plan,
    s5Sim,
  };
}

describe("S8 generator consumption", () => {
  // S5SimConsumption fixture; the staffing slices stay neutral (salary x1, pp shifts 0) and are
  // unused anyway because these plans carry no staffing plan.
  const simRun = (drawCount: number, capFactors: number[], manFactors: number[]) => ({
    runId: "r", inputHash: "h", seed: 1, drawCount, capFactors, manFactors,
    salaryFactors: [1], increaseFactorsPp: [0], onCostFactorsPp: [0], rampFactors: [0],
  });
  test("without a run both ratio and s5_plan paths are bit-identical to the pre-slice-3 behaviour", () => {
    for (const basis of ["ratio", "s5_plan", "s5_plan_full"] as const) {
      const none = gen.runSeededSimulation(caseInputs(basis, null), "base");
      const absent = gen.runSeededSimulation(caseInputs(basis, undefined), "base");
      expect(none).toEqual(absent);
    }
    // a run attached to a ratio-basis case is ignored entirely
    const run = simRun(3, [1.3, 1.3, 1.3], [1.3, 1.3, 1.3]);
    expect(gen.runSeededSimulation(caseInputs("ratio", run), "base")).toEqual(gen.runSeededSimulation(caseInputs("ratio", null), "base"));
  });

  test("unit factors reproduce the single-point plan exactly", () => {
    const ones = simRun(4, [1, 1, 1, 1], [1, 1, 1, 1]);
    expect(gen.runSeededSimulation(caseInputs("s5_plan", ones), "base")).toEqual(gen.runSeededSimulation(caseInputs("s5_plan", null), "base"));
  });

  test("a paired draw scales the plan: manual factor 2 equals a plan with doubled capex, revenue stream untouched", () => {
    const doubled = simRun(1, [1], [2]);
    const withSim = gen.runSeededSimulation(caseInputs("s5_plan", doubled), "base");
    const plan2 = { modelId: "m1", horizonYears: 5, capexByYear: [1000, 600, 0, 0, 0], laborByYear: [0, 0, 0, 0, 0], opexByYear: [200, 200, 200, 200, 200], laborOpexByYear: [200, 200, 200, 200, 200], govRndByYear: [0, 0, 0, 0, 0], opexCovered: [true, true, true, true, true], skippedLines: 0, lineHash: "abc" };
    const direct = gen.runSeededSimulation(caseInputs("s5_plan", null, plan2), "base");
    expect(withSim.p05).toBe(direct.p05);
    expect(withSim.p50).toBe(direct.p50);
    expect(withSim.p95).toBe(direct.p95);
  });

  test("capability-sourced capex scales by the capability factor, the rest by the manual factor", () => {
    const f = simRun(1, [3], [1]);
    const split = { modelId: "m1", horizonYears: 5, capexByYear: [500, 300, 0, 0, 0], capexCapabilityByYear: [500, 0, 0, 0, 0], laborByYear: [0, 0, 0, 0, 0], opexByYear: [200, 200, 200, 200, 200], laborOpexByYear: [200, 200, 200, 200, 200], govRndByYear: [0, 0, 0, 0, 0], opexCovered: [true, true, true, true, true], skippedLines: 0, lineHash: "abc" };
    const res = gen.runSeededSimulation(caseInputs("s5_plan", f, split), "base");
    const tripled = gen.runSeededSimulation(caseInputs("s5_plan", null, { ...split, capexByYear: [1500, 300, 0, 0, 0] }), "base");
    expect(res.p50).toBe(tripled.p50);
  });

  test("investment draws spread the NPV distribution (deterministic for the same run)", () => {
    const factors = Array.from({ length: 50 }, (_, i) => 0.7 + (i / 49) * 0.6);
    const run = simRun(50, factors, factors);
    const a = gen.runSeededSimulation(caseInputs("s5_plan", run), "base");
    const b = gen.runSeededSimulation(caseInputs("s5_plan", run), "base");
    const base = gen.runSeededSimulation(caseInputs("s5_plan", null), "base");
    expect(a).toEqual(b);
    expect(a.std).toBeGreaterThan(base.std);
  });
});

// -- confirmation ------------------------------------------------------------------------------
describe("confirm: human-only and audited", () => {
  test("the run route stays unconfirmed; the confirm route is on the human-only list and the MCP port refuses it", async () => {
    expect(isHumanOnly("POST", `${simUrl()}/confirm`, {})).toBe(true);
    const port = new InProcessRestPort({ userId: LEAD, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    expect((await port.post(`${simUrl()}/confirm`, { run_id: "x" })).error?.code).toBe("human_only");
    const created = await req(simUrl(), { method: "POST", headers: { cookie: leadCookie }, body: json({ draws: 100 }) });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { run: { id: string; confirmed_at: string | null } } };
    expect(body.data.run.confirmed_at).toBeNull();
    expect(repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)).toBeNull();
    // S8 sees no confirmed run
    expect(s8.resolveS5SimConsumption(db, oppId)).toBeNull();
  });

  test("a bearer (non-cookie) caller and a viewer cannot confirm", async () => {
    const run = repo.getLatestInvestmentSimulationRun(oppId, db)!;
    expect((await req(`${simUrl()}/confirm`, { method: "POST", headers: { cookie: viewerCookie }, body: json({ run_id: run.id }) })).status).toBe(403);
    expect((await req(`${simUrl()}/confirm`, { method: "POST", body: json({ run_id: run.id }) })).status).toBe(401);
    expect(repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)).toBeNull();
  });

  test("validation: unknown key and missing run_id are 400, an unknown run is 404", async () => {
    expect((await req(`${simUrl()}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json({}) })).status).toBe(400);
    expect((await req(`${simUrl()}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json({ run_id: "x", extra: 1 }) })).status).toBe(400);
    expect((await req(`${simUrl()}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json({ run_id: "nope" }) })).status).toBe(404);
  });

  test("a person confirms: audit row investment_simulation.confirmed carries actor, seed, draws and hash; double confirm is 409", async () => {
    const run = repo.getLatestInvestmentSimulationRun(oppId, db)!;
    const res = await req(`${simUrl()}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json({ run_id: run.id }) });
    expect(res.status).toBe(200);
    const confirmed = repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)!;
    expect(confirmed.id).toBe(run.id);
    expect(confirmed.confirmed_by).toBe(LEAD);
    const audit = db.query("SELECT actor_user_id, target FROM audit_log WHERE action = 'investment_simulation.confirmed'").all() as Array<{ actor_user_id: string; target: string }>;
    expect(audit.length).toBe(1);
    expect(audit[0].actor_user_id).toBe(LEAD);
    expect(audit[0].target).toContain(`seed=${run.seed}`);
    expect(audit[0].target).toContain(`draws=${run.draw_count}`);
    expect(audit[0].target).toContain(`hash=${run.input_hash}`);
    expect((await req(`${simUrl()}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json({ run_id: run.id }) })).status).toBe(409);
    // the GET exposes the confirmation
    const got = (await (await req(simUrl(), { headers: { cookie: leadCookie } })).json()) as { data: { run: { confirmed_by: string } } };
    expect(got.data.run.confirmed_by).toBe(LEAD);
  });
});

// -- consumption + staleness -------------------------------------------------------------------
function insertCaseNote(note: string): void {
  const modelId = ulid();
  db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)", [modelId, projectId, "valuation", "case", 5, "t", NOW]);
  db.run(
    "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, unit, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [ulid(), projectId, modelId, "base", "p50", 1, "KRW_M", null, note, new Date(Date.now() + 1000).toISOString()],
  );
}

// -- D7 (2026-10-28): uncertainty scope in the run snapshot; status follows the ADOPTED case ------
describe("D7: what the NPV band reflects is recorded in the snapshot", () => {
  const factors = Array.from({ length: 50 }, (_, i) => 0.7 + (i / 49) * 0.6);
  const simRun = {
    runId: "r", inputHash: "paired-hash", seed: 1, drawCount: 50, capFactors: factors, manFactors: factors,
    salaryFactors: [1], increaseFactorsPp: [0], onCostFactorsPp: [0], rampFactors: [0],
  };
  const scopeOf = (inputs: genT.CaseInputs) => (gen.buildS8JobSpec(inputs, "base") as { uncertainty_scope: import("../../app/web-next/lib/uncertainty-scope.ts").UncertaintyScope }).uncertainty_scope;

  test("ratio basis: the band reflects revenue growth only; every other driver is recorded as held constant", () => {
    const scope = scopeOf(caseInputs("ratio", null, null));
    expect(scope.varied).toEqual(["revenue_growth"]);
    expect(scope.held_constant).toEqual(expect.arrayContaining(["opex_ratio", "capex_ratio", "initial_investment", "ramp_up", "revenue_y1", "discount_rate"]));
    expect(scope.s5_run).toBe("no_s5_plan");
  });

  test("s5_plan basis without a confirmed run: S5 investment uncertainty is absent and the snapshot says why", () => {
    const scope = scopeOf(caseInputs("s5_plan", null));
    expect(scope.varied).toEqual(["revenue_growth"]);
    expect(scope.s5_run).toBe("none_confirmed");
    expect(scope.held_constant).toContain("initial_investment");
  });

  test("s5_plan basis WITH a confirmed S5 run: the S5 draws are included and the capex ratio is no longer held constant", () => {
    const scope = scopeOf(caseInputs("s5_plan", simRun as never));
    expect(scope.varied).toEqual(["revenue_growth", "s5_investment"]);
    expect(scope.held_constant).not.toContain("capex_ratio");
    expect(scope.s5_run).toBe("applied");
    expect(scope.s5_sim_hash).toBe("paired-hash");
    // and the simulation itself moves: the paired draws widen the NPV band versus the single-point plan
    const without = gen.runSeededSimulation(caseInputs("s5_plan", null), "base");
    const withRun = gen.runSeededSimulation(caseInputs("s5_plan", simRun as never), "base");
    expect(withRun.std).toBeGreaterThan(without.std);
  });

  test("the scope is part of the stored snapshot (inputs_json) and re-readable; legacy snapshots are derived from their drivers", async () => {
    const lib = await import("../../app/web-next/lib/uncertainty-scope.ts");
    const spec = gen.buildS8JobSpec(caseInputs("s5_plan", simRun as never), "downside");
    expect(lib.uncertaintyScopeOfSnapshot(JSON.stringify(spec))?.varied).toEqual(["revenue_growth", "s5_investment"]);
    const legacy = { ...spec } as Record<string, unknown>;
    delete legacy.uncertainty_scope;
    const derived = lib.uncertaintyScopeOfSnapshot(JSON.stringify(legacy));
    expect(derived?.varied).toEqual(["revenue_growth"]);
    expect(lib.isGrowthOnly(derived!)).toBe(true);
    expect(lib.uncertaintyScopeOfSnapshot(null)).toBeNull();
    expect(lib.uncertaintyScopeOfSnapshot("not json")).toBeNull();
    // the engine contract is unaffected: seeds hash the CASE drivers, which carry no scope
    expect(JSON.stringify((spec as { cases: unknown[] }).cases)).not.toContain("uncertainty_scope");
  });
});

describe("S8 consumption, provenance and staleness", () => {
  test("caseInputs carry the confirmed run's factors only under an s5_plan basis", async () => {
    // ratio basis: no consumption even though a confirmed run exists
    expect(gen.caseInputsForProject(projectId).s5Sim ?? null).toBeNull();
    const r = await req(`/api/projects/${projectId}/business-case/params`, { method: "POST", headers: { cookie: leadCookie }, body: json({ params: { investment_basis: "s5_plan" }, rationale: "use S5 plan" }) });
    expect(r.status).toBeLessThan(300);
    // amended default: S8 draws from the PINNED run, and the promotion pin predates the run —
    // re-pin (human-only route) so the pin names the confirmed run, as a person would.
    const repin = await req(`/api/projects/${projectId}/business-case/s5-pin`, { method: "POST", headers: { cookie: leadCookie } });
    expect(repin.status).toBeLessThan(300);
    const inputs = gen.caseInputsForProject(projectId);
    expect(inputs.s5Plan).not.toBeNull();
    const confirmed = repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)!;
    expect(inputs.s5Sim?.inputHash).toBe(confirmed.input_hash);
    expect(inputs.s5Sim?.capFactors.length).toBe(confirmed.draw_count);
    // the factors are the shared stream recomputed from the stored seed
    const expected = sim.drawInvestmentFactors(confirmed.seed, confirmed.draw_count, confirmed.assumptions as never);
    expect(inputs.s5Sim?.capFactors).toEqual(expected.map((f) => f.cap));
    expect(inputs.s5Sim?.manFactors).toEqual(expected.map((f) => f.man));
    // the plan splits capex by source: this fixture has manual lines only
    expect(inputs.s5Plan?.capexByYear[0]).toBe(1000);
    expect(inputs.s5Plan?.capexCapabilityByYear?.[0]).toBe(0);
  });

  test("status: no s5_plan case yet is not applicable", () => {
    expect(s8.s5SimStatusForProject(db, projectId).state).toBe("not_applicable");
  });

  test("a case generated without a run records s5_sim=none and is informational; a later confirmed run flags it stale", () => {
    insertCaseNote("seed=1; basis=s5_plan; s5_model=m; s5_line_hash=ab; s5_skipped=0; s5_sim=none; engine=inline-ts");
    // a confirmed run exists now (confirmed above) -> the none case predates it
    const st = s8.s5SimStatusForProject(db, projectId);
    expect(st.state).toBe("stale");
    expect(st.stale).toBe(true);
    expect(st.reason).toBe("run_confirmed_after_generation");
    expect(st.label).toBe("재평가 필요");
  });

  test("a case that recorded the current hash is in effect; a hash mismatch or changed S5 lines flags stale", async () => {
    const run = repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)!;
    insertCaseNote(`seed=1; basis=s5_plan; s5_model=m; s5_line_hash=ab; s5_skipped=0; s5_sim=${run.input_hash}; engine=inline-ts`);
    const ok = s8.s5SimStatusForProject(db, projectId);
    expect(ok.state).toBe("in_effect");
    expect(ok.stale).toBe(false);
    expect(ok.label).toBe("S5 투자 시뮬레이션 반영");
    // route surfaces the same status
    const viaRoute = (await (await req(`/api/projects/${projectId}/business-case/params`, { headers: { cookie: leadCookie } })).json()) as { data: { s5_sim: { state: string } } };
    expect(viaRoute.data.s5_sim.state).toBe("in_effect");
    // hash mismatch: the case recorded another hash
    insertCaseNote("seed=1; basis=s5_plan; s5_model=m; s5_line_hash=ab; s5_skipped=0; s5_sim=deadbeef; engine=inline-ts");
    expect(s8.s5SimStatusForProject(db, projectId)).toMatchObject({ state: "stale", reason: "run_changed" });
    // restore the matching case, then change the saved S5 lines
    insertCaseNote(`seed=1; basis=s5_plan; s5_model=m; s5_line_hash=ab; s5_skipped=0; s5_sim=${run.input_hash}; engine=inline-ts`);
    expect(s8.s5SimStatusForProject(db, projectId).state).toBe("in_effect");
    setLines([...LINES, { line: "extra", category: "capex", amount: 50, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period: "lumpsum", startYear: 2, endYear: 2 }]);
    expect(s8.s5SimStatusForProject(db, projectId)).toMatchObject({ state: "stale", reason: "s5_lines_changed" });
    // and the stale run can no longer be confirmed (the person re-runs first)
    expect(inputLib.loadInvestmentVectorsInput(db, oppId)).not.toBeNull();
  });

  test("D7: the status describes the ADOPTED case, not the newest s5_plan case", () => {
    const run = repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)!;
    setLines(LINES); // back to the lines the run was made on
    const adoptedModel = ulid();
    const t0 = new Date(Date.now() + 5000).toISOString();
    db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)", [adoptedModel, projectId, "valuation", "adopted", 5, "t", t0]);
    db.run(
      "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, unit, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [ulid(), projectId, adoptedModel, "base", "p50", 1, "KRW_M", null, "seed=1; basis=s5_plan; s5_model=m; s5_line_hash=ab; s5_skipped=0; s5_sim=none; engine=inline-ts", t0],
    );
    db.run(
      "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,'t','s8_case_adopt','done','human','t',?,?,?)",
      [ulid(), "project", projectId, projectId, t0, t0, json({ model_id: adoptedModel })],
    );
    // a NEWER, non-adopted case that carries the current run hash would have reported `in_effect` before
    const t1 = new Date(Date.now() + 9000).toISOString();
    const newer = ulid();
    db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)", [newer, projectId, "valuation", "newer", 5, "t", t1]);
    db.run(
      "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, unit, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [ulid(), projectId, newer, "base", "p50", 1, "KRW_M", null, `seed=1; basis=s5_plan; s5_model=m; s5_line_hash=ab; s5_skipped=0; s5_sim=${run.input_hash}; engine=inline-ts`, t1],
    );
    expect(s8.s5SimStatusForProject(db, projectId)).toMatchObject({ state: "stale", reason: "run_confirmed_after_generation", used: "none" });
  });

  test("no run at all: s5_sim=none stays informational, never stale", () => {
    const db2opp = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [db2opp, "x", "scope", "selected", LEAD, NOW]);
    expect(s8.resolveS5SimConsumption(db, db2opp)).toBeNull();
    expect(s8.resolveS5SimConsumption(db, null)).toBeNull();
    expect(s8.s5SimFragmentOfNote("a=1; s5_sim=none; b=2")).toBe("none");
    expect(s8.s5SimFragmentOfNote("a=1; basis=ratio")).toBeNull();
    expect(s8.s5SimFragmentOfNote("s5_sim=abc123")).toBe("abc123");
  });

  test("a stale run cannot be confirmed; a re-run on the changed plan can, and an unconfirmed re-run does not revoke the earlier confirmation", async () => {
    const created = await req(simUrl(), { method: "POST", headers: { cookie: leadCookie }, body: json({ draws: 100 }) });
    const fresh = ((await created.json()) as { data: { run: { id: string } } }).data.run;
    const earlier = repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)!;
    expect(earlier.id).not.toBe(fresh.id);
    expect(repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)!.id).toBe(earlier.id);
    // restore the plan so the earlier (superseded) run's hash differs from the fresh run -> confirm the stale earlier id is 409
    const stale = await req(`${simUrl()}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json({ run_id: earlier.id }) });
    expect([404, 409]).toContain(stale.status);
    const ok = await req(`${simUrl()}/confirm`, { method: "POST", headers: { cookie: leadCookie }, body: json({ run_id: fresh.id }) });
    expect(ok.status).toBe(200);
    expect(repo.getLatestConfirmedInvestmentSimulationRun(oppId, db)!.id).toBe(fresh.id);
  });
});
