// @version 1.0.0
/**
 * ADR-0174 slice-2 S8 side — s5_plan basis unit tests (design §8).
 */

import { describe, expect, test, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import {
  deterministicCashflows,
  investmentBasisOfCode,
  INVESTMENT_BASIS_CODES,
  resolveBusinessCaseParamsDefaults,
  resolveS5InvestmentPlan,
  type BusinessCaseParams,
  type CaseInputs,
} from "../../app/web-next/lib/business-case-generator.ts";

type Plan = NonNullable<CaseInputs["s5Plan"]>;

/** resolveS5InvestmentPlan only uses query(sql).get/all — a fake keeps this
 *  unit-level (no migrations, no scratch file). */
function fakeDb(modelRow: unknown, lineRows: unknown[]) {
  return {
    query: (sql: string) => ({
      get: () => modelRow,
      all: () => lineRows,
    }),
  } as unknown as Parameters<typeof resolveS5InvestmentPlan>[0];
}

function planOf(opts?: Partial<Plan>): Plan {
  return {
    modelId: "model-1",
    horizonYears: 5,
    capexByYear: [500, 300, 0, 0, 0],
    laborOpexByYear: [200, 200, 200, 200, 200],
    govRndByYear: [0, 100, 0, 0, 0],
    opexCovered: [true, true, false, false, false],
    skippedLines: 0,
    lineHash: "abc",
    ...opts,
  };
}

function baseParams(basis: BusinessCaseParams["investmentBasis"]): BusinessCaseParams {
  return { ...resolveBusinessCaseParamsDefaults(), investmentBasis: basis };
}

function inputsFor(basis: BusinessCaseParams["investmentBasis"], withPlan: boolean, overrides?: Partial<CaseInputs>): CaseInputs {  return {
    projectId: "01TESTPROJECT0000000000",
    marketSizeKrwM: 100000,
    anchorGrowth: 0.03,
    wacc: {
      value: 0.08,
      source: "default",
      assumption_id: null,
      run_id: null,
      as_of: null,
      rationale: null,
      anchor_ref: null,
    },
    bcParams: baseParams(basis),
    s5Plan: withPlan ? planOf() : undefined,
    ...overrides,
  };
}

describe("investmentBasisOfCode", () => {
  test("numeric codes round-trip; anything else falls back to ratio", () => {
    expect(INVESTMENT_BASIS_CODES).toEqual({ ratio: 0, s5_plan: 1, s5_plan_full: 2, s5_pnl: 3 });
    expect(investmentBasisOfCode(0)).toBe("ratio");
    expect(investmentBasisOfCode(1)).toBe("s5_plan");
    expect(investmentBasisOfCode(2)).toEqual("s5_plan_full");
    expect(investmentBasisOfCode(3)).toBe("s5_pnl");
    expect(investmentBasisOfCode(null)).toBe("ratio");
  });
});

describe("resolveS5InvestmentPlan", () => {
  const model = { id: "model-1", horizon_years: 5 };
  const line = (over: Record<string, unknown>) => ({
    category: "capex",
    annual_amount_krw_m: 100,
    start_year: 1,
    end_year: null,
    growth_rate: 0,
    unit: "KRW_M",
    ...over,
  });

  test("recurring capex spans start..horizon; lump sum (end_year=start) counts once", () => {
    const plan = resolveS5InvestmentPlan(
      fakeDb(model, [
        line({ category: "capex", annual_amount_krw_m: 100 }),
        line({ category: "capex", annual_amount_krw_m: 500, start_year: 2, end_year: 2 }),
      ]),
      "p1",
    );
    expect(plan?.capexByYear).toEqual([100, 600, 100, 100, 100]);
    expect(plan?.skippedLines).toBe(0);
  });

  test("growth_rate does not compound — the vectors read the lines' base amounts (2026-10-19 consistency rule)", () => {
    // The S5 투자비 탭 has no growth input, so S8 reads what the S5 table shows; a rate
    // riding in from legacy/AI lines must not silently escalate S8 costs.
    const plan = resolveS5InvestmentPlan(
      fakeDb(model, [line({ category: "capex", annual_amount_krw_m: 100, growth_rate: 0.1 })]),
      "p1",
    );
    expect(plan?.capexByYear).toEqual([100, 100, 100, 100, 100]);
  });

  test("non-KRW_M and beyond-horizon lines are skipped and counted", () => {
    const plan = resolveS5InvestmentPlan(
      fakeDb(model, [
        line({ unit: null, annual_amount_krw_m: 999 }),
        line({ start_year: 6 }),
        line({ annual_amount_krw_m: 50 }),
      ]),
      "p1",
    );
    expect(plan?.capexByYear).toEqual([50, 50, 50, 50, 50]);
    expect(plan?.skippedLines).toBe(2);
  });

  test("labor/opex fill the opex vector and set opexCovered; gov_rnd is separate", () => {
    const plan = resolveS5InvestmentPlan(
      fakeDb(model, [
        line({ category: "labor", annual_amount_krw_m: 200, end_year: 3 }),
        line({ category: "opex", annual_amount_krw_m: 50 }),
        line({ category: "gov_rnd", annual_amount_krw_m: 100, start_year: 2 }),
      ]),
      "p1",
    );
    expect(plan?.laborOpexByYear).toEqual([250, 250, 250, 50, 50]);
    expect(plan?.opexCovered).toEqual([true, true, true, true, true]);
    expect(plan?.govRndByYear).toEqual([0, 100, 100, 100, 100]);
  });

  test("no greenfield_cost model -> null", () => {
    expect(resolveS5InvestmentPlan(fakeDb(undefined, []), "p1")).toBeNull();
  });

  test("lineHash changes when the plan changes", () => {
    const a = resolveS5InvestmentPlan(fakeDb(model, [line({})]), "p1");
    const b = resolveS5InvestmentPlan(fakeDb(model, [line({ annual_amount_krw_m: 200 })]), "p1");
    expect(a?.lineHash).not.toBe(b?.lineHash);
  });
});

describe("s5_plan cash flows", () => {
  test("golden: the ratio path is bit-identical with or without a plan present", () => {
    expect(deterministicCashflows(inputsFor("ratio", true), "base")).toEqual(deterministicCashflows(inputsFor("ratio", false), "base"));
  });

  test("plan-year alignment: year n carries plan year n's capex (2026-10-19 decider direction — same years as the S5 table)", () => {
    const bc = resolveBusinessCaseParamsDefaults();
    const planFlows = deterministicCashflows(inputsFor("s5_plan", true), "base");
    // No year-0 outflow without pre-launch (start_year 0) lines.
    expect(planFlows[0]).toBe(0);
    // rev1 = market × captureRate; flow1 = (rev1 - rev1·opex)·util1 - capexY1 (500)
    const rev1 = 100000 * bc.captureRate;
    const util1 = bc.rampUp[0];
    expect(planFlows[1]).toBeCloseTo((rev1 - rev1 * bc.opexRatio) * util1 - 500, 8);
    // flow2 carries plan year 2's capex (300): compare against the same flow with
    // the plan's year-2 capex zeroed — the difference must be exactly 300.
    const noY2Capex = [500, 0, 0, 0, 0];
    const shifted = deterministicCashflows(inputsFor("s5_plan", true, { s5Plan: planOf({ capexByYear: noY2Capex }) }), "base");
    expect(planFlows[2] - shifted[2]).toBeCloseTo(-300, 8);
  });

  test("beyond the plan the capex is 0 — the plan replaces, never supplements (spec)", () => {
    const bc = resolveBusinessCaseParamsDefaults();
    // Plan covers years 1..5. Widen the horizon to 7 to expose the uncovered years.
    const wide = inputsFor("s5_plan", true, { bcParams: { ...baseParams("s5_plan"), horizonYears: 7 } });
    // Ratio path with capexRatio forced to 0 == uncovered-year flows exactly.
    const zero = inputsFor("ratio", false, { bcParams: { ...baseParams("ratio"), horizonYears: 7, capexRatio: 0 } });
    const planFlows = deterministicCashflows(wide, "base");
    const zeroFlows = deterministicCashflows(zero, "base");
    // Year 6: plan has no entry → capex 0, opex stays the ratio → the flow is
    // identical to a ratio path with no capex at all.
    expect(planFlows[6]).toBeCloseTo(zeroFlows[6], 10);
    // ...while a plan-covered year differs (the plan capex replaces the ratio).
    expect(planFlows[1]).not.toBeCloseTo(zeroFlows[1], 4);
  });

  test("s5_plan_full: opex switches in covered years; gov_rnd never enters cash flows (future slice)", () => {
    const fullFlows = deterministicCashflows(inputsFor("s5_plan_full", true), "base");
    const planFlows = deterministicCashflows(inputsFor("s5_plan", true), "base");
    // Year 1 is covered: opex term = explicit 200 instead of rev1 × ratio
    // (200 < 1200-ish ratio opex → full year-1 flow is HIGHER than s5_plan's).
    expect(fullFlows[1]).toBeGreaterThan(planFlows[1]);
    // Year 3 is not covered: opex stays the ratio → identical to s5_plan.
    expect(fullFlows[3]).toBeCloseTo(planFlows[3], 10);
    // The only difference is the opex shift; gov_rnd (+100 at plan Y2) never
    // books in slice 2. rev1 is back-solved from the s5_plan year-1 flow.
    const bc = resolveBusinessCaseParamsDefaults();
    const util1 = bc.rampUp[0];
    const rev1 = (planFlows[1] + 500) / ((1 - bc.opexRatio) * util1);
    const opexShift = (rev1 * bc.opexRatio - 200) * util1;
    expect(fullFlows[1] - planFlows[1]).toBeCloseTo(opexShift, 8);
    expect(fullFlows[0]).toBe(0);
  });

  test("s5_plan_full with no opex coverage: full is identical to s5_plan", () => {
    const noCover = planOf({ opexCovered: [false, false, false, false, false] });
    const fullFlows = deterministicCashflows(inputsFor("s5_plan_full", true, { s5Plan: noCover }), "base");
    const planFlows = deterministicCashflows(inputsFor("s5_plan", true), "base");
    for (const i of [1, 2, 3, 4, 5]) {
      expect(fullFlows[i]).toBeCloseTo(planFlows[i], 10);
    }
    expect(fullFlows[0]).toBe(planFlows[0]);
  });

  test("s5_plan basis with no greenfield_cost model: flows are identical to the ratio path (fallback)", () => {
    const fallbackFlows = deterministicCashflows(inputsFor("s5_plan", false), "base");
    const ratioFlows = deterministicCashflows(inputsFor("ratio", false), "base");
    expect(fallbackFlows).toEqual(ratioFlows);
  });
});

/** bc.investment_basis encode/decode round trip — real scratch SQLite
 *  (CO_NEWBIZ_DB_PATH pattern) with one promoted project. */
const PARAMS_DB_PATH = "db/data/test-business-case-s5-plan-params.sqlite";
for (const s of ["", "-wal", "-shm"]) if (existsSync(PARAMS_DB_PATH + s)) rmSync(PARAMS_DB_PATH + s);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(PARAMS_DB_PATH);
const paramsDb = getDb(PARAMS_DB_PATH);
const { ulid } = await import("../../db/lib/ulid.ts");
const { recordBusinessCaseParams, resolveBusinessCaseParams } = await import("../../app/web-next/lib/business-case-generator.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");

const NOW = new Date().toISOString();
const OP_ID = ulid();
const ACTOR = "s5-plan-test";

paramsDb.run(
  "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
  [ulid(), ACTOR, "analyst", "active", "salt", "hash", 1, NOW],
);
paramsDb.run(
  "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
  [OP_ID, "투자비 기준 검증", "산업 테스트", "selected", ACTOR, NOW],
);
paramsDb.run(
  "INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
  [ulid(), OP_ID, "greenfield", "test route", "M&A 대안 검토 후 제외", ACTOR, NOW],
);
for (const gate of ["screening", "pre_fs"]) {
  paramsDb.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", OP_ID, gate, "go", "test", ACTOR, NOW]);
}
paramsDb.run(
  "INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  [ulid(), OP_ID, "직접 진출", "M&A 대안 검토", "test", ACTOR, NOW, NOW],
);
paramsDb.run(
  "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
  [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), OP_ID],
);
const PARAMS_PROJECT_ID = promoteOpportunity(OP_ID, { promotedBy: ACTOR, needToKnowBasis: "s5 plan test" }).project.id;

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(PARAMS_DB_PATH + s)) rmSync(PARAMS_DB_PATH + s);
});

describe("bc.investment_basis persistence", () => {
  test("defaults to ratio with a default provenance and no S5 horizon", () => {
    const p = resolveBusinessCaseParams(paramsDb, PARAMS_PROJECT_ID);
    expect(p.investmentBasis).toBe("ratio");
    expect(p.investmentBasisSource).toContain("기본값");
    expect(p.s5PlanHorizonYears).toBeNull();
  });

  test("record 0/1/2 codes and re-resolve (encode/decode round trip)", async () => {
    for (const [basis, code] of Object.entries(INVESTMENT_BASIS_CODES)) {
      await recordBusinessCaseParams(paramsDb, {
        projectId: PARAMS_PROJECT_ID,
        params: { investment_basis: basis as keyof typeof INVESTMENT_BASIS_CODES },
        rationale: "투자비 기준 검증 — 테스트",
        actor: ACTOR,
      });
      const p = resolveBusinessCaseParams(paramsDb, PARAMS_PROJECT_ID);
      expect(p.investmentBasis).toBe(basis);
      expect(p.investmentBasisSource).toContain("사용자 확정");
      const raw = paramsDb.query("SELECT a.value AS value FROM assumption a JOIN run r ON r.id = a.run_id WHERE r.project_id = ? AND a.assumption_key = 'bc.investment_basis' ORDER BY a.rowid DESC LIMIT 1").get(PARAMS_PROJECT_ID) as { value: number };
      expect(raw.value).toBe(code);
    }
  });

  test("s5PlanHorizonYears mirrors the latest greenfield_cost model horizon", () => {
    paramsDb.run(
      "INSERT INTO business_case_model (id, project_id, name, kind, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), PARAMS_PROJECT_ID, "S5 투자 계획", "greenfield_cost", 6, ACTOR, NOW],
    );
    const p = resolveBusinessCaseParams(paramsDb, PARAMS_PROJECT_ID);
    expect(p.s5PlanHorizonYears).toBe(6);
  });
});
