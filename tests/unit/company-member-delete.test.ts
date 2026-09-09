import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

// company_group_member DELETE — the referential guard. synergy_analysis.member_id
// references this row (NO ACTION, migration 0060) and the app enforces
// PRAGMA foreign_keys = ON, so an unguarded delete dies mid-handler and the
// browser sees an empty 500 ("서버 응답이 비어 있거나 손상되었습니다"). The route
// must refuse with a readable 409 member_in_use instead, and succeed cleanly
// once nothing references the member.
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
let blockedMemberId = ""; // referenced by one synergy_analysis
let freeMemberId = ""; // no references, carries one profile version
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
  blockedMemberId = ulid();
  db.run("INSERT INTO company_group_member (id, group_id, company_name, dart_corp_code, role, created_at) VALUES (?,?,?,?,?,?)", [blockedMemberId, groupId, "참조된 계열사", "00126380", "hq", NOW]);
  freeMemberId = ulid();
  db.run("INSERT INTO company_group_member (id, group_id, company_name, dart_corp_code, role, created_at) VALUES (?,?,?,?,?,?)", [freeMemberId, groupId, "자유 계열사", null, "affiliate", NOW]);
  db.run("INSERT INTO company_profile_version (id, member_id, version_no, payload, source_ref, created_by, created_at) VALUES (?,?,?,?,?,?,?)", [ulid(), freeMemberId, 1, "{}", null, "test", NOW]);
  db.run(
    "INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at, member_id) VALUES (?,?,?,?,?,?,?)",
    [ulid(), "md-synergy-registry-sentinel", "completed", 3, "test", NOW, blockedMemberId],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("company_group_member DELETE — referential guard (member_in_use)", () => {
  test("deletion is refused with 409 member_in_use while a synergy analysis references the member", async () => {
    const res = await nextRequest(`/api/our-company/groups/${groupId}/members`, {
      method: "DELETE",
      headers: { cookie },
      body: JSON.stringify({ member_id: blockedMemberId }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } | null };
    expect(body.error?.code).toBe("member_in_use");
    expect(body.error?.message).toContain("시너지 분석");
    const still = db.query("SELECT id FROM company_group_member WHERE id = ?").get(blockedMemberId);
    expect(still).toBeTruthy();
  });

  test("deletion succeeds once nothing references the member (member + profile versions removed)", async () => {
    const res = await nextRequest(`/api/our-company/groups/${groupId}/members`, {
      method: "DELETE",
      headers: { cookie },
      body: JSON.stringify({ member_id: freeMemberId }),
    });
    expect(res.status).toBe(200);
    expect(db.query("SELECT id FROM company_group_member WHERE id = ?").get(freeMemberId)).toBeFalsy();
    expect(db.query("SELECT id FROM company_profile_version WHERE member_id = ?").get(freeMemberId)).toBeFalsy();
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
