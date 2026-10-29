// @version 1.0.0
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-user-delete-cleanup.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser, deleteUser, listOrphanedMemberships } = await import("../../db/lib/accounts.ts");

const NOW = new Date().toISOString();
const PW: Record<string, string> = { root: "pw-root-12345", carol: "pw-carol-12345", dave: "pw-dave-123456" };

function seedProject(id: string) {
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, "NP-" + id, NOW]);
}
function member(project: string, user: string) {
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [project, user, "member", "root", NOW, "test"],
  );
  db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [project, user, NOW, "mnpi"]);
}

beforeAll(async () => {
  for (const [userId, role] of [["root", "admin"], ["carol", "analyst"], ["dave", "analyst"]] as const) {
    await createUser(db, { userId, role, password: PW[userId], createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const p of ["P1", "P2"]) { seedProject(p); member(p, "carol"); member(p, "dave"); }
});

describe("user delete cleanup", () => {
  test("disable keeps memberships; orphan report lists them as user_disabled", async () => {
    const login = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "root", password: PW.root }) });
    const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    const res = await nextRequest("/api/admin/users/dave", { method: "PUT", headers: { cookie }, body: JSON.stringify({ action: "disable" }) });
    expect(res.status).toBe(200);
    const active = db.query("SELECT COUNT(*) AS n FROM project_member WHERE user_id='dave' AND revoked_at IS NULL").get() as { n: number };
    expect(active.n).toBe(2);
    const orphans = listOrphanedMemberships(db);
    expect(orphans.filter((o) => o.user_id === "dave").map((o) => o.reason)).toEqual(["user_disabled", "user_disabled"]);
    expect(orphans.some((o) => o.user_id === "carol")).toBe(false);
  });

  test("delete via admin API revokes memberships/insider entries, audits, leaves others alone", async () => {
    const login = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "root", password: PW.root }) });
    const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];
    const res = await nextRequest("/api/admin/users/carol", { method: "PUT", headers: { cookie }, body: JSON.stringify({ action: "delete" }) });
    expect(res.status).toBe(200);
    expect(db.query("SELECT 1 FROM app_user WHERE user_id='carol'").get()).toBeNull();
    const pm = db.query("SELECT revoked_at FROM project_member WHERE user_id='carol'").all() as { revoked_at: string | null }[];
    expect(pm.length).toBe(2);
    expect(pm.every((r) => r.revoked_at !== null)).toBe(true);
    const il = db.query("SELECT removed_at, reason FROM insider_list WHERE user_id='carol'").all() as { removed_at: string | null; reason: string }[];
    expect(il.every((r) => r.removed_at !== null && r.reason.includes("account deleted"))).toBe(true);
    const audits = db.query("SELECT actor_user_id FROM audit_log WHERE action='membership_revoke' AND target LIKE '%:carol'").all() as { actor_user_id: string }[];
    expect(audits.length).toBe(2);
    expect(audits.every((a) => a.actor_user_id === "root")).toBe(true);
    expect(db.query("SELECT 1 FROM audit_log WHERE action='account_delete' AND target LIKE 'carol%'").get()).not.toBeNull();
    // others unaffected
    const dave = db.query("SELECT COUNT(*) AS n FROM project_member WHERE user_id='dave' AND revoked_at IS NULL").get() as { n: number };
    expect(dave.n).toBe(2);
    expect(listOrphanedMemberships(db).some((o) => o.user_id === "carol")).toBe(false);
  });

  test("orphan report finds a seeded user_missing orphan; unknown user delete is not-found", () => {
    db.run("PRAGMA foreign_keys = OFF");
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES ('P1','ghost','member','root',?, 'x')", [NOW]);
    db.run("PRAGMA foreign_keys = ON");
    const g = listOrphanedMemberships(db).find((o) => o.user_id === "ghost");
    expect(g?.reason).toBe("user_missing");
    expect(deleteUser(db, { userId: "nobody", deletedBy: "root", now: NOW }).deleted).toBe(false);
  });
});
