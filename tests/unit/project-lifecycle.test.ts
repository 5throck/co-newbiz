import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-project-lifecycle.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { closeProject } = await import("../../db/repositories/project.repository.ts");
const { listProjectPipeline } = await import("../../app/web-next/lib/gate-aging.ts");
const { getPortfolioRollup } = await import("../../db/repositories/venture-scorecard.repository.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-09-09T00:00:00Z";
let projectId = "";
let leadCookie = "";
let contributorCookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: "lead-close", role: "analyst", password: "pw-lead-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "lead-close", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "contrib-close", role: "analyst", password: "pw-contrib-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "contrib-close", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  leadCookie = await loginCookie("lead-close", "pw-lead-12345");
  contributorCookie = await loginCookie("contrib-close", "pw-contrib-12345");

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, project_name) VALUES (?,?,?,?)", [projectId, "PRJ-LIFE", NOW, "Lifecycle test"]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, "lead-close", "lead", "test", NOW, "test"]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, "contrib-close", "member", "test", NOW, "test"]);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("project lifecycle closure (Wave B1)", () => {
  test("migration adds open default status", () => {
    const row = db.query("SELECT status, closed_at, closure_reason FROM md_project WHERE id = ?").get(projectId) as { status: string; closed_at: string | null; closure_reason: string | null };
    expect(row.status).toBe("open");
    expect(row.closed_at).toBeNull();
    expect(row.closure_reason).toBeNull();
  });

  test("PATCH close is lead-only", async () => {
    const res = await nextRequest(`/api/projects/${projectId}/close`, { headers: { cookie: contributorCookie }, method: "PATCH", body: JSON.stringify({ closure_reason: "not the lead" }) });
    expect(res.status).toBe(403);
  });

  test("Wave B2 child read APIs are reachable for an open visible project", async () => {
    for (const suffix of ["financial-analysis", "proxy-chain", "reports"]) {
      const res = await nextRequest(`/api/projects/${projectId}/${suffix}`, { headers: { cookie: leadCookie } });
      expect(res.status).toBe(200);
    }
  });

  test("closeProject records lifecycle state and hides project from default list", async () => {
    const res = await nextRequest(`/api/projects/${projectId}/close`, { headers: { cookie: leadCookie }, method: "PATCH", body: JSON.stringify({ closure_reason: "Completed closeout package" }) });
    expect(res.status).toBe(200);
    const row = db.query("SELECT status, closed_at, closure_reason FROM md_project WHERE id = ?").get(projectId) as { status: string; closed_at: string | null; closure_reason: string | null };
    expect(row.status).toBe("closed");
    expect(row.closed_at).toBeTruthy();
    expect(row.closure_reason).toBe("Completed closeout package");

    const list = await nextRequest("/api/projects", { headers: { cookie: leadCookie } });
    const body = await list.json() as { data: Array<{ id: string }> };
    expect(body.data.some((p) => p.id === projectId)).toBe(false);
  });

  test("closed projects are excluded from pipeline and portfolio aggregates", () => {
    const openId = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [openId, "PRJ-OPEN", NOW]);
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, projectId, "closed scorecard", "h", "test", NOW]);
    db.run("INSERT INTO venture_scorecard (id, run_id, project_id, source_procedure, review_cycle, venture_class, section, measure_key, target_value, actual_value, status, evidence_ref, observed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [ulid(), runId, projectId, "portfolio-venture-monitoring", "2026-Q3", "driving", "financial", "npv", "1", "1", "on_target", "EV-20260909-01", NOW, NOW]);

    expect(listProjectPipeline(db).some((p) => p.projectId === projectId)).toBe(false);
    const rollup = getPortfolioRollup({ reviewCycle: "2026-Q3" }, db);
    expect(rollup.financial.some((r) => r.project_id === projectId)).toBe(false);
  });

  test("project list exposes is_lead so the UI can gate the close/archive action", async () => {
    const flagId = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at, project_name) VALUES (?,?,?,?)", [flagId, "PRJ-LEAD-FLAG", NOW, "Lead flag test"]);
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [flagId, "lead-close", "lead", "test", NOW, "test"]);
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [flagId, "contrib-close", "member", "test", NOW, "test"]);

    const asLead = await nextRequest("/api/projects", { headers: { cookie: leadCookie } });
    expect(asLead.status).toBe(200);
    const leadBody = (await asLead.json()) as { data: Array<{ id: string; is_lead?: boolean }> };
    expect(leadBody.data.find((p) => p.id === flagId)?.is_lead).toBe(true);

    const asContrib = await nextRequest("/api/projects", { headers: { cookie: contributorCookie } });
    const contribBody = (await asContrib.json()) as { data: Array<{ id: string; is_lead?: boolean }> };
    expect(contribBody.data.find((p) => p.id === flagId)?.is_lead).toBe(false);
  });
});
