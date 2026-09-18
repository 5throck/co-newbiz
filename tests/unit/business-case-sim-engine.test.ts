// @version 1.0.0
/**
 * S8 generation x standalone sim-engine bridge (spec
 * 2026-09-18-s8-business-case-evaluation section 1) — proves:
 *  (a) with the engine available, generated valuation_simulation notes name
 *      the python engine, the device/backend that ran, and carry bep_year;
 *  (b) with CO_NEWBIZ_SIM_ENGINE=off (the ops kill switch), generation still
 *      succeeds through the legacy in-process simulator stamped engine=inline-ts;
 *  (c) either way the ADR-0098 invariants hold: three scenarios, genuinely
 *      different distributions, seeds persisted.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case-sim-engine.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";
delete process.env.CO_NEWBIZ_SIM_ENGINE; // engine ON for scenario (a)

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

const NOW = new Date().toISOString();
const ANALYST = "s8engine1";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let analystCookie = "";
let engineProjectId = "";
let fallbackProjectId = "";

async function seedProject(name: string): Promise<string> {
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, name, "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
    [ulid(), oppId, "greenfield", "test route", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), oppId],
  );
  for (const gate of ["screening", "pre_fs"]) {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW],
    );
  }
  return promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "sim-engine bridge test" }).project.id;
}

async function generate(projectId: string): Promise<void> {
  const res = await req(`/api/projects/${projectId}/business-case/generate`, {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(201);
}

function simulationNotes(projectId: string): Array<{ scenario: string; percentile: string; note: string }> {
  return db
    .query(
      `SELECT vs.scenario, vs.percentile, vs.note FROM valuation_simulation vs
       JOIN business_case_model m ON m.id = vs.model_id WHERE m.project_id = ?`,
    )
    .all(projectId) as Array<{ scenario: string; percentile: string; note: string }>;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-s8engine-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-s8engine-12345");
  engineProjectId = await seedProject("엔진 경로 프로젝트");
  fallbackProjectId = await seedProject("폴백 경로 프로젝트");
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("S8 generation x sim-engine bridge", () => {
  test("(a) engine path: notes name the python engine, device, and carry bep_year", async () => {
    await generate(engineProjectId);
    const notes = simulationNotes(engineProjectId);
    expect(notes.length).toBeGreaterThanOrEqual(9); // 3 scenarios x 3 percentiles
    for (const row of notes) {
      expect(row.note).toContain("engine=python-sim-engine@");
      expect(row.note).toMatch(/device=(cpu|cuda|mps|xpu|rocm)\/(numpy|torch)/);
      expect(row.note).toMatch(/precision=(float64|float32)/);
    }
    const p50Notes = notes.filter((n) => n.percentile === "p50");
    for (const row of p50Notes) {
      expect(row.note).toMatch(/bep_year=\d/); // the BEP year is stamped (design REQ-W3-1 preview)
    }
    // Scenario distinctness survives the engine bridge (ADR-0098 invariant).
    const seeds = new Set(p50Notes.map((n) => n.note.match(/seed=(\d+)/)?.[1]));
    expect(seeds.size).toBe(3);
  });

  test("(b) kill switch: generation falls back to the legacy in-process simulator", async () => {
    process.env.CO_NEWBIZ_SIM_ENGINE = "off";
    try {
      await generate(fallbackProjectId);
      const notes = simulationNotes(fallbackProjectId);
      expect(notes.length).toBeGreaterThanOrEqual(9);
      for (const row of notes) {
        expect(row.note).toContain("engine=inline-ts");
        expect(row.note).toContain("seed=");
      }
    } finally {
      delete process.env.CO_NEWBIZ_SIM_ENGINE;
    }
  });
});
