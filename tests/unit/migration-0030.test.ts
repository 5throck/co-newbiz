/**
 * Unit tests for migration 0030 (chain scenario schema — ADR-0066, Phase B
 * of the value-chain simulation design). Real scratch SQLite (house pattern)
 * so the FKs, CHECKs and the UNIQUE triples are exercised by SQLite itself:
 *   - industry_driver: v1 quartet seeded once, code UNIQUE;
 *   - chain_node_sensitivity: sensitivity range + lag CHECKs, UNIQUE
 *     (project, industry, driver);
 *   - structure_simulation_result: scenario/metric vocabularies CHECKed,
 *     UNIQUE (run, scenario, industry, metric).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0030.sqlite";
const NOW = "2026-08-24T00:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let runId: string;
let industryA: string;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  resetDb();
  db = getDb(TEST_DB_PATH);
  runMigrations(TEST_DB_PATH);

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-0030-T", NOW]);
  const r = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [r, projectId, "h", "t", NOW]);
  runId = r;
  industryA = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryA, "30110", "선박용 엔진", "Marine engines", NOW]);
});

afterAll(() => {
  resetDb();
});

describe("industry_driver — the external-driver registry", () => {
  test("exactly four drivers seed: the approved rate/fx/commodity/regulation quartet", () => {
    const rows = db.query("SELECT id, code FROM industry_driver ORDER BY id").all() as Array<{ id: string; code: string }>;
    expect(rows.map((r) => r.code).sort()).toEqual(["commodity", "fx", "rate", "regulation"]);
    expect(rows.find((r) => r.code === "rate")!.id).toBe("drv-rate");
  });

  test("driver code is UNIQUE — extension is an INSERT of a new code, never a duplicate", () => {
    expect(() =>
      db.run("INSERT INTO industry_driver (id, code, label_ko, created_at) VALUES (?,?,?,?)", ["drv-rate-x", "fx", "중복", NOW]),
    ).toThrow(/UNIQUE/);
  });
});

describe("chain_node_sensitivity — one live sensitivity per (project, industry, driver)", () => {
  function insert(overrides: Partial<{ sensitivity: number; lag_months: number; driverId: string }> = {}) {
    return db.run(
      "INSERT INTO chain_node_sensitivity (id, project_id, industry_id, driver_id, sensitivity, lag_months, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), projectId, industryA, overrides.driverId ?? "drv-rate", overrides.sensitivity ?? -0.8, overrides.lag_months ?? 0, "mia", NOW],
    );
  }

  test("a sensitivity inside the ±10 range with non-negative lag is accepted", () => {
    expect(() => insert()).not.toThrow();
  });

  test("sensitivity beyond ±10 is rejected by CHECK", () => {
    expect(() => insert({ sensitivity: 11 })).toThrow(/CHECK/);
  });

  test("negative lag_months is rejected by CHECK", () => {
    expect(() => insert({ lag_months: -1 })).toThrow(/CHECK/);
  });

  test("the same (project, industry, driver) triple cannot have two live rows — UNIQUE", () => {
    expect(() => insert()).toThrow(/UNIQUE/);
  });
});

describe("structure_simulation_result — quantile output plane", () => {
  function insert(scenario: string, metric: string) {
    return db.run(
      "INSERT INTO structure_simulation_result (id, run_id, scenario, industry_id, metric, p05, p50, p95, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), runId, scenario, industryA, metric, -5.0, 0.2, 4.4, NOW],
    );
  }

  test("preset scenarios plus custom are admitted; unknown scenario rejected", () => {
    for (const s of ["downside", "base", "upside", "custom"]) expect(() => insert(s, "demand_delta_pct")).not.toThrow();
    expect(() => insert("black_swan", "demand_delta_pct")).toThrow(/CHECK/);
  });

  test("propagation metrics are a closed set; quantiles must be present", () => {
    expect(() => insert("base", "revenue_level")).toThrow(/CHECK/);
    expect(() =>
      db.run(
        "INSERT INTO structure_simulation_result (id, run_id, scenario, industry_id, metric, p05, p50, p95, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [ulid(), runId, "base", industryA, "hhi_delta", null, 0.0, 1.0, NOW],
      ),
    ).toThrow(/NOT NULL/);
  });

  test("one row per (run, scenario, industry, metric) — re-writing throws on UNIQUE", () => {
    insert("upside", "margin_delta_pp");
    expect(() => insert("upside", "margin_delta_pp")).toThrow(/UNIQUE/);
  });
});
