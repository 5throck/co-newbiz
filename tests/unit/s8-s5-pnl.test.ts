// @version 1.0.0
/**
 * ADR-0178 slice 2 - the `s5_pnl` basis (S5 planned P&L). Covers: stored code
 * round-trip, per-year plan P&L construction (utilization on revenue only,
 * OD-7), ratio fallback for uncovered years, year-0 pre-launch investment and
 * the payback guard, note fragments, labels, deterministic-path integrity for
 * the ratio basis, and the params-route refusals (non-greenfield, no pinned
 * path, agent principal). ASCII-only source (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-s8-s5-pnl.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const gen = await import("../../app/web-next/lib/business-case-generator.ts");
const labels = await import("../../app/web-next/lib/s5-linkage-labels.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { runAsPrincipal } = await import("../../app/web-next/lib/mcp/principal-context.ts");
const paramsRoute = await import("../../app/web-next/app/api/projects/[id]/business-case/params/route.ts");

const NOW = "2026-10-16T00:00:00.000Z";
const ANALYST = "pnl-analyst";
const json = JSON.stringify;
let cookie = "";

// -- hand-built fixtures (no DB needed for the pure-function tests) ------------
const WACC = { value: 0.08, source: "default" as const, assumption_id: null, run_id: null, as_of: null, rationale: null, anchor_ref: null };
const makePlan = (over: Record<string, unknown> = {}) => ({
  modelId: "m1", horizonYears: 4,
  capexByYear: [100, 50, 0, 0],
  laborByYear: [60, 80, 90, 90].map(() => 0),
  opexByYear: [60, 80, 90, 90],
  laborOpexByYear: [60, 80, 90, 90],
  govRndByYear: [0, 20, 0, 0],
  opexCovered: [true, true, true, true],
  skippedLines: 0,
  lineHash: "h",
  capexCapabilityByYear: [0, 0, 0, 0],
  laborOpexCapabilityByYear: [0, 0, 0, 0],
  preLaunchKrwM: 150,
  ...over,
});

const makeInputs = (over: Record<string, unknown> = {}) => ({
  projectId: "p-test",
  marketSizeKrwM: 80000,
  anchorGrowth: 0.06,
  wacc: WACC,
  bcParams: { ...gen.resolveBusinessCaseParamsDefaults(), investmentBasis: "s5_pnl" as const },
  s5Plan: makePlan(),
  ...over,
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-pnl-analyst-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId: ANALYST, password: "pw-pnl-analyst-12" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

// -- DB fixtures for the params-route tests (cribbed from s5-connect) ----------
const ml = (line: string, category: string, amount: number, period: string, startYear?: number, endYear?: number) => ({
  line, category, amount, amountUnit: "krw_m", amountUnitConfirmed: true, currency: "KRW", period, startYear, endYear,
});
const LINES = [
  ml("Plant", "capex", 1200, "lumpsum", 1),
  ml("Staff", "labor", 40, "monthly", 1),
  ml("Ops", "opex", 150, "yearly", 2, 4),
  { source: "plan_meta", horizonYears: 5 },
];

function makeOpp(track: "greenfield" | "brownfield", lines: unknown[] | null): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ANALYST, NOW, json({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), 80000, 0.06]);
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
const setLines = (oppId: string, lines: unknown[]) => db.run("UPDATE greenfield_assessment SET business_case_lines_json = ? WHERE opportunity_id = ?", [json(lines), oppId]);
const url = (id: string) => `/api/projects/${id}/business-case/params`;
const postParams = (pid: string, body: unknown, ck = cookie) =>
  nextRequest(url(pid), { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: json(body) });
const AGENT_PRINCIPAL = { userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" };

describe("s5_pnl basis code and labels", () => {
  test("stored code 3 round-trips to s5_pnl; existing codes unchanged", () => {
    expect(gen.investmentBasisOfCode(3)).toBe("s5_pnl");
    expect(gen.investmentBasisOfCode(0)).toBe("ratio");
    expect(gen.investmentBasisOfCode(1)).toBe("s5_plan");
    expect(gen.investmentBasisOfCode(2)).toBe("s5_plan_full");
  });
  test("labels: basis label, scope-note tail, per-parameter pnl cells", () => {
    expect(labels.BASIS_LABEL.s5_pnl).toBe("S5 계획 손익");
    expect(labels.s5ScopeNote("s5_pnl")).toContain("S5 계획 손익");
    expect(labels.s5ScopeNote("s5_pnl")).not.toContain("슬라이스 2에서 도입되었습니다");
    const ctx = { basis: "s5_pnl" as const, run: null, s8Iterations: 2000 };
    expect(labels.s5ParamLinkage("opex", ctx).kind).toBe("s5");
    expect(labels.s5ParamLinkage("capex", ctx).kind).toBe("s5");
    expect(labels.s5ParamLinkage("initial", ctx).text).toContain("year-0");
    expect(labels.s5ParamLinkage("sigma", ctx).kind).toBe("assumed");
  });
});

describe("s5PnlYearPlan (per-year P&L construction)", () => {
  const plan = makePlan({ opexCovered: [true, false, true, true], govRndByYear: [0, 0, 0, 0] });
  const rev = [1000, 2000, 3000, 4000];
  const util = [0.4, 0.7, 0.9, 1.0];
  const r = gen.s5PnlYearPlan(plan as never, 4, rev, util, 0.3, 0.1);
  test("utilization applies to revenue only and covered years use plan opex", () => {
    const y1 = r.years[0];
    expect(y1.opexFallback).toBe(false);
    expect(y1.opexKrwM).toBe(60); // labor 60 + gov 0 (not scaled by 0.4)
    expect(y1.capexKrwM).toBe(100);
    expect(y1.capexFallbackLabel).toBe("S5 계획");
  });
  test("uncovered years fall back to revUtil x opexRatio with the fallback label", () => {
    const y2 = r.years[1];
    expect(y2.opexFallback).toBe(true);
    expect(y2.opexKrwM).toBeCloseTo(2000 * 0.7 * 0.3, 10);
    expect(y2.opexFallbackLabel).toBe("비율 대체 (계획 미포함 연도)");
    expect(r.fallbackYears).toBe(1);
  });
  test("capex beyond the plan horizon falls back to revUtil x capexRatio", () => {
    const long = gen.s5PnlYearPlan(plan as never, 5, [...rev, 5000], [...util, 1], 0.3, 0.1);
    const y5 = long.years[4];
    expect(y5.capexFallback).toBe(true);
    expect(y5.capexKrwM).toBeCloseTo(5000 * 1 * 0.1, 10);
    expect(y5.capexFallbackLabel).toBe("비율 대체 (계획 기간 외)");
    expect(long.fallbackYears).toBe(2);
  });
  test("pre-launch amount and govRnd-covered year", () => {
    expect(r.preLaunchKrwM).toBe(150);
    expect(r.years[1].year).toBe(2);
  });
});

describe("s5PnlNoteInfo", () => {
  test("counts fallback years over the bc horizon; carries pre-launch", () => {
    const inputs = makeInputs();
    const plan = inputs.s5Plan!;
    const r = gen.s5PnlNoteInfo(inputs, plan);
    expect(r.horizon).toBe(5);
    expect(r.preLaunchKrwM).toBe(150);
    expect(typeof r.fallbackYears).toBe("number");
    expect(r.fallbackYears).toBeLessThanOrEqual(r.horizon);
  });
});

describe("deterministicCashflows under s5_pnl", () => {
  const d = gen.resolveBusinessCaseParamsDefaults();
  test("year-0 = -preLaunch; covered-year opex/capex unscaled; fallbacks on ramped revenue", () => {
    const base = gen.deterministicCashflows(makeInputs(), "base");
    expect(base).toHaveLength(6);
    expect(base[0]).toBe(-150);
    const zero = gen.deterministicCashflows(makeInputs({ s5Plan: makePlan({ preLaunchKrwM: 0 }) }), "base");
    expect(zero[0] === 0).toBe(true);
    expect(base.slice(1)).toEqual(zero.slice(1));
    const stripped = makePlan({ laborOpexByYear: [0, 0, 0, 0], govRndByYear: [0, 0, 0, 0], capexByYear: [0, 0, 0, 0], opexCovered: [true, true, true, true] });
    const raw = gen.deterministicCashflows(makeInputs({ s5Plan: stripped }), "base");
    expect(base[1]).toBeCloseTo(raw[1] - 60 - 100, 9);
    expect(base[3]).toBeCloseTo(raw[3] - 90, 9);
    const fullCover = makePlan({ laborOpexByYear: [0, 0, 0, 0, 0], govRndByYear: [0, 0, 0, 0, 0], capexByYear: [0, 0, 0, 0, 0], opexCovered: [true, true, true, true, true] });
    const rawFull = gen.deterministicCashflows(makeInputs({ s5Plan: fullCover }), "base");
    const revUtil5 = rawFull[5];
    expect(base[5]).toBeCloseTo(revUtil5 * (1 - d.opexRatio - d.capexRatio), 9);
  });
  test("year-0 pre-launch 0 -> payback guard (bepYear null); >0 -> numeric bepYear", () => {
    const withPre = gen.runSeededSimulation(makeInputs(), "base");
    expect(withPre.bepYear).not.toBeNull();
    const noPre = gen.runSeededSimulation(makeInputs({ s5Plan: makePlan({ preLaunchKrwM: 0 }) }), "base");
    expect(noPre.bepYear).toBeNull();
  });
  test("s5Sim pairing is excluded under s5_pnl (slice 3 pending)", () => {
    const paired = gen.deterministicCashflows(makeInputs({ s5Sim: { runId: "r1", inputHash: "h", drawCount: 500, factors: null } as never }), "base");
    const plain = gen.deterministicCashflows(makeInputs(), "base");
    expect(paired).toEqual(plain);
  });
});

describe("params route: s5_pnl refusals and human-only set", () => {
  test("403 human_only for an agent principal even on a pinned greenfield project", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const res = await runAsPrincipal(AGENT_PRINCIPAL, () =>
      paramsRoute.POST(new Request("http://x/params", { method: "POST", body: json({ params: { investment_basis: 3 }, rationale: "agent try" }) }), { params: Promise.resolve({ id: pid }) }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("human_only");
  });
  test("400 for a greenfield project without a pinned path", async () => {
    const pid = promote(makeOpp("greenfield", null)); // no importable lines -> no pin
    const res = await postParams(pid, { params: { investment_basis: "s5_pnl" }, rationale: "no pin" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("OD-6");
  });
  test("400 for a brownfield project (even with a shortlisted target)", async () => {
    const pid = promote(makeOpp("brownfield", null));
    const res = await postParams(pid, { params: { investment_basis: 3 }, rationale: "bf" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("OD-5");
  });
});

describe("person sets s5_pnl on a pinned greenfield project", () => {
  test("200; stored basis resolves to s5_pnl; generation persists the note fragments and the payback guard", async () => {
    const pid = promote(makeOpp("greenfield", LINES));
    const res = await postParams(pid, { params: { investment_basis: 3 }, rationale: "person decision" });
    expect([200, 201]).toContain(res.status);
    expect(gen.resolveBusinessCaseParams(db, pid).investmentBasis).toBe("s5_pnl");
    await gen.generateBusinessCases(pid, { actor: ANALYST });
    const rows = db.query("SELECT note FROM valuation_simulation WHERE project_id = ? ORDER BY scenario").all(pid) as Array<{ note: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.note).toContain("basis=s5_pnl");
      expect(r.note).toContain("prelaunch_krw_m=");
      expect(r.note).toContain("pnl_fallback=");
      expect(r.note).toContain("s5_sim=none");
    }
  });
});
