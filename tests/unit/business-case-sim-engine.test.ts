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
let paramsProjectId = "";

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
      // Sales-plan provenance rides in the note too (design REQ-W1-2/3).
      expect(row.note).toMatch(/capture_rate=0\.00[0-9]+/);
      expect(row.note).toContain("ramp_source=");
    }
    const p50Notes = notes.filter((n) => n.percentile === "p50");
    for (const row of p50Notes) {
      expect(row.note).toMatch(/bep_year=\d/); // the BEP year is stamped (design REQ-W3-1 preview)
    }
    // Scenario distinctness survives the engine bridge (ADR-0098 invariant).
    const seeds = new Set(p50Notes.map((n) => n.note.match(/seed=(\d+)/)?.[1]));
    expect(seeds.size).toBe(3);
  });

  test("(a2) Phase 2 persistence: inputs_json snapshot and BEP columns land on the model/p50 row", async () => {
    const model = db
      .query("SELECT id, inputs_json FROM business_case_model WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(engineProjectId) as { id: string; inputs_json: string | null };
    expect(model.inputs_json).toBeTruthy();
    const spec = JSON.parse(model.inputs_json!) as {
      job_id: string;
      discount_rate: { subject: string };
      cases: Array<{ case_id: string; drivers: Record<string, { dist: string; source?: string }> }>;
    };
    expect(spec.job_id).toMatch(/^s8:/);
    expect(spec.discount_rate.subject).toBe("promoter");
    const drivers = spec.cases[0].drivers;
    expect(drivers.revenue_y1.dist).toBe("constant");
    expect(drivers.ramp_up.dist).toBe("constant"); // sales-plan ramp rides in the job-spec (REQ-W1-2)
    expect(Array.isArray((drivers.ramp_up as { value: number[] }).value)).toBe(true);

    const p50 = db
      .query("SELECT bep_year, bep_volume, payback_discounted_years FROM valuation_simulation WHERE model_id = ? AND percentile = 'p50' LIMIT 1")
      .get(model.id) as { bep_year: number | null; bep_volume: number | null; payback_discounted_years: number | null };
    expect(p50.bep_year).not.toBeNull(); // REQ-W3-2: BEP year persisted on the p50 row
    expect(p50.payback_discounted_years).toBe(p50.bep_year);
    expect(p50.bep_volume).toBeNull(); // the S8 model has no unit-economics split yet

    // S8 completion now requires the BEP + snapshot artifacts (spec 2026-09-18 update).
    const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
    const state = evaluateProcess({ type: "project", id: engineProjectId });
    expect(state.completedStages).toContain("S8");
  });

  test("(a3) params roundtrip: saved bc.* assumptions resolve as user and reach the next generation", async () => {
    const projectId3 = await seedProject("파라미터 라운드트립");
    paramsProjectId = projectId3;
    const post = await req(`/api/projects/${projectId3}/business-case/params`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ params: { capture_rate: 0.01, ramp_up: [0.5, 0.8, 1.0] }, rationale: "시장 재조사 기반 시장점유율 상향 — 테스트 근거" }),
    });
    expect(post.status).toBe(201);
    const posted = (await post.json()).data as { written: string[] };
    expect(posted.written).toContain("bc.capture_rate");
    expect(posted.written).toContain("bc.ramp_up.y1");

    const get = await req(`/api/projects/${projectId3}/business-case/params`, { method: "GET", headers: { cookie: analystCookie } });
    expect(get.status).toBe(200);
    const resolved = (await get.json()).data.params as { captureRate: number; captureSource: string; rampUp: number[]; rampSource: string };
    expect(resolved.captureRate).toBe(0.01);
    expect(resolved.captureSource).toContain("bc.capture_rate");
    expect(resolved.rampUp[0]).toBe(0.5);
    expect(resolved.rampSource).toContain("bc.ramp_up");

    // Rationale is mandatory.
    const noRationale = await req(`/api/projects/${projectId3}/business-case/params`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ params: { opex_ratio: 0.55 } }),
    });
    expect(noRationale.status).toBe(400);

    await generate(projectId3);
    const notes = simulationNotes(projectId3);
    expect(notes.length).toBeGreaterThanOrEqual(9);
    for (const row of notes) {
      expect(row.note).toContain("capture_rate=0.01");
      expect(row.note).toContain("ramp_source=사용자 확정");
    }
  });

  test("(a4) manual sales-plan lines: volume+price persist through the line editor; half-specified is rejected (REQ-W1-1)", async () => {
    const create = await req(`/api/projects/${paramsProjectId}/business-case`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        name: "판매목표 수동 케이스",
        kind: "revenue",
        lines: [{ category: "revenue", name: "연간 판매", annual_amount_krw_m: 24000, sales_volume: 200000, unit_price_krw: 120 }],
      }),
    });
    expect(create.status).toBe(201);
    const modelId = ((await create.json()).data as { id: string }).id;

    const get = await req(`/api/projects/${paramsProjectId}/business-case`, { method: "GET", headers: { cookie: analystCookie } });
    const manual = ((await get.json()).data.cases as Array<{ id: string; lines: Array<{ sales_volume: number | null; unit_price_krw: number | null }> }>).find((c) => c.id === modelId);
    expect(manual?.lines[0].sales_volume).toBe(200000);
    expect(manual?.lines[0].unit_price_krw).toBe(120);

    const half = await req(`/api/projects/${paramsProjectId}/business-case`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        model_id: modelId,
        lines: [{ category: "revenue", name: "연간 판매", annual_amount_krw_m: 24000, sales_volume: 200000 }],
      }),
    });
    expect(half.status).toBe(400);
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
      // The fallback satisfies the Phase 2 completion artifacts too — the TS
      // path computes the same deterministic-path BEP and stores the same
      // job-spec snapshot.
      const p50 = db
        .query(
          `SELECT vs.bep_year, m.inputs_json FROM valuation_simulation vs
           JOIN business_case_model m ON m.id = vs.model_id
           WHERE m.project_id = ? AND vs.percentile = 'p50' LIMIT 1`,
        )
        .get(fallbackProjectId) as { bep_year: number | null; inputs_json: string | null };
      expect(p50.bep_year).not.toBeNull();
      expect(p50.inputs_json).toBeTruthy();
    } finally {
      delete process.env.CO_NEWBIZ_SIM_ENGINE;
    }
  });
});
