/**
 * Wave A3 — policy:sync / policy:impact / fin:project regression tests.
 *
 * policy:sync against the REAL policies/ tree of this repo (3 md docs —
 * the _ko pairs are excluded): idempotent, an edit supersedes the old row
 * (append-mostly). policy:impact finds real referencing surfaces (the
 * neb-policy name appears across skills/checklists/docs). fin:project on a
 * seeded project rolls up business-case year-1 nets, simulation percentiles,
 * and charter KPI targets.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-policy-finproject.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { syncPolicies, policyImpact } = await import("../../scripts/co-newbiz/policy-sync.ts");
const { projectFinancialRollup } = await import("../../scripts/co-newbiz/fin-project.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();

describe("policy:sync (real policies/ tree)", () => {
  test("first sync inserts every non-_ko policy doc", async () => {
    const r = await syncPolicies();
    expect(r.inserted).toBeGreaterThanOrEqual(3); // neb-policy + 2 entity addendums
    expect(r.docs.every((d) => d.action === "inserted")).toBe(true);
    // _ko pairs must NOT get their own registry rows
    const paths = r.docs.map((d) => d.path);
    expect(paths.some((p) => p.endsWith("_ko.md"))).toBe(false);
  });

  test("second sync is idempotent (all unchanged)", async () => {
    const r = await syncPolicies();
    expect(r.inserted).toBe(0);
    expect(r.superseded).toBe(0);
    expect(r.unchanged).toBe(r.docs.length);
  });
});

describe("policy:impact (real repo references)", () => {
  test("neb-policy resolves and finds referencing surfaces + version", () => {
    const r = policyImpact("policies/group/neb-policy.md");
    expect(r.policy.docPath).toBe("policies/group/neb-policy.md");
    expect(r.referencingFiles.length).toBeGreaterThan(3); // skills/checklists/docs reference it
    expect(r.referencingFiles.some((f) => f.includes("stage-gate") || f.includes("governance"))).toBe(true);
    expect(r.pinnedProjects).toEqual([]); // no production consumer has pinned yet
    expect(r.supersededBy).toBeNull();
  });

  test("unknown policy throws", () => {
    expect(() => policyImpact("policies/nope.md")).toThrow(/not found/);
  });
});

describe("fin:project rollup", () => {
  const projectId = ulid();
  const modelId = ulid();

  beforeAll(() => {
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "A3-TEST-001", NOW]);
    db.run(
      "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      [modelId, projectId, "valuation", "A2 test model", 5, "test", NOW],
    );
    const lines: Array<[string, string, number]> = [
      ["revenue", "매출", 100],
      ["opex", "운영비", 30],
      ["capex", "설비투자", 10],
    ];
    for (const [category, name, amount] of lines) {
      db.run(
        "INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [ulid(), modelId, category, name, amount, 1, 0, "test", NOW],
      );
    }
    for (const pct of ["p05", "p50", "p95"] as const) {
      db.run(
        "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [ulid(), projectId, modelId, "base", pct, pct === "p50" ? 50 : pct === "p05" ? 20 : 80, null, "test", NOW],
      );
    }
    db.run("UPDATE md_project SET charter_json = ? WHERE id = ?", [JSON.stringify({ kpis: [{ key: "roe", target: 12 }] }), projectId]);
  });

  test("year-1 nets, simulation percentiles, and charter KPIs roll up", () => {
    const r = projectFinancialRollup(projectId);
    expect(r.projectId).toBe(projectId);
    expect(r.models.length).toBe(1);
    expect(r.models[0].year1).toEqual({ revenue: 100, opex: 30, capex: 10, net: 60 });
    expect(r.simulations).toEqual([{ scenario: "base", p05: 20, p50: 50, p95: 80 }]);
    expect(r.charterKpis).toEqual([{ key: "roe", target: 12 }]);
  });

  test("unknown project throws", () => {
    expect(() => projectFinancialRollup("nope")).toThrow(/not found/);
  });
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});
