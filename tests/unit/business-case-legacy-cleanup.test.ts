// @version 1.0.0
/**
 * ADR-0158 — legacy (pre-ADR-0143, target_id NULL) business-case cleanup.
 * Real route handlers + scratch SQLite. Proves: the notice count excludes
 * archived models; cleanup deletes unreferenced legacy models and ARCHIVES
 * referenced ones; the adopted model still resolves afterwards; per-target
 * models are untouched; agents and viewers are rejected.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case-legacy-cleanup.sqlite";
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
const { countLegacyUnassignedModels } = await import("../../app/web-next/lib/business-case-legacy.ts");
const { listBusinessCases, findAdoptedCase } = await import("../../app/web-next/lib/business-case.ts");
const { runAsPrincipal } = await import("../../app/web-next/lib/mcp/principal-context.ts");
const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const legacyRoute = await import("../../app/web-next/app/api/projects/[id]/business-case/legacy-cleanup/route.ts");

const NOW = new Date().toISOString();
const ANALYST = "lc-analyst";
const VIEWER = "lc-viewer";
let analystCookie = "";
let viewerCookie = "";
let projectId = "";
let targetId = "";
let adoptedLegacy = "";
let freeLegacy1 = "";
let freeLegacy2 = "";
let perTarget = "";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
function addModel(name: string, target: string | null): string {
  const id = ulid();
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, target_id) VALUES (?,?,?,?,?,?,?,?)",
    [id, projectId, "valuation", name, 5, ANALYST, NOW, target],
  );
  db.run("INSERT INTO valuation_simulation (id, model_id, project_id, scenario, percentile, npv_krw_m, created_at) VALUES (?,?,?,?,?,?,?)", [ulid(), id, projectId, "base", "p50", 100, NOW]);
  return id;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-lc-analyst-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-lc-viewer-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-lc-analyst-1");
  viewerCookie = await loginCookie(VIEWER, "pw-lc-viewer-12");

  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "LC 기회", "테스트 산업", "selected", ANALYST, NOW]);
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, "brownfield", "m_and_a", "test route", ANALYST, NOW],
  );
  for (const gate of ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW]);
  }
  targetId = ulid();
  db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [targetId, oppId, "대상A", "shortlisted", 1, NOW, NOW]);
  projectId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "LC test" }).project.id;

  adoptedLegacy = addModel("예전 채택 모델", null);
  freeLegacy1 = addModel("예전 모델 1", null);
  freeLegacy2 = addModel("예전 모델 2", null);
  perTarget = addModel("대상별 모델", targetId);
  // The human adoption of the legacy model (the s8_case_adopt record).
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ulid(), "project", projectId, projectId, "test", "s8_case_adopt", "done", "web", ANALYST, NOW, NOW, JSON.stringify({ model_id: adoptedLegacy })],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function cleanup(cookie: string, body: unknown = {}) {
  return req(`/api/projects/${projectId}/business-case/legacy-cleanup`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
}

describe("legacy count excludes archived", () => {
  test("pure probe", () => {
    expect(countLegacyUnassignedModels([{ target_id: null }, { target_id: null, archived_at: "2026-10-09" }], [{ targetId: "t" }])).toBe(1);
  });
});

describe("legacy cleanup (ADR-0158)", () => {
  test("GET lists legacy models with the referenced flag", async () => {
    const res = await req(`/api/projects/${projectId}/business-case`, { headers: { cookie: analystCookie } });
    const data = (await res.json()).data as { legacy_models: Array<{ id: string; referenced: boolean }> };
    expect(data.legacy_models.length).toBe(3);
    expect(data.legacy_models.find((m) => m.id === adoptedLegacy)?.referenced).toBe(true);
    expect(data.legacy_models.find((m) => m.id === freeLegacy1)?.referenced).toBe(false);
  });

  test("agents (delegated principal) and viewers are rejected; the route is registered human-only", async () => {
    const principal = { userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" };
    const res = await runAsPrincipal(principal, () =>
      legacyRoute.POST(new Request("http://x/legacy-cleanup", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: projectId }) }),
    );
    expect(res.status).toBe(403);
    expect(isHumanOnly("POST", `/api/projects/${projectId}/business-case/legacy-cleanup`, {})).toBe(true);
    expect((await cleanup(viewerCookie)).status).toBe(403);
    expect(db.query("SELECT COUNT(*) AS n FROM business_case_model WHERE project_id = ?").get(projectId)).toEqual({ n: 4 });
  });

  test("deletes unreferenced, archives referenced, leaves per-target untouched", async () => {
    const res = await cleanup(analystCookie);
    expect(res.status).toBe(200);
    const out = (await res.json()).data as { deleted: string[]; archived: string[] };
    expect(out.deleted.sort()).toEqual([freeLegacy1, freeLegacy2].sort());
    expect(out.archived).toEqual([adoptedLegacy]);

    const rows = db.query("SELECT id, archived_at, archived_by FROM business_case_model WHERE project_id = ?").all(projectId) as Array<{ id: string; archived_at: string | null; archived_by: string | null }>;
    expect(rows.map((r) => r.id).sort()).toEqual([adoptedLegacy, perTarget].sort());
    expect(rows.find((r) => r.id === adoptedLegacy)?.archived_by).toBe(ANALYST);
    expect(rows.find((r) => r.id === perTarget)?.archived_at).toBeNull();
    expect(db.query("SELECT COUNT(*) AS n FROM valuation_simulation WHERE model_id IN (?, ?)").get(freeLegacy1, freeLegacy2)).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM valuation_simulation WHERE model_id = ?").get(adoptedLegacy)).toEqual({ n: 1 });

    const actions = db.query("SELECT action FROM audit_log WHERE target LIKE ?").all(`${projectId}:%`) as Array<{ action: string }>;
    expect(actions.filter((a) => a.action === "business_case.delete").length).toBe(2);
    expect(actions.filter((a) => a.action === "business_case.archive").length).toBe(1);
  });

  test("notice count is 0, S8 list excludes archived, adopted model still resolves", async () => {
    const list = listBusinessCases(projectId);
    expect(countLegacyUnassignedModels(list.cases, list.targets)).toBe(0);
    expect(list.cases.map((c) => c.id)).toEqual([perTarget]);
    expect(list.archived.map((c) => c.id)).toEqual([adoptedLegacy]);
    const adopted = findAdoptedCase(list);
    expect(adopted?.id).toBe(adoptedLegacy);
    expect(adopted?.archived_at).not.toBeNull();
    const pkg = await req(`/api/projects/${projectId}/ic-package`, { headers: { cookie: analystCookie } });
    if (pkg.status === 200) {
      const data = (await pkg.json()).data as { business_case: { adopted: { id: string; archived_at: string | null } | null } };
      expect(data.business_case.adopted?.id).toBe(adoptedLegacy);
      expect(data.business_case.adopted?.archived_at).not.toBeNull();
    }
    const again = (await (await cleanup(analystCookie)).json()).data as { deleted: string[]; archived: string[] };
    expect(again).toEqual({ deleted: [], archived: [] });
  });
});
