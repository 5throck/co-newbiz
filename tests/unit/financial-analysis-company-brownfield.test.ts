// @version 1.0.0
/**
 * Brownfield target binding goes only through S8 target selection.
 * Real route handler + scratch SQLite: the financial-analysis/company write
 * returns 409 brownfield_target_via_s8_selection for a brownfield project
 * (md_project.company_id untouched) and still binds for a greenfield one.
 * Static assertions pin the panel: the brownfield branch hides the free
 * link/change section and points at the S8 targets tab instead.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = "db/data/test-financial-analysis-company-brownfield.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
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
const { insertProject, addMember } = await import("./_gate-integrity-support.ts");

const NOW = new Date().toISOString();
const ANALYST = "fa-analyst";
let cookie = "";
let brownfieldId = "";
let greenfieldId = "";
let companyId = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
function link(projectId: string) {
  return nextRequest(`/api/projects/${projectId}/financial-analysis/company`, {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ company_id: companyId, rationale: "test rationale" }),
  });
}
const boundCompany = (projectId: string) =>
  (db.query("SELECT company_id FROM md_project WHERE id = ?").get(projectId) as { company_id: string | null })
    .company_id;

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-fa-analyst-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie(ANALYST, "pw-fa-analyst-1");

  companyId = ulid();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [companyId, "테스트회사", NOW]);

  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    oppId,
    "FA 기회",
    "테스트 산업",
    "selected",
    ANALYST,
    NOW,
  ]);
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, "brownfield", "m_and_a", "test route", ANALYST, NOW],
  );
  for (const gate of ["screening", "pre_fs", "target_screening"]) {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW],
    );
  }
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), oppId, "대상A", "shortlisted", 1, NOW, NOW],
  );
  brownfieldId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "FA test" }).project.id;

  greenfieldId = insertProject(db, null, "greenfield");
  addMember(db, greenfieldId, ANALYST, "lead");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("financial-analysis/company write — track gating", () => {
  test("brownfield → 409 brownfield_target_via_s8_selection, company_id untouched", async () => {
    expect(boundCompany(brownfieldId)).toBeNull();
    const res = await link(brownfieldId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { data: unknown; error: { code: string } };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("brownfield_target_via_s8_selection");
    expect(boundCompany(brownfieldId)).toBeNull();
    expect(db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'project_company_link'").get()).toEqual({
      n: 0,
    });
  });

  test("greenfield → binds the benchmark company", async () => {
    const res = await link(greenfieldId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { company_id: string; role: string } };
    expect(body.data.company_id).toBe(companyId);
    expect(body.data.role).toBe("candidate");
    expect(boundCompany(greenfieldId)).toBe(companyId);
  });
});

describe("FinancialAnalysisPanel — brownfield branch (static)", () => {
  const src = readFileSync(
    join(import.meta.dirname, "../../app/web-next/components/FinancialAnalysisPanel.tsx"),
    "utf-8",
  );

  test("link/change section is hidden for brownfield", () => {
    expect(src).toMatch(/const isBrownfield = view\?\.project\.track === "brownfield"/);
    expect(src).toMatch(/canAct && !selectedTarget && !isBrownfield/);
  });

  test("brownfield renders a notice linking to the S8 targets tab", () => {
    expect(src).toMatch(/isBrownfield && \(\s*<section[^>]*brownfield-target-via-s8-notice/);
    expect(src).toContain("business-case?tab=targets");
    expect(src).toContain('t("brownfieldTargetViaS8Selection")');
  });

  test("brownfield empty state no longer says to search below", () => {
    expect(src).toMatch(/canAct && isBrownfield \? \(\s*t\("noLinkedTargetCompanyViaS8"\)/);
  });
});
