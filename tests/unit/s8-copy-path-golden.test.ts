// @version 1.0.0
/**
 * ADR-0178 slice 0 - golden freeze of the S8 COPY path. The expected numbers below were captured on
 * the code BEFORE the pinned-reference change (git HEAD at PR #591) and must stay byte-equal: a
 * project without the `bc.s5_source = 1` opt-in (or without a pin) computes exactly as before.
 * Covers ratio, s5_plan, s5_plan_full, s5_plan with a confirmed S5 run, no plan (fallback), and a
 * Brown Field acquisition case. Uses only APIs that exist on the baseline, with fixed ids so the
 * seeds (derived from the project id) are stable. ASCII-only source.
 */
import { test, expect, describe, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-s8-copy-path-golden.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const gen = await import("../../app/web-next/lib/business-case-generator.ts");
const runRepo = await import("../../db/repositories/investment-simulation-run.repository.ts");

const NOW = "2026-10-15T00:00:00.000Z";
const OPP = "01GOLDENOPP000000000000000";
const GF = "01GOLDENGF0000000000000000";
const GF_NOPLAN = "01GOLDENGFNOPLAN0000000000";
const GF_NOPLAN_OPP = "01GOLDENOPPNOPLAN00000000";

db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?)", [OPP, "golden", "scope", "selected", "u", NOW, 80000, 0.06]);
db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?)", [GF_NOPLAN_OPP, "golden noplan", "scope", "selected", "u", NOW, 80000, 0.06]);
db.run("INSERT INTO md_project (id, project_no, created_at, origin, source_opportunity_id, track) VALUES (?,?,?,?,?,?)", [GF, "PRJ-GOLDEN", NOW, "internal", OPP, "greenfield"]);
db.run("INSERT INTO md_project (id, project_no, created_at, origin, source_opportunity_id, track) VALUES (?,?,?,?,?,?)", [GF_NOPLAN, "PRJ-GOLDN2", NOW, "internal", GF_NOPLAN_OPP, "greenfield"]);

// A copied greenfield_cost model: manual capex/labor/opex/gov_rnd lines plus capability-sourced lines.
db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)", ["01GOLDENMODEL00000000000000", GF, "greenfield_cost", "golden copy", 5, "u", NOW]);
const MARK = "\uc5ed\ub7c9 \ud574\uc18c \ube44\uc6a9";
const addLine = (cat: string, name: string, amt: number, start: number, end: number | null, note: string | null) =>
  db.run(
    "INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, unit, start_year, end_year, growth_rate, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [`01GOLDENLINE${name}`.padEnd(26, "0"), "01GOLDENMODEL00000000000000", cat, name, amt, "KRW_M", start, end, 0, note, "u", NOW],
  );
addLine("capex", "A", 1200, 1, 1, "lump");
addLine("capex", "B", 300, 2, 2, "lump");
addLine("labor", "C", 400, 1, null, null);
addLine("opex", "D", 150, 2, 4, null);
addLine("gov_rnd", "E", 100, 2, 2, null);
addLine("capex", "F", 500, 1, 1, MARK);
addLine("opex", "G", 120, 2, 2, MARK);

async function setBasis(projectId: string, basis: "ratio" | "s5_plan" | "s5_plan_full") {
  await gen.recordBusinessCaseParams(db, { projectId, params: { investment_basis: basis }, rationale: "golden", actor: "u", now: NOW });
}

const r4 = (n: number | null) => (n === null ? null : Math.round(n * 1e6) / 1e6);
function simOf(projectId: string, scenario: "base" | "downside" = "base") {
  const inputs = gen.caseInputsForProject(projectId);
  const s = gen.runSeededSimulation(inputs, scenario);
  const plan = inputs.s5Plan ?? null;
  return {
    sim: { seed: s.seed, p05: r4(s.p05), p50: r4(s.p50), p95: r4(s.p95), mean: r4(s.mean), std: r4(s.std), bep: s.bepYear === null ? null : r4(s.bepYear) },
    flows: gen.deterministicCashflows(inputs, scenario).map(r4),
    plan: plan && { capex: plan.capexByYear, labor: plan.laborOpexByYear, gov: plan.govRndByYear, covered: plan.opexCovered, capexCap: plan.capexCapabilityByYear, laborCap: plan.laborOpexCapabilityByYear, skipped: plan.skippedLines, lineHash: plan.lineHash, horizon: plan.horizonYears },
    s5Sim: inputs.s5Sim ? { runId: "present", hash: inputs.s5Sim.inputHash, draws: inputs.s5Sim.drawCount } : null,
    jobSpec: JSON.stringify(gen.buildS8JobSpec(inputs, scenario)).replace(/01GOLDENMODEL00000000000000/g, "<model>"),
  };
}

// GOLDEN-BEGIN (captured on the pre-change baseline; do not edit by hand)
const GOLDEN: Record<string, unknown> = {
 "ratio": {
  "sim": {
   "seed": 2596622385,
   "p05": 184.458598,
   "p50": 199.662983,
   "p95": 215.570522,
   "mean": 199.797827,
   "std": 9.556985,
   "bep": 2.907928
  },
  "flows": [
   -200,
   48,
   89.04,
   121.3488,
   142.92192,
   151.497235
  ],
  "plan": {
   "capex": [
    1700,
    300,
    0,
    0,
    0
   ],
   "labor": [
    400,
    670,
    550,
    550,
    400
   ],
   "gov": [
    0,
    100,
    0,
    0,
    0
   ],
   "covered": [
    true,
    true,
    true,
    true,
    true
   ],
   "capexCap": [
    500,
    0,
    0,
    0,
    0
   ],
   "laborCap": [
    0,
    120,
    0,
    0,
    0
   ],
   "skipped": 0,
   "lineHash": "53db88a4",
   "horizon": 5
  },
  "s5Sim": null,
  "jobSpec": "{\"job_id\":\"s8:01GOLDENGF0000000000000000:base:market_forward\",\"seed_policy\":{\"base\":\"01GOLDENGF0000000000000000\",\"hash\":\"fnv1a\"},\"device\":\"auto\",\"iterations\":2000,\"horizon_years\":5,\"discount_rate\":{\"value\":0.1,\"subject\":\"promoter\",\"source\":\"default\",\"scope\":\"project\"},\"cases\":[{\"case_id\":\"base:market_forward\",\"drivers\":{\"revenue_y1\":{\"dist\":\"constant\",\"value\":400,\"unit\":\"KRW_M\",\"source\":\"\uc2dc\uc7a5\uaddc\ubaa8 \u00d7 \ud3ec\ud68d\ub960 0.5% (\uae30\ubcf8\uac12)\"},\"ramp_up\":{\"dist\":\"constant\",\"value\":[0.4,0.7,0.9,1,1],\"source\":\"\uae30\ubcf8\uac12\"},\"revenue_growth\":{\"dist\":\"normal\",\"mean\":0.06,\"sigma\":0.02,\"unit\":\"ratio\",\"source\":\"\uc2dc\uc7a5 \uc131\uc7a5\ub960 (opportunity)\"},\"opex_ratio\":{\"dist\":\"constant\",\"value\":0.6,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"capex_ratio\":{\"dist\":\"constant\",\"value\":0.1,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"initial_investment\":{\"dist\":\"constant\",\"value\":200,\"unit\":\"KRW_M\",\"source\":\"ADR-0106 (\uae30\ubcf8\uac12)\"}}}]}"
 },
 "ratioDown": {
  "sim": {
   "seed": 1281435003,
   "p05": 142.111131,
   "p50": 151.736722,
   "p95": 161.540443,
   "mean": 151.671715,
   "std": 5.888788,
   "bep": 2.938187
  },
  "flows": [
   -160,
   38.4,
   70.4256,
   94.893466,
   110.498169,
   115.802081
  ],
  "plan": {
   "capex": [
    1700,
    300,
    0,
    0,
    0
   ],
   "labor": [
    400,
    670,
    550,
    550,
    400
   ],
   "gov": [
    0,
    100,
    0,
    0,
    0
   ],
   "covered": [
    true,
    true,
    true,
    true,
    true
   ],
   "capexCap": [
    500,
    0,
    0,
    0,
    0
   ],
   "laborCap": [
    0,
    120,
    0,
    0,
    0
   ],
   "skipped": 0,
   "lineHash": "53db88a4",
   "horizon": 5
  },
  "s5Sim": null,
  "jobSpec": "{\"job_id\":\"s8:01GOLDENGF0000000000000000:downside:market_forward\",\"seed_policy\":{\"base\":\"01GOLDENGF0000000000000000\",\"hash\":\"fnv1a\"},\"device\":\"auto\",\"iterations\":2000,\"horizon_years\":5,\"discount_rate\":{\"value\":0.1,\"subject\":\"promoter\",\"source\":\"default\",\"scope\":\"project\"},\"cases\":[{\"case_id\":\"downside:market_forward\",\"drivers\":{\"revenue_y1\":{\"dist\":\"constant\",\"value\":320,\"unit\":\"KRW_M\",\"source\":\"\uc2dc\uc7a5\uaddc\ubaa8 \u00d7 \ud3ec\ud68d\ub960 0.5% (\uae30\ubcf8\uac12)\"},\"ramp_up\":{\"dist\":\"constant\",\"value\":[0.4,0.7,0.9,1,1],\"source\":\"\uae30\ubcf8\uac12\"},\"revenue_growth\":{\"dist\":\"normal\",\"mean\":0.048,\"sigma\":0.016,\"unit\":\"ratio\",\"source\":\"\uc2dc\uc7a5 \uc131\uc7a5\ub960 (opportunity)\"},\"opex_ratio\":{\"dist\":\"constant\",\"value\":0.6,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"capex_ratio\":{\"dist\":\"constant\",\"value\":0.1,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"initial_investment\":{\"dist\":\"constant\",\"value\":160,\"unit\":\"KRW_M\",\"source\":\"ADR-0106 (\uae30\ubcf8\uac12)\"}}}]}"
 },
 "s5_plan": {
  "sim": {
   "seed": 2596622385,
   "p05": -1460.115808,
   "p50": -1439.843296,
   "p95": -1418.633243,
   "mean": -1439.663504,
   "std": 12.742647,
   "bep": null
  },
  "flows": [
   -1700,
   -236,
   118.72,
   161.7984,
   190.56256,
   201.996314
  ],
  "plan": {
   "capex": [
    1700,
    300,
    0,
    0,
    0
   ],
   "labor": [
    400,
    670,
    550,
    550,
    400
   ],
   "gov": [
    0,
    100,
    0,
    0,
    0
   ],
   "covered": [
    true,
    true,
    true,
    true,
    true
   ],
   "capexCap": [
    500,
    0,
    0,
    0,
    0
   ],
   "laborCap": [
    0,
    120,
    0,
    0,
    0
   ],
   "skipped": 0,
   "lineHash": "53db88a4",
   "horizon": 5
  },
  "s5Sim": null,
  "jobSpec": "{\"job_id\":\"s8:01GOLDENGF0000000000000000:base:market_forward\",\"seed_policy\":{\"base\":\"01GOLDENGF0000000000000000\",\"hash\":\"fnv1a\"},\"device\":\"auto\",\"iterations\":2000,\"horizon_years\":5,\"discount_rate\":{\"value\":0.1,\"subject\":\"promoter\",\"source\":\"default\",\"scope\":\"project\"},\"cases\":[{\"case_id\":\"base:market_forward\",\"drivers\":{\"revenue_y1\":{\"dist\":\"constant\",\"value\":400,\"unit\":\"KRW_M\",\"source\":\"\uc2dc\uc7a5\uaddc\ubaa8 \u00d7 \ud3ec\ud68d\ub960 0.5% (\uae30\ubcf8\uac12)\"},\"ramp_up\":{\"dist\":\"constant\",\"value\":[0.4,0.7,0.9,1,1],\"source\":\"\uae30\ubcf8\uac12\"},\"revenue_growth\":{\"dist\":\"normal\",\"mean\":0.06,\"sigma\":0.02,\"unit\":\"ratio\",\"source\":\"\uc2dc\uc7a5 \uc131\uc7a5\ub960 (opportunity)\"},\"opex_ratio\":{\"dist\":\"constant\",\"value\":0.6,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"capex_ratio\":{\"dist\":\"constant\",\"value\":0,\"unit\":\"ratio\",\"source\":\"S5 \ud22c\uc790 \uacc4\ud68d \uc2a4\ucf00\uc904\ub85c \ub300\uccb4 (model <model>)\"},\"initial_investment\":{\"dist\":\"constant\",\"value\":1700,\"unit\":\"KRW_M\",\"source\":\"S5 \ud22c\uc790 \uacc4\ud68d Y1 \uc9d1\ud589\uc561 \u2014 greenfield_cost model <model> (OD-3: \uacc4\ud68d 1\ub144\ucc28 \uc9c0\ucd9c\uc744 year-0\uc73c\ub85c \ubc18\uc601)\"}}}]}"
 },
 "s5_planDown": {
  "sim": {
   "seed": 1281435003,
   "p05": -1569.912432,
   "p50": -1557.078309,
   "p95": -1544.006683,
   "mean": -1557.164986,
   "std": 7.851718,
   "bep": null
  },
  "flows": [
   -1700,
   -248.8,
   93.9008,
   126.524621,
   147.330892,
   154.402775
  ],
  "plan": {
   "capex": [
    1700,
    300,
    0,
    0,
    0
   ],
   "labor": [
    400,
    670,
    550,
    550,
    400
   ],
   "gov": [
    0,
    100,
    0,
    0,
    0
   ],
   "covered": [
    true,
    true,
    true,
    true,
    true
   ],
   "capexCap": [
    500,
    0,
    0,
    0,
    0
   ],
   "laborCap": [
    0,
    120,
    0,
    0,
    0
   ],
   "skipped": 0,
   "lineHash": "53db88a4",
   "horizon": 5
  },
  "s5Sim": null,
  "jobSpec": "{\"job_id\":\"s8:01GOLDENGF0000000000000000:downside:market_forward\",\"seed_policy\":{\"base\":\"01GOLDENGF0000000000000000\",\"hash\":\"fnv1a\"},\"device\":\"auto\",\"iterations\":2000,\"horizon_years\":5,\"discount_rate\":{\"value\":0.1,\"subject\":\"promoter\",\"source\":\"default\",\"scope\":\"project\"},\"cases\":[{\"case_id\":\"downside:market_forward\",\"drivers\":{\"revenue_y1\":{\"dist\":\"constant\",\"value\":320,\"unit\":\"KRW_M\",\"source\":\"\uc2dc\uc7a5\uaddc\ubaa8 \u00d7 \ud3ec\ud68d\ub960 0.5% (\uae30\ubcf8\uac12)\"},\"ramp_up\":{\"dist\":\"constant\",\"value\":[0.4,0.7,0.9,1,1],\"source\":\"\uae30\ubcf8\uac12\"},\"revenue_growth\":{\"dist\":\"normal\",\"mean\":0.048,\"sigma\":0.016,\"unit\":\"ratio\",\"source\":\"\uc2dc\uc7a5 \uc131\uc7a5\ub960 (opportunity)\"},\"opex_ratio\":{\"dist\":\"constant\",\"value\":0.6,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"capex_ratio\":{\"dist\":\"constant\",\"value\":0,\"unit\":\"ratio\",\"source\":\"S5 \ud22c\uc790 \uacc4\ud68d \uc2a4\ucf00\uc904\ub85c \ub300\uccb4 (model <model>)\"},\"initial_investment\":{\"dist\":\"constant\",\"value\":1700,\"unit\":\"KRW_M\",\"source\":\"S5 \ud22c\uc790 \uacc4\ud68d Y1 \uc9d1\ud589\uc561 \u2014 greenfield_cost model <model> (OD-3: \uacc4\ud68d 1\ub144\ucc28 \uc9c0\ucd9c\uc744 year-0\uc73c\ub85c \ubc18\uc601)\"}}}]}"
 },
 "s5_plan_full": {
  "sim": {
   "seed": 2596622385,
   "p05": -2220.183219,
   "p50": -2169.501938,
   "p95": -2116.476806,
   "mean": -2169.052458,
   "std": 31.856618,
   "bep": null
  },
  "flows": [
   -1700,
   -300,
   -172.2,
   -90.504,
   -73.5936,
   104.990784
  ],
  "plan": {
   "capex": [
    1700,
    300,
    0,
    0,
    0
   ],
   "labor": [
    400,
    670,
    550,
    550,
    400
   ],
   "gov": [
    0,
    100,
    0,
    0,
    0
   ],
   "covered": [
    true,
    true,
    true,
    true,
    true
   ],
   "capexCap": [
    500,
    0,
    0,
    0,
    0
   ],
   "laborCap": [
    0,
    120,
    0,
    0,
    0
   ],
   "skipped": 0,
   "lineHash": "53db88a4",
   "horizon": 5
  },
  "s5Sim": null,
  "jobSpec": "{\"job_id\":\"s8:01GOLDENGF0000000000000000:base:market_forward\",\"seed_policy\":{\"base\":\"01GOLDENGF0000000000000000\",\"hash\":\"fnv1a\"},\"device\":\"auto\",\"iterations\":2000,\"horizon_years\":5,\"discount_rate\":{\"value\":0.1,\"subject\":\"promoter\",\"source\":\"default\",\"scope\":\"project\"},\"cases\":[{\"case_id\":\"base:market_forward\",\"drivers\":{\"revenue_y1\":{\"dist\":\"constant\",\"value\":400,\"unit\":\"KRW_M\",\"source\":\"\uc2dc\uc7a5\uaddc\ubaa8 \u00d7 \ud3ec\ud68d\ub960 0.5% (\uae30\ubcf8\uac12)\"},\"ramp_up\":{\"dist\":\"constant\",\"value\":[0.4,0.7,0.9,1,1],\"source\":\"\uae30\ubcf8\uac12\"},\"revenue_growth\":{\"dist\":\"normal\",\"mean\":0.06,\"sigma\":0.02,\"unit\":\"ratio\",\"source\":\"\uc2dc\uc7a5 \uc131\uc7a5\ub960 (opportunity)\"},\"opex_ratio\":{\"dist\":\"constant\",\"value\":0.6,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"capex_ratio\":{\"dist\":\"constant\",\"value\":0,\"unit\":\"ratio\",\"source\":\"S5 \ud22c\uc790 \uacc4\ud68d \uc2a4\ucf00\uc904\ub85c \ub300\uccb4 (model <model>)\"},\"initial_investment\":{\"dist\":\"constant\",\"value\":1700,\"unit\":\"KRW_M\",\"source\":\"S5 \ud22c\uc790 \uacc4\ud68d Y1 \uc9d1\ud589\uc561 \u2014 greenfield_cost model <model> (OD-3: \uacc4\ud68d 1\ub144\ucc28 \uc9c0\ucd9c\uc744 year-0\uc73c\ub85c \ubc18\uc601)\"}}}]}"
 },
 "s5_plan_run": {
  "sim": {
   "seed": 2596622385,
   "p05": -1658.670673,
   "p50": -1439.447175,
   "p95": -1230.205303,
   "mean": -1440.596097,
   "std": 131.567692,
   "bep": null
  },
  "flows": [
   -1700,
   -236,
   118.72,
   161.7984,
   190.56256,
   201.996314
  ],
  "plan": {
   "capex": [
    1700,
    300,
    0,
    0,
    0
   ],
   "labor": [
    400,
    670,
    550,
    550,
    400
   ],
   "gov": [
    0,
    100,
    0,
    0,
    0
   ],
   "covered": [
    true,
    true,
    true,
    true,
    true
   ],
   "capexCap": [
    500,
    0,
    0,
    0,
    0
   ],
   "laborCap": [
    0,
    120,
    0,
    0,
    0
   ],
   "skipped": 0,
   "lineHash": "53db88a4",
   "horizon": 5
  },
  "s5Sim": {
   "runId": "present",
   "hash": "golden-hash",
   "draws": 300
  },
  "jobSpec": "{\"job_id\":\"s8:01GOLDENGF0000000000000000:base:market_forward\",\"seed_policy\":{\"base\":\"01GOLDENGF0000000000000000\",\"hash\":\"fnv1a\"},\"device\":\"auto\",\"iterations\":2000,\"horizon_years\":5,\"discount_rate\":{\"value\":0.1,\"subject\":\"promoter\",\"source\":\"default\",\"scope\":\"project\"},\"cases\":[{\"case_id\":\"base:market_forward\",\"drivers\":{\"revenue_y1\":{\"dist\":\"constant\",\"value\":400,\"unit\":\"KRW_M\",\"source\":\"\uc2dc\uc7a5\uaddc\ubaa8 \u00d7 \ud3ec\ud68d\ub960 0.5% (\uae30\ubcf8\uac12)\"},\"ramp_up\":{\"dist\":\"constant\",\"value\":[0.4,0.7,0.9,1,1],\"source\":\"\uae30\ubcf8\uac12\"},\"revenue_growth\":{\"dist\":\"normal\",\"mean\":0.06,\"sigma\":0.02,\"unit\":\"ratio\",\"source\":\"\uc2dc\uc7a5 \uc131\uc7a5\ub960 (opportunity)\"},\"opex_ratio\":{\"dist\":\"constant\",\"value\":0.6,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"capex_ratio\":{\"dist\":\"constant\",\"value\":0,\"unit\":\"ratio\",\"source\":\"S5 \ud22c\uc790 \uacc4\ud68d \uc2a4\ucf00\uc904\ub85c \ub300\uccb4 (model <model>)\"},\"initial_investment\":{\"dist\":\"constant\",\"value\":1700,\"unit\":\"KRW_M\",\"source\":\"S5 \ud22c\uc790 \uacc4\ud68d Y1 \uc9d1\ud589\uc561 \u2014 greenfield_cost model <model> (OD-3: \uacc4\ud68d 1\ub144\ucc28 \uc9c0\ucd9c\uc744 year-0\uc73c\ub85c \ubc18\uc601)\"}}}]}"
 },
 "noplan": {
  "sim": {
   "seed": 3577540653,
   "p05": 184.499134,
   "p50": 200.157223,
   "p95": 215.499634,
   "mean": 200.10252,
   "std": 9.387323,
   "bep": 2.907928
  },
  "flows": [
   -200,
   48,
   89.04,
   121.3488,
   142.92192,
   151.497235
  ],
  "plan": null,
  "s5Sim": null,
  "jobSpec": "{\"job_id\":\"s8:01GOLDENGFNOPLAN0000000000:base:market_forward\",\"seed_policy\":{\"base\":\"01GOLDENGFNOPLAN0000000000\",\"hash\":\"fnv1a\"},\"device\":\"auto\",\"iterations\":2000,\"horizon_years\":5,\"discount_rate\":{\"value\":0.1,\"subject\":\"promoter\",\"source\":\"default\",\"scope\":\"project\"},\"cases\":[{\"case_id\":\"base:market_forward\",\"drivers\":{\"revenue_y1\":{\"dist\":\"constant\",\"value\":400,\"unit\":\"KRW_M\",\"source\":\"\uc2dc\uc7a5\uaddc\ubaa8 \u00d7 \ud3ec\ud68d\ub960 0.5% (\uae30\ubcf8\uac12)\"},\"ramp_up\":{\"dist\":\"constant\",\"value\":[0.4,0.7,0.9,1,1],\"source\":\"\uae30\ubcf8\uac12\"},\"revenue_growth\":{\"dist\":\"normal\",\"mean\":0.06,\"sigma\":0.02,\"unit\":\"ratio\",\"source\":\"\uc2dc\uc7a5 \uc131\uc7a5\ub960 (opportunity)\"},\"opex_ratio\":{\"dist\":\"constant\",\"value\":0.6,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"capex_ratio\":{\"dist\":\"constant\",\"value\":0.1,\"unit\":\"ratio\",\"source\":\"\uae30\ubcf8\uac12\"},\"initial_investment\":{\"dist\":\"constant\",\"value\":200,\"unit\":\"KRW_M\",\"source\":\"ADR-0106 (\uae30\ubcf8\uac12)\"}}}]}"
 },
 "brownfield": {
  "seed": 3577540653,
  "p05": 34141.193791,
  "p50": 40595.998142,
  "p95": 46984.324546,
  "mean": 40572.969878,
  "std": 3931.449032,
  "flows": [
   -90000,
   7200,
   13356,
   18202.32,
   21438.288,
   136347.51168
  ]
 }
};
// GOLDEN-END

const captured: Record<string, unknown> = {};
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("S8 copy path golden", () => {
  test("ratio", async () => {
    await setBasis(GF, "ratio");
    captured.ratio = simOf(GF);
    captured.ratioDown = simOf(GF, "downside");
    if (GOLDEN.ratio) expect(captured.ratio).toEqual(GOLDEN.ratio);
  });
  test("s5_plan", async () => {
    await setBasis(GF, "s5_plan");
    captured.s5_plan = simOf(GF);
    captured.s5_planDown = simOf(GF, "downside");
    if (GOLDEN.s5_plan) expect(captured.s5_plan).toEqual(GOLDEN.s5_plan);
  });
  test("s5_plan_full", async () => {
    await setBasis(GF, "s5_plan_full");
    captured.s5_plan_full = simOf(GF);
    if (GOLDEN.s5_plan_full) expect(captured.s5_plan_full).toEqual(GOLDEN.s5_plan_full);
  });
  test("s5_plan with a confirmed S5 run", async () => {
    await setBasis(GF, "s5_plan");
    const run = runRepo.insertInvestmentSimulationRun({ opportunityId: OPP, inputHash: "golden-hash", seed: 777, drawCount: 300, horizonYears: 5, envelopeKrwM: null, assumptions: { salaryRange: 0.1, salaryIncreaseRangePp: 2, onCostRangePp: 2, rampShiftHalfYears: 0.5, capabilityRange: 0.3, manualLineRange: 0.2 }, results: {}, actor: "u", now: NOW }, db);
    runRepo.confirmInvestmentSimulationRun(OPP, run.id, "u", NOW, db);
    captured.s5_plan_run = simOf(GF);
    if (GOLDEN.s5_plan_run) expect(captured.s5_plan_run).toEqual(GOLDEN.s5_plan_run);
  });
  test("no plan: s5_plan basis falls back to the ratio path", async () => {
    await setBasis(GF_NOPLAN, "s5_plan");
    captured.noplan = simOf(GF_NOPLAN);
    expect(captured.noplan).toMatchObject({ plan: null, s5Sim: null });
    if (GOLDEN.noplan) expect(captured.noplan).toEqual(GOLDEN.noplan);
  });
  test("brown field acquisition case", () => {
    const base = gen.caseInputsForProject(GF_NOPLAN);
    const inputs = { ...base, revenueAnchor: { krwM: 60000, source: "golden anchor" }, acquisition: { evRevenue: 1.5, source: "golden" } } as never;
    const s = gen.runSeededSimulation(inputs, "base");
    captured.brownfield = { seed: s.seed, p05: r4(s.p05), p50: r4(s.p50), p95: r4(s.p95), mean: r4(s.mean), std: r4(s.std), flows: gen.deterministicCashflows(inputs, "base").map(r4) };
    if (GOLDEN.brownfield) expect(captured.brownfield).toEqual(GOLDEN.brownfield);
  });
  test("print", () => {
    if (process.env.PRINT_GOLDEN) console.log("GOLDEN_JSON=" + JSON.stringify(captured));
    expect(Object.keys(GOLDEN).length === 0 || Object.keys(GOLDEN).length === Object.keys(captured).length).toBe(true);
  });
});
