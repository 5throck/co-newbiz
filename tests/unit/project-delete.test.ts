import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

// Deletion-mark semantics for the deal chain. DELETE /api/projects/[id]
// (lead-only) stamps deleted_at on the project and its source opportunity —
// no row is removed anywhere, so audit can always inspect the originals.
// A deal_archive manifest records the actors, the member allowlist, and the
// market-sizing version references (point-in-time freeze of shared assets).
const TEST_DB_PATH = "db/data/test-project-delete.sqlite";
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
// ADR-0133 — production mode (the fail-closed default) blocks DELETE; these
// tests exercise the deletion-mark mechanism itself, so opt this test DB into
// development mode up front.
const { setSystemMode } = await import("../../db/lib/system-mode.ts");
setSystemMode(db, "development", "test", NOW);
let projId = "";
let oppA = ""; // promoted, delete-marked with the project
let oppB = ""; // stays promoted — refusal test
let oppC = ""; // unpromoted — opportunity delete-mark test
let leadCookie = "";
let contribCookie = "";
let outsiderCookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  for (const u of ["lead-del", "contrib-del", "outsider-del"]) {
    await createUser(db, { userId: u, role: "analyst", password: `pw-${u}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: u, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  leadCookie = await loginCookie("lead-del", "pw-lead-del-12345");
  contribCookie = await loginCookie("contrib-del", "pw-contrib-del-12345");
  outsiderCookie = await loginCookie("outsider-del", "pw-outsider-del-12345");

  projId = ulid();
  oppA = ulid();
  // opportunity ↔ md_project reference each other — insert, then link
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppA, "딜 삭제 테스트 기회", "selected", "test", NOW]);
  db.run("INSERT INTO md_project (id, project_no, created_at, project_name, source_opportunity_id, track) VALUES (?,?,?,?,?,?)", [projId, "PRJ-DELTEST", NOW, "삭제 테스트 프로젝트", oppA, "brownfield"]);
  db.run("UPDATE opportunity SET project_id = ?, promoted_at = ? WHERE id = ?", [projId, NOW, oppA]);
  for (const [u, role] of [["lead-del", "lead"], ["contrib-del", "member"]] as const) {
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projId, u, role, "test", NOW, "test"]);
  }

  // market linkage for the manifest freeze (industry → analysis → version)
  db.run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", ["ind-arc", "아카이브 산업", "Archive Industry", NOW]);
  db.run("INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale) VALUES (?,?,?,?,?,?)", [ulid(), projId, "ind-arc", "test", NOW, "근거"]);
  const msId = ulid();
  db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, current_step, created_by, created_at) VALUES (?,?,?,?,?,?)", [msId, "ind-arc", "completed", 3, "test", NOW]);
  db.run("INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), msId, 1, '{"tam":1}', "test", NOW]);

  // S4 route decision — survives the delete-mark (audit requirement)
  db.run("INSERT INTO route_decision (id, opportunity_id, project_id, track, sub_track, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), oppA, projId, "brownfield", "m_and_a", "테스트 경로 사유", "test", NOW]);

  // second deal that stays promoted (refusal test)
  oppB = ulid();
  const projB = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppB, "승격 유지 기회", "selected", "test", NOW]);
  db.run("INSERT INTO md_project (id, project_no, created_at, project_name, source_opportunity_id) VALUES (?,?,?,?,?)", [projB, "PRJ-DELTEST2", NOW, "승격 유지 프로젝트", oppB]);
  db.run("UPDATE opportunity SET project_id = ?, promoted_at = ? WHERE id = ?", [projB, NOW, oppB]);

  // third deal — unpromoted opportunity (opportunity mark test)
  oppC = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppC, "단독 기회", "identified", "test", NOW]);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function count(table: string, where = "1=1", ...bind: unknown[]): number {
  return (db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...bind) as { n: number }).n;
}

describe("DELETE /api/projects/[id] — deletion mark", () => {
  test("is lead-only", async () => {
    const res = await nextRequest(`/api/projects/${projId}`, { method: "DELETE", headers: { cookie: contribCookie } });
    expect(res.status).toBe(403);
  });

  test("non-member cannot see the project (deny-by-default 404)", async () => {
    const res = await nextRequest(`/api/projects/${projId}`, { method: "DELETE", headers: { cookie: outsiderCookie } });
    expect(res.status).toBe(404);
  });

  test("lead marks project + source opportunity; originals survive for audit", async () => {
    const res = await nextRequest(`/api/projects/${projId}`, { method: "DELETE", headers: { cookie: leadCookie } });
    expect(res.status).toBe(200);

    // the rows survive, marked
    const proj = db.query("SELECT deleted_at, deleted_by FROM md_project WHERE id = ?").get(projId) as
      | { deleted_at: string | null; deleted_by: string | null }
      | undefined;
    expect(proj?.deleted_at).toBeTruthy();
    expect(proj?.deleted_by).toBe("lead-del");
    const opp = db.query("SELECT deleted_at, project_id FROM opportunity WHERE id = ?").get(oppA) as
      | { deleted_at: string | null; project_id: string | null }
      | undefined;
    expect(opp?.deleted_at).toBeTruthy();
    expect(opp?.project_id).toBe(projId);
    // audit: S4 history intact (nothing physically deleted)
    expect(count("route_decision", "opportunity_id = ?", oppA)).toBe(1);
    // manifest: kind, member allowlist, market freeze
    const manifest = db
      .query("SELECT kind, entity_type, project_id, market_freeze_json, member_user_ids_json FROM deal_archive WHERE project_id = ? AND kind = 'deleted'")
      .get(projId) as { kind: string; entity_type: string; project_id: string; market_freeze_json: string; member_user_ids_json: string } | undefined;
    expect(manifest?.kind).toBe("deleted");
    expect(manifest?.entity_type).toBe("project");
    expect(manifest?.member_user_ids_json).toContain("lead-del");
    const freeze = JSON.parse(manifest!.market_freeze_json) as Array<{ industryId: string; versionNo: number | null }>;
    expect(freeze[0]?.industryId).toBe("ind-arc");
    expect(freeze[0]?.versionNo).toBe(1);
    expect(count("audit_log", "action = 'project_delete'")).toBe(1);
  });

  test("marked project disappears from the default list and the pipeline", async () => {
    const list = await nextRequest("/api/projects", { headers: { cookie: leadCookie } });
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((p) => p.id === projId)).toBe(false);
    // projB는 lead-del 멤버십이 없어 deny-by-default로 애초에 보이지 않는다 —
    // 즉 삭제 표시된 딜만 목록에서 빠졌음을 이 단정으로 검증한다
  });

  test("double delete is refused", async () => {
    const res = await nextRequest(`/api/projects/${projId}`, { method: "DELETE", headers: { cookie: leadCookie } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } | null };
    expect(body.error?.code).toBe("already_deleted");
  });
});

describe("DELETE /api/opportunities/[id] — deletion mark", () => {
  test("promoted opportunity is refused with project-first guidance", async () => {
    const res = await nextRequest(`/api/opportunities/${oppB}`, { method: "DELETE", headers: { cookie: leadCookie } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } | null };
    expect(body.error?.code).toBe("opportunity_promoted");
    expect(body.error?.message).toContain("프로젝트");
  });

  test("unpromoted opportunity gets its own delete mark + manifest; excluded from the list but still resolvable by id", async () => {
    const res = await nextRequest(`/api/opportunities/${oppC}`, { method: "DELETE", headers: { cookie: leadCookie } });
    expect(res.status).toBe(200);
    const opp = db.query("SELECT deleted_at FROM opportunity WHERE id = ?").get(oppC) as { deleted_at: string | null } | undefined;
    expect(opp?.deleted_at).toBeTruthy();
    expect(count("deal_archive", "opportunity_id = ? AND kind = 'deleted'", oppC)).toBe(1);

    const list = await nextRequest("/api/opportunities", { headers: { cookie: leadCookie } });
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((o) => o.id === oppC)).toBe(false);
    // Single-id GET stays resolvable even once deleted — a direct-id lookup
    // is "I already know this row" (e.g. an S4 screen re-opened after its
    // opportunity was promoted-then-archived), unlike the list endpoint
    // above which correctly hides it from active work views.
    const single = await nextRequest(`/api/opportunities/${oppC}`, { headers: { cookie: leadCookie } });
    expect(single.status).toBe(200);
    const singleBody = (await single.json()) as { data: { id: string; deleted_at: string | null } };
    expect(singleBody.data.deleted_at).toBeTruthy();
  });
});
