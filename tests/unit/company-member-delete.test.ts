import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

// 우리회사 마스터데이터(그룹/계열사) 삭제 = deletion mark. 물리 삭제가 아니므로
// synergy_analysis 등 참조가 남아 있어도 표시가 가능하고(데이터 보존 — 감사 대응),
// 모든 목록/조회 화면이 표시를 필터링한다. FK 충돌은 원천적으로 없다.
const TEST_DB_PATH = "db/data/test-company-member-delete.sqlite";
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
let groupId = "";
let memberWithSynergy = ""; // referenced by one synergy_analysis
let plainMember = ""; // no references
let cookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: "member-del", role: "analyst", password: "pw-member-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "member-del", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie("member-del", "pw-member-12345");

  groupId = ulid();
  db.run("INSERT INTO company_group (id, name, created_by, created_at) VALUES (?,?,?,?)", [groupId, "삭제 테스트 그룹", "test", NOW]);
  memberWithSynergy = ulid();
  db.run("INSERT INTO company_group_member (id, group_id, company_name, dart_corp_code, role, created_at) VALUES (?,?,?,?,?,?)", [memberWithSynergy, groupId, "참조된 계열사", "00126380", "hq", NOW]);
  plainMember = ulid();
  db.run("INSERT INTO company_group_member (id, group_id, company_name, dart_corp_code, role, created_at) VALUES (?,?,?,?,?,?)", [plainMember, groupId, "자유 계열사", null, "affiliate", NOW]);
  db.run("INSERT INTO company_profile_version (id, member_id, version_no, payload, source_ref, created_by, created_at) VALUES (?,?,?,?,?,?,?)", [ulid(), plainMember, 1, "{}", null, "test", NOW]);
  db.run(
    "INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at, member_id) VALUES (?,?,?,?,?,?,?)",
    [ulid(), "md-synergy-registry-sentinel", "completed", 3, "test", NOW, memberWithSynergy],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function count(table: string, where = "1=1", ...bind: unknown[]): number {
  return (db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...bind) as { n: number }).n;
}

describe("company_group_member DELETE — deletion mark", () => {
  test("member with a live synergy reference can still be marked — originals survive", async () => {
    const res = await nextRequest(`/api/our-company/groups/${groupId}/members`, {
      method: "DELETE",
      headers: { cookie },
      body: JSON.stringify({ member_id: memberWithSynergy }),
    });
    expect(res.status).toBe(200);
    const row = db.query("SELECT deleted_at, company_name FROM company_group_member WHERE id = ?").get(memberWithSynergy) as
      | { deleted_at: string | null; company_name: string }
      | undefined;
    expect(row?.deleted_at).toBeTruthy();
    expect(row?.company_name).toBe("참조된 계열사");
    // the referencing synergy analysis is untouched (audit requirement)
    expect(count("synergy_analysis", "member_id = ?", memberWithSynergy)).toBe(1);
    expect(count("audit_log", "action = 'company_member_delete'")).toBe(1);
  });

  test("group detail and member list hide marked rows", async () => {
    const res = await nextRequest(`/api/our-company/groups/${groupId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { members: Array<{ id: string }> } };
    expect(body.data.members.some((m) => m.id === memberWithSynergy)).toBe(false);
    expect(body.data.members.some((m) => m.id === plainMember)).toBe(true);
  });

  test("unknown member in a known group is 404, not a silent success", async () => {
    const res = await nextRequest(`/api/our-company/groups/${groupId}/members`, {
      method: "DELETE",
      headers: { cookie },
      body: JSON.stringify({ member_id: ulid() }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/our-company/groups/[id] — group mark", () => {
  test("marks the group with all its members; originals survive", async () => {
    const res = await nextRequest(`/api/our-company/groups/${groupId}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    const group = db.query("SELECT deleted_at FROM company_group WHERE id = ?").get(groupId) as { deleted_at: string | null } | undefined;
    expect(group?.deleted_at).toBeTruthy();
    expect(count("company_group_member", "group_id = ?", groupId)).toBe(2);
    expect(count("company_group_member", "group_id = ? AND deleted_at IS NULL", groupId)).toBe(0);
    expect(count("company_profile_version", "member_id = ?", plainMember)).toBe(1);
    expect(count("audit_log", "action = 'company_group_delete'")).toBe(1);
  });

  test("marked group disappears from the groups list", async () => {
    const res = await nextRequest("/api/our-company/groups", { headers: { cookie } });
    const body = (await res.json()) as { data: { groups: Array<{ id: string }> } };
    expect(body.data.groups.some((g) => g.id === groupId)).toBe(false);
  });

  test("unknown group is 404", async () => {
    const res = await nextRequest(`/api/our-company/groups/${ulid()}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(404);
  });
});
