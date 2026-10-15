/**
 * Greenfield never gets the historical (past-based) variant, even when a company
 * with DART facts is linked to the project (financial-analysis tab / WACC subject).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case-greenfield-no-hist.sqlite";
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
const { resolveGrowthModel, generateBusinessCases } = await import("../../app/web-next/lib/business-case-generator.ts");

const { listBusinessCases } = await import("../../app/web-next/lib/business-case.ts");
const { hideHistoricalForGreenfield } = await import("../../app/web-next/lib/business-case-legacy.ts");

const NOW = new Date().toISOString();
let projectId = "";
const companyId = ulid();

beforeAll(async () => {
  // fixture setup (see business-case-dual-view.test.ts)
  // (FR-SEC-08 forbids phantom grantors).
  await createUser(db, { userId: "gfnohist", role: "analyst", password: "pw-gfnohist-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "gfnohist", approvedBy: "test", now: NOW });

  // fixture setup (see business-case-dual-view.test.ts)
  // fixture setup (see business-case-dual-view.test.ts)
  const oppId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, market_scope, growth_rate, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [oppId, "greenfield single view", "\ub85c\ubd07", 0.12, "selected", "test", NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
    [ulid(), oppId, "greenfield", "test route", "gfnohist", NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [ulid(), oppId, "direct", "alt", "dual-view test", "gfnohist", NOW, NOW],
  );
  // fixture setup (see business-case-dual-view.test.ts)
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), oppId],
  );
  // Promotion preconditions (2026-09-12): screening + pre_fs must be GO.
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", "gfnohist", NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: "gfnohist", needToKnowBasis: "dual-view test" }).project.id;

  // Bind a company and seed 5 years of perfectly-geometric revenue growth
  // (CAGR exactly 30%) through the same tables the real writer fills.
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [companyId, "\u321c\uadf8\ub9b0", "09999998", NOW]);
  const sourceId = ulid();
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceId, "dart", "A", NOW]);
  const accountId = (db.query("SELECT id FROM md_account WHERE name_ko = '" + "\uB9E4\uCD9C\uC561" + "'").get() as { id: string }).id;
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
  // The historical variant is Brown Field comparison evidence only; a greenfield
  // project never gets it (see business-case-greenfield-no-historical.test.ts).
  // This file exercises the variant machinery, so the fixture project carries
  // no track (project-level compat path).
});


afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("greenfield: no historical variant", () => {
  test("track is greenfield and the company link is kept", () => {
    const row = db.query("SELECT track, company_id FROM md_project WHERE id = ?").get(projectId) as { track: string; company_id: string };
    expect(row.track).toBe("greenfield");
    expect(row.company_id).toBe(companyId);
  });

  test("resolveGrowthModel: historical null, marketDisp independent of the linked company", () => {
    const gm = resolveGrowthModel(db, projectId);
    expect(gm.historical).toBeNull();
    expect(gm.companyRevenue).toBeNull();
    expect(gm.market.growth).toBeCloseTo(0.12, 6);
    // Same source as a greenfield with no company_id (no beta_vol_asset here -> 2% floor).
    const bare = "01JGFNOHIST000000000000000";
    db.run("INSERT INTO md_project (id, project_no, created_at, subject_company_rationale, project_name, status, track) VALUES (?,?,?,?,?,?,?)", [bare, "GF-X1", NOW, "x", "bare", "open", "greenfield"]);
    expect(resolveGrowthModel(db, bare).market.disp).toBe(gm.market.disp);
    expect(gm.market.dispSource).not.toContain("DART");
  });

  test("generation yields only market_forward models; historical rows are hidden from the read model", async () => {
    const result = await generateBusinessCases(projectId, { actor: "test" });
    expect(result.status).toBe("done");
    const models = db.query("SELECT id, variant FROM business_case_model WHERE project_id = ?").all(projectId) as Array<{ id: string; variant: string }>;
    expect(models.length).toBe(3);
    expect(models.every((m) => m.variant === "market_forward")).toBe(true);
    // A stored historical row (legacy) is not deleted but not shown.
    db.run("UPDATE business_case_model SET variant = 'historical' WHERE id = ?", [models[0].id]);
    const view = listBusinessCases(projectId);
    expect(view.cases.some((c) => c.variant === "historical")).toBe(false);
    expect(view.cases.length).toBe(2);
    expect((db.query("SELECT COUNT(*) AS n FROM business_case_model WHERE project_id = ?").get(projectId) as { n: number }).n).toBe(3);
  });

  test("hideHistoricalForGreenfield: hides for greenfield, keeps adopted, no-op for brownfield", () => {
    const cs = [{ variant: "market_forward" }, { variant: "historical" }, { variant: "historical", adopted: true }];
    expect(hideHistoricalForGreenfield(cs, true).length).toBe(2);
    expect(hideHistoricalForGreenfield(cs, false).length).toBe(3);
  });
});
