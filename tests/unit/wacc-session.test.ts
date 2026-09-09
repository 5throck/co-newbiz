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
