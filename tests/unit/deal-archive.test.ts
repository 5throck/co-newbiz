import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

// deal_archive manifest + archive API. Closing/archiving a deal writes an
// 'archived' manifest (market version freeze + member allowlist); the
// delete-mark writes a 'deleted' one. The archive API shows deleted manifests
// only to the members recorded at mark time, admins are blocked, and every
// detail view is audit-logged.
const TEST_DB_PATH = "db/data/test-deal-archive.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-09-10T00:00:00Z";
let projId = "";
let oppId = "";
let memberCookie = "";
let outsiderCookie = "";
let adminCookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  for (const [u, role] of [["member-a", "analyst"], ["outsider-a", "analyst"], ["admin-a", "admin"]] as const) {
    await createUser(db, { userId: u, role, password: `pw-${u}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: u, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  memberCookie = await loginCookie("member-a", "pw-member-a-12345");
  outsiderCookie = await loginCookie("outsider-a", "pw-outsider-a-12345");
  adminCookie = await loginCookie("admin-a", "pw-admin-a-12345");

  projId = ulid();
  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppId, "아카이브 테스트 기회", "selected", "test", NOW]);
  db.run("INSERT INTO md_project (id, project_no, created_at, project_name, source_opportunity_id, track) VALUES (?,?,?,?,?,?)", [projId, "PRJ-ARCH", NOW, "아카이브 프로젝트", oppId, "greenfield"]);
  db.run("UPDATE opportunity SET project_id = ?, promoted_at = ? WHERE id = ?", [projId, NOW, oppId]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projId, "member-a", "lead", "test", NOW, "test"]);

  // market linkage for the freeze
  db.run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", ["ind-freeze", "고정 산업", "Freeze Industry", NOW]);
  db.run("INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale) VALUES (?,?,?,?,?,?)", [ulid(), projId, "ind-freeze", "test", NOW, "근거"]);
  const msId = ulid();
  db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, current_step, created_by, created_at) VALUES (?,?,?,?,?,?)", [msId, "ind-freeze", "completed", 3, "test", NOW]);
  db.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), msId, 1, '{"tam":100}', "test", NOW]);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function count(table: string, where = "1=1", ...bind: unknown[]): number {
  return (db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...bind) as { n: number }).n;
}

describe("deal_archive lifecycle", () => {
  test("closing writes an archived manifest with the market version freeze", async () => {
    const res = await nextRequest(`/api/projects/${projId}/close`, {
      method: "PATCH",
      headers: { cookie: memberCookie },
      body: JSON.stringify({ status: "archived", closure_reason: "보관 사유 테스트" }),
    });
    expect(res.status).toBe(200);
    const manifest = db.query("SELECT * FROM deal_archive WHERE project_id = ? AND kind = 'archived'").get(projId) as
      | { status_at_archive: string; market_freeze_json: string; member_user_ids_json: string; reason: string | null }
      | undefined;
    expect(manifest).toBeTruthy();
    expect(manifest!.status_at_archive).toBe("archived");
    expect(manifest!.reason).toBe("보관 사유 테스트");
    expect(manifest!.member_user_ids_json).toContain("member-a");
    const freeze = JSON.parse(manifest!.market_freeze_json) as Array<{ industryId: string; versionNo: number | null }>;
    expect(freeze[0]?.industryId).toBe("ind-freeze");
    expect(freeze[0]?.versionNo).toBe(1);
  });

  test("closed/archived projects appear via ?status= and stay out of the default list", async () => {
    const all = await nextRequest("/api/projects?status=all", { headers: { cookie: memberCookie } });
    const allBody = (await all.json()) as { data: Array<{ id: string; status: string }> };
    expect(allBody.data.find((p) => p.id === projId)?.status).toBe("archived");

    const open = await nextRequest("/api/projects", { headers: { cookie: memberCookie } });
    const openBody = (await open.json()) as { data: Array<{ id: string }> };
    expect(openBody.data.some((p) => p.id === projId)).toBe(false);
  });

  test("archived project: child reads stay open, writes are blocked", async () => {
    const charter = await nextRequest(`/api/projects/${projId}/charter`, { headers: { cookie: memberCookie } });
    expect(charter.status).toBe(200);
    const processRes = await nextRequest(`/api/projects/${projId}/process`, { headers: { cookie: memberCookie } });
    expect(processRes.status).toBe(200);
    const processMeta = (await processRes.json()) as { meta: { project_status: string | null; deleted: boolean } };
    expect(processMeta.meta.project_status).toBe("archived");
    expect(processMeta.meta.deleted).toBe(false);
    // 쓰기는 open 전용 조회라 보관 프로젝트에서는 404
    const write = await nextRequest(`/api/projects/${projId}/charter`, {
      method: "POST",
      headers: { cookie: memberCookie },
      body: JSON.stringify({ note: "보관 후 수정 시도" }),
    });
    expect(write.status).toBe(404);
  });

  test("delete-mark writes a deleted manifest visible only to the members at mark time", async () => {
    const res = await nextRequest(`/api/projects/${projId}`, { method: "DELETE", headers: { cookie: memberCookie } });
    expect(res.status).toBe(200);

    expect(count("deal_archive", "project_id = ? AND kind = 'deleted'", projId)).toBe(1);

    const asMember = await nextRequest("/api/archive/deals", { headers: { cookie: memberCookie } });
    expect(asMember.status).toBe(200);
    const memberBody = (await asMember.json()) as { data: Array<{ project_id: string; project_no: string | null }> };
    const row = memberBody.data.find((d) => d.project_id === projId);
    expect(row).toBeTruthy();
    expect(row?.project_no).toBe("PRJ-ARCH");

    const asOutsider = await nextRequest("/api/archive/deals", { headers: { cookie: outsiderCookie } });
    const outsiderBody = (await asOutsider.json()) as { data: Array<{ project_id: string }> };
    expect(outsiderBody.data.some((d) => d.project_id === projId)).toBe(false);

    const asAdmin = await nextRequest("/api/archive/deals", { headers: { cookie: adminCookie } });
    expect(asAdmin.status).toBe(403);
  });

  test("detail view is member-only and audit-logged", async () => {
    const manifest = db.query("SELECT id FROM deal_archive WHERE project_id = ? AND kind = 'deleted'").get(projId) as
      | { id: string }
      | undefined;
    expect(manifest?.id).toBeTruthy();

    const asMember = await nextRequest(`/api/archive/deals/${manifest!.id}`, { headers: { cookie: memberCookie } });
    expect(asMember.status).toBe(200);
    const body = (await asMember.json()) as { data: { market_freeze: Array<{ industryId: string }> } };
    expect(body.data.market_freeze?.[0]?.industryId).toBe("ind-freeze");
    expect(count("audit_log", "action = 'archive_view'")).toBe(1);

    const asOutsider = await nextRequest(`/api/archive/deals/${manifest!.id}`, { headers: { cookie: outsiderCookie } });
    expect(asOutsider.status).toBe(404);
  });

  test("delete-marked project: child reads still open (audit), writes stay blocked", async () => {
    const charter = await nextRequest(`/api/projects/${projId}/charter`, { headers: { cookie: memberCookie } });
    expect(charter.status).toBe(200);
    const processRes = await nextRequest(`/api/projects/${projId}/process`, { headers: { cookie: memberCookie } });
    expect(processRes.status).toBe(200);
    const processMeta = (await processRes.json()) as { meta: { project_status: string | null; deleted: boolean } };
    expect(processMeta.meta.deleted).toBe(true);
    const write = await nextRequest(`/api/projects/${projId}/charter`, {
      method: "POST",
      headers: { cookie: memberCookie },
      body: JSON.stringify({ note: "삭제 후 수정 시도" }),
    });
    expect(write.status).toBe(404);
  });

  test("marked project is gone from every status list but its data survives", async () => {
    const all = await nextRequest("/api/projects?status=all", { headers: { cookie: memberCookie } });
    const allBody = (await all.json()) as { data: Array<{ id: string }> };
    expect(allBody.data.some((p) => p.id === projId)).toBe(false);
    // originals survive — audit can still inspect the rows directly
    const proj = db.query("SELECT deleted_at, deleted_by FROM md_project WHERE id = ?").get(projId) as
      | { deleted_at: string | null; deleted_by: string | null }
      | undefined;
    expect(proj?.deleted_at).toBeTruthy();
    expect(proj?.deleted_by).toBe("member-a");
  });
});
