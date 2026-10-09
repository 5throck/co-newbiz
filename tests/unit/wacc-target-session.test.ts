// @version 1.0.0
/** ADR-0156 — per-target WACC sessions, isolation, and grandfathering. */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wacc-target-session.sqlite";
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
const { recordWaccSession, resolveProjectWacc, listProjectAnalysisTargets } = await import("../../db/lib/wacc.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

const NOW = "2026-10-09T00:00:00.000Z";
const USER = "target-analyst";
let analystCookie = "";
let projectId = "";
let oppId = "";
let targetAId = "";
let targetBId = "";
let companyAId = "";
let companyBId = "";

function req(path: string, init?: RequestInit) { return nextRequest(path, init); }
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: USER, role: "analyst", password: "pw-target-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(USER, "pw-target-12345");

  // Brownfield project with two shortlisted targets, each with a resolved
  // md_company (dart_corp_code link, the ADR-0143 rule).
  oppId = crypto.randomUUID();
  db.run(
    `INSERT INTO opportunity (id, name, status, created_at, created_by) VALUES (?, 'target-wacc-test', 'assessed', ?, 'test')`,
    [oppId, NOW],
  );
  companyAId = crypto.randomUUID();
  companyBId = crypto.randomUUID();
  db.run(
    `INSERT INTO md_company (id, dart_corp_code, name_ko, created_at) VALUES (?, '000TESTA', '대상에이', ?), (?, '000TESTB', '대상비', ?)`,
    [companyAId, NOW, companyBId, NOW],
  );
  targetAId = crypto.randomUUID();
  targetBId = crypto.randomUUID();
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, status, rank, created_at, updated_at)
     VALUES (?, ?, '대상에이', '000TESTA', 'shortlisted', 1, ?, ?), (?, ?, '대상비', '000TESTB', 'shortlisted', 2, ?, ?)`,
    [targetAId, oppId, NOW, NOW, targetBId, oppId, NOW, NOW],
  );
  projectId = createProject("NP-TARGET-WACC-1").id;
  db.run("UPDATE md_project SET source_opportunity_id = ? WHERE id = ?", [oppId, projectId]);
  grantProjectMembership(db, { projectId, userId: USER, projectRole: "lead", grantedBy: USER, needToKnowBasis: "per-target wacc test", now: NOW });
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("ADR-0156 per-target WACC sessions", () => {
  test("grandfathering: a project-level session keeps resolving at project level", () => {
    recordWaccSession(db, { projectId, wacc: 0.0875, mode: "direct", actor: USER, now: NOW });
    expect(resolveProjectWacc(db, projectId)).toMatchObject({ value: 0.0875, source: "user" });
  });

  test("per-target sessions are isolated from the gate figure and from each other", () => {
    recordWaccSession(db, { projectId, wacc: 0.121, mode: "capm", subjectCompanyId: companyAId, actor: USER, now: NOW });
    recordWaccSession(db, { projectId, wacc: 0.139, mode: "capm", subjectCompanyId: companyBId, actor: USER, now: NOW });

    // Project-level (gate figure) unchanged by per-target writes.
    expect(resolveProjectWacc(db, projectId)).toMatchObject({ value: 0.0875 });
    // Each target sees only its own latest session.
    expect(resolveProjectWacc(db, projectId, { subjectCompanyId: companyAId })).toMatchObject({ value: 0.121 });
    expect(resolveProjectWacc(db, projectId, { subjectCompanyId: companyBId })).toMatchObject({ value: 0.139 });
    // A target with no session falls back to the modeling default.
    expect(resolveProjectWacc(db, projectId, { subjectCompanyId: "no-such-company" })).toMatchObject({ value: 0.1, source: "default" });

    // run.subject_company_id actually stamped.
    const stamped = db.query("SELECT subject_company_id FROM run WHERE project_id = ? ORDER BY rowid DESC").all(projectId) as Array<{ subject_company_id: string | null }>;
    expect(stamped[0]?.subject_company_id).toBe(companyBId);
    expect(stamped.some((r) => r.subject_company_id === null)).toBe(true);
  });

  test("listProjectAnalysisTargets resolves both companies and marks the bound one", () => {
    const targets = listProjectAnalysisTargets(db, projectId);
    expect(targets.map((t) => t.name)).toEqual(["대상에이", "대상비"]);
    expect(targets.map((t) => t.companyId)).toEqual([companyAId, companyBId]);
    // Nothing bound yet — bind A and it becomes the gate figure carrier.
    expect(targets.every((t) => !t.isBound)).toBe(true);
    db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [companyAId, projectId]);
    expect(listProjectAnalysisTargets(db, projectId)[0]?.isBound).toBe(true);
  });

  test("POST with a per-target target_id records a scoped session; project POST never touches it", async () => {
    const res = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ wacc: 0.128, mode: "direct", target_id: targetBId }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()).data as { wacc: { value: number } };
    expect(body.wacc.value).toBe(0.128);
    expect(resolveProjectWacc(db, projectId, { subjectCompanyId: companyBId })).toMatchObject({ value: 0.128 });
    // Gate figure still the earlier project-level session.
    expect(resolveProjectWacc(db, projectId)).toMatchObject({ value: 0.0875 });
  });

  test("a non-shortlisted target_id is rejected", async () => {
    const res = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ wacc: 0.1, mode: "direct", target_id: "not-a-target" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET with target_id returns that target's session, not the gate figure", async () => {
    const get = await req(`/api/projects/${projectId}/wacc?target_id=${targetBId}`, { headers: { cookie: analystCookie } });
    expect(get.status).toBe(200);
    const body = (await get.json()).data as { wacc: { value: number } };
    expect(body.wacc.value).toBe(0.128);
  });
  test("GET /targets lists the shortlist and flags a real choice", async () => {
    const res = await req(`/api/projects/${projectId}/targets`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()).data as { targets: Array<{ name: string; companyId: string | null }>; selectable: boolean };
    expect(body.targets.map((t) => t.name)).toEqual(["대상에이", "대상비"]);
    expect(body.selectable).toBe(true);
  });

  test("suggestions and financial-analysis scope to target_id and reject a non-shortlisted id", async () => {
    for (const path of ["wacc/suggestions", "financial-analysis"]) {
      const bad = await req(`/api/projects/${projectId}/${path}?target_id=not-a-target`, { headers: { cookie: analystCookie } });
      expect(bad.status).toBe(400);
    }
    const sug = await req(`/api/projects/${projectId}/wacc/suggestions?target_id=${targetAId}`, { headers: { cookie: analystCookie } });
    expect(sug.status).toBe(200);
    const fin = await req(`/api/projects/${projectId}/financial-analysis?target_id=${targetBId}`, { headers: { cookie: analystCookie } });
    expect(fin.status).toBe(200);
    const finBody = (await fin.json()).data as { company: { id: string } | null; target: { target_id: string } | null };
    expect(finBody.company?.id).toBe(companyBId);
    expect(finBody.target?.target_id).toBe(targetBId);
  });
});
