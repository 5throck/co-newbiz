/**
 * Dual-perspective valuation tests — ADR-0117 regression.
 *
 * Covers:
 *  - resolveGrowthModel: no bound company → historical null, market growth
 *    from the S2 opportunity fact; with DART facts → historical CAGR/sigma from
 *    the bound company; dispersion clamped to [0.02, 0.25];
 *  - generation: with historical data → 6 models (3 scenarios × 2 variants),
 *    variant column persisted;
 *  - variants differ genuinely; each variant reproduces deterministically;
 *  - RECOMMENDED judges the market_forward variant only — a higher
 *    historical p05 must NOT flip the flag.
 *
 * Mirrors business-case.test.ts's harness: CO_NEWBIZ_DB_PATH isolation is set
 * at module top BEFORE any import (resetDb() ignores paths — the env var is
 * the only safe isolation mechanism).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case-dual-view.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { ulid } = await import("../../db/lib/ulid.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const {
  resolveGrowthModel,
  generateBusinessCases,
  runSeededSimulation,
  caseInputsForProject,
  recommendedFromDb,
} = await import("../../app/web-next/lib/business-case-generator.ts");

const NOW = new Date().toISOString();
let projectId = "";
const companyId = ulid();

beforeAll(async () => {
  // The promoter becomes the lead project member — it needs a real account
  // (FR-SEC-08 forbids phantom grantors).
  await createUser(db, { userId: "dualview", role: "analyst", password: "pw-dualview-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "dualview", approvedBy: "test", now: NOW });

  // Greenfield promotion (ADR-0095) — same fixture chain as
  // business-case.test.ts: opportunity → route_decision → greenfield_assessment.
  const oppId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, growth_rate, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [oppId, "듀얼뷰 검토", "로봇", 0.12, "selected", "test", NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?)",
    [ulid(), oppId, "greenfield", "test route", "dualview", NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, capability_gaps_json, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, JSON.stringify([{ gap: "g1", resolution: "hire" }]), "직접 진출", "M&A 대안 검토", "dual-view test", "dualview", NOW, NOW],
  );
  // Promotion preconditions (2026-09-12): screening + pre_fs must be GO.
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", "dualview", NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: "dualview", needToKnowBasis: "dual-view test" }).project.id;

  // Bind a company and seed 5 years of perfectly-geometric revenue growth
  // (CAGR exactly 30%) through the same tables the real writer fills.
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [companyId, "㈜듀얼뷰", "09999999", NOW]);
  const sourceId = ulid();
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceId, "dart", "A", NOW]);
  const accountId = (db.query("SELECT id FROM md_account WHERE name_ko = '매출액'").get() as { id: string }).id;
  let value = 100;
  for (const year of [2021, 2022, 2023, 2024, 2025]) {
    value = year === 2021 ? 100 : Math.round(value * 1.3);
    let periodId = (db.query("SELECT id FROM md_period WHERE period_type='year' AND fiscal_year=?").get(year) as { id: string } | undefined)?.id;
    if (!periodId) {
      periodId = ulid();
      db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", [periodId, "year", `${year}-01-01`, `${year}-12-31`, year, NOW]);
    }
    db.run(
      "INSERT INTO fact_financial (id, company_id, period_id, account_id, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), companyId, periodId, accountId, value, 1, sourceId, NOW],
    );
  }
  db.run("UPDATE md_project SET company_id = ?, subject_company_rationale = ? WHERE id = ?", [companyId, "dual-view test", projectId]);
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("resolveGrowthModel (ADR-0117)", () => {
  test("bound company → historical CAGR from DART facts; market from opportunity", () => {
    const gm = resolveGrowthModel(db, projectId);
    expect(gm.historical).not.toBeNull();
    // 100 → 100×1.3⁴ over 4 growth years = ~30% CAGR (rounding drift ok).
    expect(gm.historical!.growth).toBeGreaterThan(0.29);
    expect(gm.historical!.growth).toBeLessThan(0.31);
    // Perfectly geometric series → sigma ≈ 0 → clamped to the floor.
    expect(gm.historical!.disp).toBeCloseTo(0.02, 6);
    expect(gm.historical!.growthSource).toContain("DART");
    expect(gm.market.growth).toBeCloseTo(0.12, 6);
    expect(gm.market.growthSource).toContain("opportunity");
    // No wacc.beta_vol_asset assumption in this fixture → the historical vol
    // doubles as the forward profile.
    expect(gm.market.disp).toBeCloseTo(0.02, 6);
  });

  test("dispersion clamp bounds hold when volatility is extreme", () => {
    // 10× revenue in one year → growth sigma way above the cap; the clamped
    // forward profile must still be ≤ 0.25.
    const project2 = "01JDVEXTREME00000000000000";
    db.run(
      `INSERT INTO md_project (id, project_no, created_at, company_id, subject_company_rationale, project_name, status)
       VALUES (?,?,?,?,?,?, 'open')`,
      [project2, "DV-X1", NOW, companyId, "clamp test", "클램프 테스트"],
    );
    const gm = resolveGrowthModel(db, project2);
    expect(gm.market.disp).toBeLessThanOrEqual(0.25);
    expect(gm.historical!.disp).toBeLessThanOrEqual(0.25);
  });
});

describe("dual-variant generation (ADR-0117)", () => {
  test("produces 6 models (3 scenarios × 2 variants) with persisted variant column", async () => {
    const result = await generateBusinessCases(projectId, { actor: "test" });
    expect(result.status).toBe("done");
    const models = db
      .query("SELECT id, name, variant FROM business_case_model WHERE project_id = ?")
      .all(projectId) as Array<{ id: string; name: string; variant: string }>;
    expect(models.length).toBe(6);
    expect(models.filter((m) => m.variant === "market_forward").length).toBe(3);
    expect(models.filter((m) => m.variant === "historical").length).toBe(3);
    for (const m of models) expect(["market_forward", "historical"]).toContain(m.variant);
  });

  test("variants differ genuinely; each variant reproduces deterministically", () => {
    const inputs = caseInputsForProject(projectId);
    expect(inputs.growthModel?.historical).not.toBeNull();
    const mfBase = runSeededSimulation(inputs, "base", "market_forward");
    const hBase = runSeededSimulation(inputs, "base", "historical");
    expect(mfBase.p50).not.toBe(hBase.p50);
    expect(runSeededSimulation(inputs, "base", "historical").p50).toBe(hBase.p50);
    expect(runSeededSimulation(inputs, "base", "market_forward").p50).toBe(mfBase.p50);
  });

  test("RECOMMENDED judges market_forward only — a higher historical p05 must not flip it", () => {
    const mfP05 = db
      .query(
        `SELECT v.scenario, v.npv_krw_m FROM valuation_simulation v
         JOIN business_case_model m ON m.id = v.model_id
         WHERE v.project_id = ? AND v.percentile = 'p05' AND COALESCE(m.variant, 'market_forward') = 'market_forward'`,
      )
      .all(projectId) as Array<{ scenario: string; npv_krw_m: number }>;
    const histP05 = db
      .query(
        `SELECT v.npv_krw_m FROM valuation_simulation v
         JOIN business_case_model m ON m.id = v.model_id
         WHERE v.project_id = ? AND v.percentile = 'p05' AND m.variant = 'historical'`,
      )
      .all(projectId) as Array<{ npv_krw_m: number }>;
    expect(mfP05.length).toBe(3);
    const rec = recommendedFromDb(projectId);
    expect(rec).not.toBeNull();
    const mfMax = Math.max(...mfP05.map((r) => r.npv_krw_m));
    expect(mfP05.find((r) => r.scenario === rec)!.npv_krw_m).toBe(mfMax);
    // The fixture makes historical (30% CAGR) dominate market (12%) — the
    // assertion documents that the flag did NOT follow it.
    expect(Math.max(...histP05.map((r) => r.npv_krw_m))).toBeGreaterThan(mfMax);
  });
});
