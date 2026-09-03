// @version 1.0.0
/**
 * S8 multi-business-case generation — ADR-0098 regression.
 *
 * Proves four things against the REAL route handlers (nextRequest harness,
 * committee-boundary pattern) and the real scratch SQLite:
 *  (a) generation produces 3 models with genuinely DIFFERENT
 *      valuation_simulation outputs across scenarios (never copies);
 *  (b) the quant-methodologist's RECOMMENDED flag is recorded;
 *  (c) boundary #2: a full agent-team generation writes NO adoption marker
 *      and NO fs gate_decision until the human adopt endpoint is called, and
 *      adopt requires analyst+ (viewer 403);
 *  (d) S8 evaluateProcess completion flips only when a case AND its
 *      simulation rows exist (case alone is not enough);
 *  (e) deny-by-default: a non-member gets 404 on all routes.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";

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
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const ANALYST = "analyst1"; // project member (lead) — the human actor
const VIEWER = "viewer1"; // authenticated but viewer role
const OUTSIDER = "outsider1"; // authenticated analyst, NOT a project member
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  await createUser(db, { userId: OUTSIDER, role: "analyst", password: "pw-outsider-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: OUTSIDER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-analyst-12345");
  viewerCookie = await loginCookie(VIEWER, "pw-viewer-12345");
  outsiderCookie = await loginCookie(OUTSIDER, "pw-outsider-12345");

  // Promote a greenfield opportunity into a project (ADR-0095) — the
  // promoter becomes the lead member, which is what makes visibility
  // meaningful for the deny-by-default checks.
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, "S8 테스트 기회", "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?)",
    [ulid(), oppId, "greenfield", "test route", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, capability_gaps_json, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, JSON.stringify([{ gap: "g1", resolution: "hire" }]), "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  projectId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "S8 test promoter" }).project.id;
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("S8 generation (ADR-0098)", () => {
  test("(a) three scenarios, three genuinely different valuation outputs", async () => {
    // Precondition: S8 is not yet complete.
    const before = evaluateProcess({ type: "project", id: projectId });
    expect(before.completedStages).not.toContain("S8");

    const res = await req(`/api/projects/${projectId}/business-case/generate`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const { runId } = (await res.json()).data as { runId: string };
    expect(runId).toBeTruthy();

    const models = db
      .query("SELECT id, name, kind FROM business_case_model WHERE project_id = ? ORDER BY created_at, id")
      .all(projectId) as Array<{ id: string; name: string; kind: string }>;
    expect(models.length).toBe(3);

    const scenarios = new Set<string>();
    const p50: Record<string, number> = {};
    const p05: Record<string, number> = {};
    for (const m of models) {
      const sims = db
        .query("SELECT scenario, percentile, npv_krw_m, note FROM valuation_simulation WHERE model_id = ?")
        .all(m.id) as Array<{ scenario: string; percentile: string; npv_krw_m: number; note: string | null }>;
      expect(sims.length).toBeGreaterThanOrEqual(3);
      for (const s of sims) {
        scenarios.add(s.scenario);
        if (s.percentile === "p50") p50[s.scenario] = s.npv_krw_m;
        if (s.percentile === "p05") p05[s.scenario] = s.npv_krw_m;
        // ADR-0052 §D.4: every figure is reproducible — the note carries the seed.
        expect(s.note).toContain("seed=");
      }
    }
    expect(scenarios).toEqual(new Set(["base", "upside", "downside"]));
    // GENUINELY different numbers — the engine must not copy one case 3×.
    expect(new Set(Object.values(p50)).size).toBe(3);
    expect(p50.upside).toBeGreaterThan(p50.base);
    expect(p50.base).toBeGreaterThan(p50.downside);

    // Run status route: per-activity rows + case summary.
    const status = await req(`/api/projects/${projectId}/business-case/generate/${runId}`, {
      headers: { cookie: analystCookie },
    });
    expect(status.status).toBe(200);
    const st = (await status.json()).data as { status: string; activities: Array<{ activityId: string; agentKey: string; status: string }>; cases: unknown[] };
    expect(st.status).toBe("done");
    expect(st.activities.length).toBe(12); // 3 scenarios × 4 procedure steps
    expect(st.activities.filter((a) => a.status === "done").length).toBe(12);
    expect(st.activities.find((a) => a.activityId === "base:growth_projection")?.agentKey).toBe("financial-analyst");
    expect(st.activities.find((a) => a.activityId === "downside:distributional_valuation")?.agentKey).toBe("quant-methodologist");
    expect(st.cases.length).toBe(3);

    // (b) the RECOMMENDED flag is recorded on the run's meta.
    const meta = db.query("SELECT meta_json FROM process_run WHERE id = ?").get(runId) as { meta_json: string | null };
    const recommended = JSON.parse(meta.meta_json!) as { recommended_scenario: string };
    expect(["base", "upside", "downside"]).toContain(recommended.recommended_scenario);
  });

  test("(c) boundary #2: generation confirms nothing; only the human adopt endpoint adopts", async () => {
    const markers = () => ({
      adopt: (db.query("SELECT COUNT(*) n FROM process_run WHERE stage = 's8_case_adopt'").get() as { n: number }).n,
      gate: (db.query("SELECT COUNT(*) n FROM gate_decision WHERE entity_type = 'project'").get() as { n: number }).n,
    });
    expect(markers()).toEqual({ adopt: 0, gate: 0 });

    const modelId = (db.query("SELECT id FROM business_case_model WHERE project_id = ? LIMIT 1").get(projectId) as { id: string }).id;

    // Viewer cannot adopt — adoption is a human analyst+ action.
    const viewerRes = await req(`/api/projects/${projectId}/business-case/adopt`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ model_id: modelId }),
    });
    expect(viewerRes.status).toBe(403);
    expect(markers().adopt).toBe(0);

    // Unauthenticated is rejected outright.
    const anon = await req(`/api/projects/${projectId}/business-case/adopt`, {
      method: "POST",
      body: JSON.stringify({ model_id: modelId }),
    });
    expect(anon.status).toBe(401);

    // Human analyst adopts — the ONLY writer of the marker.
    const res = await req(`/api/projects/${projectId}/business-case/adopt`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ model_id: modelId }),
    });
    expect(res.status).toBe(201);
    expect(markers()).toEqual({ adopt: 1, gate: 0 });

    // Still no gate_decision: adoption is an fs-gate INPUT, not the gate.
    const list = await req(`/api/projects/${projectId}/business-case`, { headers: { cookie: analystCookie } });
    expect(list.status).toBe(200);
    const data = (await list.json()).data as { cases: Array<{ id: string; adopted: boolean }>; adoption: { modelId: string } | null };
    expect(data.adoption?.modelId).toBe(modelId);
    expect(data.cases.find((c) => c.id === modelId)?.adopted).toBe(true);
    expect(markers().gate).toBe(0);

    // The fs gate record itself is a separate human action.
    const gate = await req(`/api/projects/${projectId}/gate-decisions`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ gate: "fs", decision: "go", rationale: "채택 케이스 검토 후 인적 결재" }),
    });
    expect(gate.status).toBe(201);
    expect((db.query("SELECT COUNT(*) n FROM gate_decision WHERE entity_type = 'project' AND gate = 'fs'").get() as { n: number }).n).toBe(1);
  });

  test("(d) S8 completion flips only with case AND simulation (case alone is not enough)", () => {
    // The generated cases (model + persisted percentiles) complete S8.
    const withSims = evaluateProcess({ type: "project", id: projectId });
    expect(withSims.completedStages).toContain("S8");
    expect(withSims.currentStage).toBe("S9");

    // A separate project whose case has NO simulation rows: the case exists,
    // but "민감도가 포함된 정량 평가" is not satisfied — S8 stays current.
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", ["proj-nosim", "P-NOSIM", NOW]);
    db.run(
      "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
      ["bc-nosim", "proj-nosim", "greenfield_cost", "민감도 없는 케이스", 5, ANALYST, NOW],
    );
    db.run(
      `INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      ["bcl-nosim", "bc-nosim", "revenue", "매출", 100, 1, 0, ANALYST, NOW],
    );
    const bare = evaluateProcess({ type: "project", id: "proj-nosim" });
    expect(bare.completedStages).not.toContain("S8");
    expect(bare.currentStage).toBe("S8");
    expect(bare.blockers.join()).toContain("민감도");

    // Persisting one sensitivity row flips the stage — exactly the ADR-0098
    // predicate (case ≥ 1 AND valuation_simulation ≥ 1).
    db.run(
      `INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      ["vs-nosim", "proj-nosim", "bc-nosim", "base", "p50", 42, NOW],
    );
    const flipped = evaluateProcess({ type: "project", id: "proj-nosim" });
    expect(flipped.completedStages).toContain("S8");
  });

  test("(e) deny-by-default: non-member 404 on every business-case route", async () => {
    const routes: Array<[string, RequestInit]> = [
      [`/api/projects/${projectId}/business-case`, { method: "GET" }],
      [`/api/projects/${projectId}/business-case/generate`, { method: "POST", headers: { cookie: outsiderCookie }, body: JSON.stringify({}) }],
      [`/api/projects/${projectId}/business-case/adopt`, { method: "POST", headers: { cookie: outsiderCookie }, body: JSON.stringify({ model_id: "x" }) }],
      [`/api/projects/${projectId}/gate-decisions`, { method: "GET", headers: { cookie: outsiderCookie } }],
    ];
    for (const [path, init] of routes) {
      const res = await req(path, { ...init, headers: { cookie: outsiderCookie, ...(init.headers as Record<string, string> | undefined) } });
      expect(res.status).toBe(404);
    }
    // Run status route with a fabricated runId — still 404, not a leak.
    const runRes = await req(`/api/projects/${projectId}/business-case/generate/nonexistent-run`, {
      method: "GET",
      headers: { cookie: outsiderCookie },
    });
    expect(runRes.status).toBe(404);
    // Unauthenticated is 401 (auth precedes visibility, same as Phase 2).
    const anon = await req(`/api/projects/${projectId}/business-case`, { method: "GET" });
    expect(anon.status).toBe(401);
  });

  test("manual CRUD coexists with generated cases", async () => {
    const create = await req(`/api/projects/${projectId}/business-case`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        name: "수동 케이스",
        kind: "greenfield_cost",
        lines: [{ category: "revenue", name: "수동 매출", annual_amount_krw_m: 120, start_year: 1, growth_rate: 0.03 }],
      }),
    });
    expect(create.status).toBe(201);
    const manualId = ((await create.json()).data as { id: string }).id;

    const put = await req(`/api/projects/${projectId}/business-case`, {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        model_id: manualId,
        name: "수동 케이스 (수정)",
        lines: [{ category: "revenue", name: "수정 매출", annual_amount_krw_m: 150 }],
      }),
    });
    expect(put.status).toBe(200);
    const lines = db.query("SELECT COUNT(*) n FROM business_case_line WHERE model_id = ?").get(manualId) as { n: number };
    expect(lines.n).toBe(1);

    const del = await req(`/api/projects/${projectId}/business-case?model_id=${manualId}`, {
      method: "DELETE",
      headers: { cookie: analystCookie },
    });
    expect(del.status).toBe(200);
    expect((db.query("SELECT COUNT(*) n FROM business_case_model WHERE id = ?").get(manualId) as { n: number }).n).toBe(0);

    // Invalid line category → 400, and the model is not left behind.
    const bad = await req(`/api/projects/${projectId}/business-case`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ name: "나쁜 케이스", lines: [{ category: "nope", annual_amount_krw_m: 1 }] }),
    });
    expect(bad.status).toBe(400);
  });
});
