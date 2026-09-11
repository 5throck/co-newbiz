// @version 1.0.0
/** Wave C1 — project WACC input session regression. */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wacc-session.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { grantProjectMembership } = await import("../../db/lib/access-control.ts");
const { createProject } = await import("../../db/repositories/project.repository.ts");
const { recordWaccSession, resolveProjectWacc } = await import("../../db/lib/wacc.ts");
const { assembleDerivation } = await import("../../db/lib/wacc-components.ts");
const { runSimulationForRun } = await import("../../db/lib/simulation.ts");
const { caseInputsForProject, runSeededSimulation } = await import("../../app/web-next/lib/business-case-generator.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

const NOW = "2026-09-09T00:00:00.000Z";
const USER = "wacc-analyst";
const VIEWER = "wacc-viewer";
let projectId = "";
let analystCookie = "";
let viewerCookie = "";

function req(path: string, init?: RequestInit) { return nextRequest(path, init); }
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: USER, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(USER, "pw-analyst-12345");
  viewerCookie = await loginCookie(VIEWER, "pw-viewer-12345");
  projectId = createProject("NP-WACC-1").id;
  grantProjectMembership(db, { projectId, userId: USER, projectRole: "lead", grantedBy: USER, needToKnowBasis: "wacc test", now: NOW });
  grantProjectMembership(db, { projectId, userId: VIEWER, projectRole: "observer", grantedBy: USER, needToKnowBasis: "wacc test", now: NOW });
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("Wave C1 WACC session", () => {
  test("default WACC is explicit provenance, then user session records run_input + kind=user assumptions", async () => {
    expect(resolveProjectWacc(db, projectId)).toMatchObject({ value: 0.1, source: "default", run_id: null });

    const res = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ wacc: 0.0875, hurdle_irr: 0.14, mode: "direct", rationale: "Treasury confirmed", as_of: "2026-09-09" }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()).data as { run_id: string; wacc: { value: number; source: string; run_id: string }; hurdle_irr: { value: number } };
    expect(data.wacc).toMatchObject({ value: 0.0875, source: "user", run_id: data.run_id });
    expect(data.hurdle_irr.value).toBe(0.14);

    expect(db.query("SELECT value FROM run_input WHERE run_id = ? AND assumption_key = 'wacc'").get(data.run_id)).toMatchObject({ value: 0.0875 });
    expect(db.query("SELECT kind, value FROM assumption WHERE run_id = ? AND assumption_key = 'wacc'").get(data.run_id)).toMatchObject({ kind: "user", value: 0.0875 });

    const get = await req(`/api/projects/${projectId}/wacc`, { headers: { cookie: analystCookie } });
    expect(get.status).toBe(200);
    expect(((await get.json()).data as { wacc: { source: string; value: number } }).wacc).toMatchObject({ source: "user", value: 0.0875 });
  });

  test("viewer cannot record WACC, and deterministic business cases use confirmed WACC", async () => {
    const denied = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ wacc: 0.09 }),
    });
    expect(denied.status).toBe(403);

    const inputs = caseInputsForProject(projectId);
    expect(inputs.wacc).toMatchObject({ value: 0.0875, source: "user" });
    const withUserWacc = runSeededSimulation(inputs, "base");
    const withDefault = runSeededSimulation({ ...inputs, wacc: { ...inputs.wacc, value: 0.1, source: "default" } }, "base");
    expect(withUserWacc.p50).toBeGreaterThan(withDefault.p50);
  });

  test("Monte Carlo run resolves user WACC before legacy sim.discount_rate", async () => {
    const { run_id } = recordWaccSession(db, { projectId, wacc: 0.075, actor: USER, now: "2026-09-09T01:00:00.000Z", asOf: "2026-09-09" });
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [run_id, "sim.discount_rate", 0.22]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [run_id, "sim.cf1", 100]);
    db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [run_id, "sim.cf2", 100]);
    const sim = await runSimulationForRun(db, { runId: run_id, iterations: 3, seed: 123 });
    expect(sim.discount_rate).toBe(0.075);
  });
});

describe("ADR-0115 CAPM component session", () => {
  const COMPONENTS = [
    { key: "wacc.risk_free", value: 0.0335, kind: "live", source_label: "한국은행 ECOS — 국고채(3년)", anchor_ref: "https://ecos.bok.or.kr", as_of: "2026-09-10" },
    { key: "wacc.erp", value: 0.063, kind: "live", source_label: "Damodaran — 한국 프리미엄", as_of: "2026-01" },
    { key: "wacc.size_premium", value: 0.015, kind: "user", source_label: "사내 IB 가이드라인" },
    { key: "wacc.beta_levered", value: 1.35, kind: "derived", rationale: "시계열 회귀 · R² 0.68 · 250일" },
    { key: "wacc.beta_r2", value: 0.68, kind: "derived", rationale: "회귀 스탯" },
    { key: "wacc.beta_vol_asset", value: 0.284, kind: "derived", rationale: "연율화 변동성 (자산)" },
    { key: "wacc.beta_vol_market", value: 0.172, kind: "derived", rationale: "연율화 변동성 (시장)" },
    { key: "wacc.observed_de", value: 0.9, kind: "live", source_label: "DART 최근 결산" },
    { key: "wacc.debt_spread", value: 0.021, kind: "live", source_label: "한국신용평가 BBB+ 가산금리" },
    { key: "wacc.target_de", value: 0.6, kind: "user", source_label: "재무계획" },
    { key: "wacc.tax_rate", value: 0.22, kind: "user", source_label: "법인세법 표준세율" },
  ];

  test("capm session persists wacc.* rows, returns the server-computed WACC, and GET re-derives the build-up", async () => {
    const expected = assembleDerivation(COMPONENTS).computed.wacc!;
    const res = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        wacc: expected,
        hurdle_irr: 0.14,
        mode: "capm",
        rationale: "CAPM 분해 확정",
        components: COMPONENTS,
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()).data as { run_id: string; wacc_computed: number; computed_mismatch: boolean };
    expect(data.computed_mismatch).toBe(false);
    expect(data.wacc_computed).toBeCloseTo(expected, 12);

    // component rows persisted on the SAME run as the confirmed scalar —
    // including kind and citation the kill-criteria contract can audit
    const rfRow = db
      .query("SELECT kind, value, rationale, anchor_ref FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.risk_free'")
      .get(data.run_id) as { kind: string; value: number; rationale: string; anchor_ref: string };
    expect(rfRow).toMatchObject({ kind: "live", value: 0.0335, anchor_ref: "https://ecos.bok.or.kr" });
    expect(rfRow.rationale).toContain("한국은행 ECOS");
    // the exact-key contract is untouched: kill criteria still read kind='user' wacc/hurdle_irr
    expect(db.query("SELECT kind FROM assumption WHERE run_id = ? AND assumption_key = 'wacc'").get(data.run_id)).toMatchObject({ kind: "user" });
    expect(db.query("SELECT value FROM run_input WHERE run_id = ? AND assumption_key = 'hurdle_irr'").get(data.run_id)).toMatchObject({ value: 0.14 });

    const get = await req(`/api/projects/${projectId}/wacc`, { headers: { cookie: analystCookie } });
    const view = ((await get.json()).data as {
      components: { key: string }[];
      derivation: { computed: { wacc: number }; steps: { item: string }[]; betaPath: string };
    });
    expect(view.components.length).toBe(COMPONENTS.length);
    expect(view.derivation.betaPath).toBe("regression_relevered");
    expect(view.derivation.computed.wacc).toBeCloseTo(expected, 12);
    expect(view.derivation.steps.map((s) => s.item)).toContain("WACC");
  });

  test("confirmed value diverging from the CAPM math is recorded but flagged", async () => {
    const res = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        wacc: 0.15,
        mode: "capm",
        rationale: "IC 지침상 상한 할인율 적용",
        components: COMPONENTS,
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()).data as { wacc_computed: number; computed_mismatch: boolean };
    expect(data.computed_mismatch).toBe(true);
    expect(data.wacc_computed).toBeLessThan(0.15);
  });

  test("components require mode=capm, a derivable set, valid kinds, and evidence-ref anchors", async () => {
    const base = { wacc: 0.1, mode: "direct" as const };
    const noMode = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ ...base, components: COMPONENTS }),
    });
    expect(noMode.status).toBe(400);

    const missing = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        wacc: 0.1,
        mode: "capm",
        components: COMPONENTS.filter((c) => c.key !== "wacc.erp"),
      }),
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error?: { message?: string } }).error?.message).toContain("wacc.erp");

    const assumed = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        wacc: 0.1,
        mode: "capm",
        components: [...COMPONENTS, { key: "wacc.erp", value: 0.06, kind: "assumed" }],
      }),
    });
    expect(assumed.status).toBe(400);

    const badRef = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        wacc: 0.1,
        mode: "capm",
        components: [{ ...COMPONENTS[0], anchor_ref: "cim.pdf#p12" }],
      }),
    });
    expect(badRef.status).toBe(400);

    const viewerDenied = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ wacc: 0.1, mode: "capm", components: COMPONENTS }),
    });
    expect(viewerDenied.status).toBe(403);
  });

  test("a later direct-mode session does not hide the component layer", async () => {
    // No fixed `now`: the HTTP capm tests above record at real time, and a
    // fixed timestamp that has slipped into the past would flip the
    // latest-assumption ordering this test depends on.
    recordWaccSession(db, {
      projectId,
      wacc: 0.08,
      actor: USER,
      asOf: "2026-09-11",
    });
    const { loadProjectComponents } = await import("../../db/lib/wacc.ts");
    const { components } = loadProjectComponents(db, projectId);
    expect(components.length).toBe(COMPONENTS.length);
    const get = await req(`/api/projects/${projectId}/wacc`, { headers: { cookie: analystCookie } });
    const view = (await get.json()).data as { wacc: { value: number; source: string }; derivation: { computed: { wacc: number } } };
    expect(view.wacc).toMatchObject({ value: 0.08, source: "user" });
    expect(view.derivation).not.toBeNull();
  });
});
