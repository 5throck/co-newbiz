/**
 * Round archiving on regeneration (FIX 1) and the widened IRR bracket (FIX 2).
 *
 * FIX 1: every generateBusinessCases run first archives the previous round's
 * non-adopted, non-archived valuation models (greenfield: target_id NULL;
 * brownfield: the same shortlisted targets). Models a decision record names
 * (adoption / gate / process_run) are never archived, so adoption / IC
 * history keeps resolving. An interrupted round (lone base model from a
 * double press) is just a previous round.
 *
 * FIX 2: irr() widens the [-0.9, 10] bracket stepwise (x10 up to a 1e6
 * ceiling) so a tiny year-0 outflow against large positive flows no longer
 * returns null - a linked S5 plan with small capex produces exactly that
 * shape. null stays reserved for genuinely no sign change anywhere.
 *
 * Mirrors business-case-dual-view.test.ts's harness (env-var DB isolation set
 * at module top BEFORE any import; deterministic executor stub).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case-round-archival.sqlite";
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
const { generateBusinessCases, irr } = await import("../../app/web-next/lib/business-case-generator.ts");

const NOW = new Date().toISOString();
const ACTOR = "round-archival-actor";

let greenProject = "";
let brownProject = "";
let targetA = "";
let targetB = "";

function addGate(oppId: string, gate: string) {
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), "opportunity", oppId, gate, "go", "test", ACTOR, NOW],
  );
}

function seedGreenfield(name: string): string {
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, growth_rate, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [oppId, name, "robots", 0.12, "selected", ACTOR, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
    [ulid(), oppId, "greenfield", "test route", ACTOR, NOW],
  );
  db.run(
    "INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), oppId, "direct entry", "M&A rejected", name, ACTOR, NOW, NOW],
  );
  // S5 completion predicate: >=1 capability gap in opportunity.capability_gap_json.
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "c1", resolution: "hire" }], updatedAt: NOW }), oppId],
  );
  addGate(oppId, "screening");
  addGate(oppId, "pre_fs");
  return promoteOpportunity(oppId, { promotedBy: ACTOR, needToKnowBasis: "round archival test" }).project.id;
}

function seedBrownfield(): string {
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, "brownfield archival test", "robots", "selected", ACTOR, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, "brownfield", "m_and_a", "test route", ACTOR, NOW],
  );
  addGate(oppId, "screening");
  addGate(oppId, "pre_fs");
  addGate(oppId, "target_screening");
  targetA = ulid();
  targetB = ulid();
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    [targetA, oppId, "TargetA", "shortlisted", 1, NOW, NOW],
  );
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    [targetB, oppId, "TargetB", "shortlisted", 2, NOW, NOW],
  );
  return promoteOpportunity(oppId, { promotedBy: ACTOR, needToKnowBasis: "round archival test" }).project.id;
}

function addModel(name: string, projectId: string, target: string | null): string {
  const id = ulid();
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, target_id) VALUES (?,?,?,?,?,?,?,?)",
    [id, projectId, "valuation", name, 5, ACTOR, NOW, target],
  );
  db.run(
    "INSERT INTO valuation_simulation (id, model_id, project_id, scenario, percentile, npv_krw_m, created_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), id, projectId, "base", "p50", 100, NOW],
  );
  return id;
}

beforeAll(async () => {
  await createUser(db, { userId: ACTOR, role: "analyst", password: "pw-round-archival-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ACTOR, approvedBy: "test", now: NOW });
  greenProject = seedGreenfield("greenfield archival test");
  brownProject = seedBrownfield();
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function activeModels(projectId: string): Array<{ id: string; target_id: string | null }> {
  return db
    .query("SELECT id, target_id FROM business_case_model WHERE project_id = ? AND archived_at IS NULL")
    .all(projectId) as Array<{ id: string; target_id: string | null }>;
}

function auditRows(projectId: string): Array<{ action: string; target: string }> {
  return db.query("SELECT action, target FROM audit_log WHERE target LIKE ?").all(projectId + ":%") as Array<{ action: string; target: string }>;
}

describe("FIX 1 - round archiving", () => {
  test("second run archives the first round; adopted and gate-referenced models survive", async () => {
    const r1 = await generateBusinessCases(greenProject, { actor: ACTOR });
    expect(r1.status).toBe("done");
    const first = activeModels(greenProject);
    expect(first.length).toBe(3);

    // Human adoption (s8_case_adopt) of one first-round model, and a gate
    // rationale naming another - both must SURVIVE the next round unarchived.
    const adopted = first[0].id;
    const gateNamed = first[1].id;
    db.run(
      "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [ulid(), "project", greenProject, greenProject, "test", "s8_case_adopt", "done", "web", ACTOR, NOW, NOW, JSON.stringify({ model_id: adopted })],
    );
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "project", greenProject, "fs", "hold", "base case model " + gateNamed + " needed", ACTOR, NOW],
    );

    const r2 = await generateBusinessCases(greenProject, { actor: ACTOR });
    expect(r2.status).toBe("done");
    // Protected pair + the 3 fresh models remain active; the remaining
    // first-round model is archived.
    expect(activeModels(greenProject).length).toBe(5);
    const archived = db
      .query("SELECT id, archived_by FROM business_case_model WHERE project_id = ? AND archived_at IS NOT NULL")
      .all(greenProject) as Array<{ id: string; archived_by: string | null }>;
    expect(archived.length).toBe(1);
    expect(archived[0].archived_by).toBe(ACTOR);
    expect(archived[0].id).not.toBe(adopted);
    expect(archived[0].id).not.toBe(gateNamed);
    const superseded = auditRows(greenProject).filter((a) => a.action === "business_case.superseded_round");
    expect(superseded.length).toBe(1);
    expect(superseded[0].target).toBe(greenProject + ":" + archived[0].id);
  });

  test("interrupted round (lone base model) is archived by the next run", async () => {
    addModel("lone base", greenProject, null);
    const r = await generateBusinessCases(greenProject, { actor: ACTOR });
    expect(r.status).toBe("done");
    // The whole round-2 set AND the lone base are archived (they are all
    // previous rounds); only the protected pair + 3 fresh models remain.
    expect(activeModels(greenProject).length).toBe(5);
    const lone = db
      .query("SELECT archived_at FROM business_case_model WHERE project_id = ? AND name = 'lone base'")
      .get(greenProject) as { archived_at: string | null };
    expect(lone.archived_at).not.toBeNull();
  });
});

describe("brownfield per-target scoping", () => {
  test("regeneration archives the same target's models, leaves dropped targets alone", async () => {
    const r1 = await generateBusinessCases(brownProject, { actor: ACTOR });
    expect(r1.status).toBe("done");
    // TargetB is dropped from the shortlist between rounds.
    db.run("UPDATE brownfield_target SET status = 'excluded' WHERE id = ?", [targetB]);
    const r2 = await generateBusinessCases(brownProject, { actor: ACTOR });
    expect(r2.status).toBe("done");
    const active = activeModels(brownProject);
    // targetB's first-round models are outside this run's scope and stay active.
    const bActive = active.filter((m) => m.target_id === targetB);
    expect(bActive.length).toBe(3);
    // targetA's old round is archived; this run produced a fresh A set.
    const aActive = active.filter((m) => m.target_id === targetA);
    expect(aActive.length).toBe(3);
    const aArchived = db
      .query("SELECT COUNT(*) AS n FROM business_case_model WHERE project_id = ? AND target_id = ? AND archived_at IS NOT NULL")
      .get(brownProject, targetA) as { n: number };
    expect(aArchived.n).toBe(3);
  });
});

describe("FIX 2 - irr bracket widening", () => {
  test("tiny outflow vs large flows yields a very large IRR, reproducible by bisection", () => {
    // Year-0 outflow of 1 against ~4-digit flows: the root sits near 7000
    // (700,000%) - far above the old [-0.9, 10] bracket.
    const flows = [-1, 7000, 10000, 12000];
    const r = irr(flows);
    expect(r).not.toBeNull();
    expect(r! > 1e3).toBe(true);
    // Bisection recomputation: NPV at the returned rate must be ~0.
    const npv = (rate: number) => flows.reduce((a, cf, i) => a + cf / Math.pow(1 + rate, i), 0);
    expect(Math.abs(npv(r!))).toBeLessThan(1e-6);
    // Deterministic: the same flows always give the same IRR.
    expect(irr(flows)).toBe(r);
  });

  test("normal flows unchanged (textbook root)", () => {
    // -100 + 120/(1+r) = 0 exactly when r = 20%, inside the old bracket.
    const r = irr([-100, 120]);
    expect(r).not.toBeNull();
    expect(Math.abs(r! - 0.2)).toBeLessThan(1e-6);
  });

  test("zero outflow still null (no sign change anywhere)", () => {
    expect(irr([0, 50, 50])).toBeNull();
  });

  test("all-negative still null", () => {
    expect(irr([-10, -20, -30])).toBeNull();
  });
});
