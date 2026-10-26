// @version 1.0.0
/**
 * ADR-0186 P1 D6 - human-role grants (migration 0176): repository rules, the admin issue / revoke
 * routes, deny-by-default semantics, and the pin between GRANTABLE_ROLE_KEYS and
 * procedures/_human-roles.yaml.
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-human-role-grants.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");
const H = await import("../../db/lib/human-roles.ts");
const { AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");
const { resetRateLimits } = await import("../../app/web-next/lib/gate-integrity.ts");
const NOW = "2026-10-27T09:00:00Z";

const ADMIN = "gr-admin";
const A = "gr-alice";
const B = "gr-bob";
let adminCookie = "";
let analystCookie = "";

async function login(userId: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: `pw-${userId}-12345` }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
afterEach(() => resetRateLimits());
beforeAll(async () => {
  for (const [u, role] of [[ADMIN, "admin"], [A, "analyst"], [B, "analyst"]] as const) {
    await createUser(db, { userId: u, role, password: `pw-${u}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: u, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  adminCookie = await login(ADMIN);
  analystCookie = await login(A);
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const issue = (body: Record<string, unknown>, cookie = adminCookie) =>
  nextRequest("/api/admin/human-roles", { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("registry pin", () => {
  test("every GRANTABLE_ROLE_KEY is an entry of procedures/_human-roles.yaml", () => {
    const doc = yaml.load(readFileSync(join(PROJECT_ROOT, "procedures/_human-roles.yaml"), "utf8"), { schema: yaml.JSON_SCHEMA }) as { human_roles: Record<string, unknown> };
    for (const key of H.GRANTABLE_ROLE_KEYS) expect(Object.keys(doc.human_roles), key).toContain(key);
    expect([...H.GRANTABLE_ROLE_KEYS]).toEqual(["entity-ic-reviewer", "group-ic-reviewer"]);
  });
});

describe("migration 0176 schema", () => {
  test("table, indexes and approval_chain columns exist; one ACTIVE grant per (user, role)", () => {
    const cols = (t: string) => (db.query(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols("app_user_human_role")).toEqual(["id", "user_id", "role_key", "granted_by", "granted_at", "revoked_at", "revoked_by"]);
    expect(cols("approval_chain")).toEqual(expect.arrayContaining(["recorded_by", "decided_by"]));
    const idx = (db.query("PRAGMA index_list(app_user_human_role)").all() as Array<{ name: string; unique: number }>);
    expect(idx.map((i) => i.name)).toEqual(expect.arrayContaining(["idx_app_user_human_role_user", "uq_app_user_human_role_active"]));
    db.run("INSERT INTO app_user_human_role (id, user_id, role_key, granted_by, granted_at) VALUES ('g1', ?, 'entity-ic-reviewer', 'x', ?)", [B, NOW]);
    expect(() => db.run("INSERT INTO app_user_human_role (id, user_id, role_key, granted_by, granted_at) VALUES ('g2', ?, 'entity-ic-reviewer', 'x', ?)", [B, NOW])).toThrow();
    db.run("UPDATE app_user_human_role SET revoked_at = ?, revoked_by = 'x' WHERE id = 'g1'", [NOW]);
    db.run("INSERT INTO app_user_human_role (id, user_id, role_key, granted_by, granted_at) VALUES ('g3', ?, 'entity-ic-reviewer', 'x', ?)", [B, NOW]); // a revoked row does not block a re-grant
    db.run("DELETE FROM app_user_human_role");
  });
});

describe("repository", () => {
  test("hasHumanRole is deny-by-default and re-read each call (revocation is immediate)", () => {
    expect(H.hasHumanRole(db, A, ["entity-ic-reviewer"])).toBe(false);
    expect(H.hasHumanRole(db, A, [])).toBe(false);
    const id = H.issueHumanRoleGrant(db, { userId: A, roleKey: "entity-ic-reviewer", grantedBy: ADMIN, now: NOW });
    expect(H.hasHumanRole(db, A, ["entity-ic-reviewer"])).toBe(true);
    expect(H.hasHumanRole(db, A, ["group-ic-reviewer"])).toBe(false);
    expect(H.hasHumanRole(db, A, ["group-ic-reviewer", "entity-ic-reviewer"])).toBe(true);
    H.revokeHumanRoleGrant(db, { id, revokedBy: ADMIN, now: NOW });
    expect(H.hasHumanRole(db, A, ["entity-ic-reviewer"])).toBe(false);
    expect(db.query("SELECT revoked_by FROM app_user_human_role WHERE id = ?").get(id)).toEqual({ revoked_by: ADMIN }); // kept, not deleted
  });

  test("refusals: unknown role, unknown user, self-grant, agent account, duplicate; revoke twice / unknown", () => {
    const code = (fn: () => unknown) => { try { fn(); return "no error"; } catch (e) { return (e as InstanceType<typeof H.HumanRoleError>).code; } };
    expect(code(() => H.issueHumanRoleGrant(db, { userId: A, roleKey: "bau-exit-certifier", grantedBy: ADMIN, now: NOW }))).toBe("unknown_role");
    expect(code(() => H.issueHumanRoleGrant(db, { userId: "ghost", roleKey: "entity-ic-reviewer", grantedBy: ADMIN, now: NOW }))).toBe("unknown_user");
    expect(code(() => H.issueHumanRoleGrant(db, { userId: A, roleKey: "entity-ic-reviewer", grantedBy: A, now: NOW }))).toBe("self_grant");
    expect(code(() => H.issueHumanRoleGrant(db, { userId: "pm", roleKey: "entity-ic-reviewer", grantedBy: ADMIN, now: NOW, agentKeys: AGENT_KEYS }))).toBe("agent_account");
    const id = H.issueHumanRoleGrant(db, { userId: B, roleKey: "group-ic-reviewer", grantedBy: ADMIN, now: NOW });
    expect(code(() => H.issueHumanRoleGrant(db, { userId: B, roleKey: "group-ic-reviewer", grantedBy: ADMIN, now: NOW }))).toBe("already_granted");
    H.revokeHumanRoleGrant(db, { id, revokedBy: ADMIN, now: NOW });
    expect(code(() => H.revokeHumanRoleGrant(db, { id, revokedBy: ADMIN, now: NOW }))).toBe("already_revoked");
    expect(code(() => H.revokeHumanRoleGrant(db, { id: "nope", revokedBy: ADMIN, now: NOW }))).toBe("not_found");
    expect(AGENT_KEYS.has("pm")).toBe(true);
  });
});

describe("admin routes", () => {
  test("admin issues and revokes; both are audited; the list shows active grants only by default", async () => {
    const res = await issue({ user_id: A, role_key: "group-ic-reviewer" });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { data: { id: string } }).data.id;
    expect(db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'grant.issue' AND target = ?").get(`${A}:group-ic-reviewer:${id}`)).toEqual({ c: 1 });
    const list = (await (await nextRequest("/api/admin/human-roles", { headers: { cookie: adminCookie } })).json()) as { data: { grants: Array<{ id: string }>; grantable_roles: string[] } };
    expect(list.data.grants.map((g) => g.id)).toContain(id);
    expect(list.data.grantable_roles).toEqual(["entity-ic-reviewer", "group-ic-reviewer"]);

    const rev = await nextRequest(`/api/admin/human-roles/${id}/revoke`, { method: "POST", headers: { cookie: adminCookie } });
    expect(rev.status).toBe(200);
    expect(db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'grant.revoke' AND target = ?").get(`${A}:group-ic-reviewer:${id}`)).toEqual({ c: 1 });
    const after = (await (await nextRequest("/api/admin/human-roles", { headers: { cookie: adminCookie } })).json()) as { data: { grants: Array<{ id: string }> } };
    expect(after.data.grants.map((g) => g.id)).not.toContain(id);
    const all = (await (await nextRequest("/api/admin/human-roles?include_revoked=1", { headers: { cookie: adminCookie } })).json()) as { data: { grants: Array<{ id: string }> } };
    expect(all.data.grants.map((g) => g.id)).toContain(id);
    expect((await nextRequest(`/api/admin/human-roles/${id}/revoke`, { method: "POST", headers: { cookie: adminCookie } })).status).toBe(409);
    expect((await nextRequest("/api/admin/human-roles/nope/revoke", { method: "POST", headers: { cookie: adminCookie } })).status).toBe(404);
  });

  test("refusal codes over HTTP: duplicate 409, self-grant 403, agent 403, unknown role / user 400, missing fields 400", async () => {
    expect((await issue({ user_id: B, role_key: "entity-ic-reviewer" })).status).toBe(201);
    const dup = await issue({ user_id: B, role_key: "entity-ic-reviewer" });
    expect(dup.status).toBe(409);
    expect(await errCode(dup)).toBe("already_granted");
    const self = await issue({ user_id: ADMIN, role_key: "entity-ic-reviewer" });
    expect(self.status).toBe(403);
    expect(await errCode(self)).toBe("self_grant_forbidden");
    const agent = await issue({ user_id: "pm", role_key: "entity-ic-reviewer" });
    expect(agent.status).toBe(403); // refused as an agent account before any lookup
    expect(await errCode(agent)).toBe("agent_account");
    expect(await errCode(await issue({ user_id: A, role_key: "bau-exit-certifier" }))).toBe("unknown_role");
    expect((await issue({ user_id: A })).status).toBe(400);
    expect((await issue({ user_id: "ghost", role_key: "entity-ic-reviewer" })).status).toBe(400);
  });

  test("an analyst cannot manage grants (403); a bearer token, even an admin's, cannot (403 human_only)", async () => {
    expect((await issue({ user_id: B, role_key: "group-ic-reviewer" }, analystCookie)).status).toBe(403);
    expect((await nextRequest("/api/admin/human-roles", { headers: { cookie: analystCookie } })).status).toBe(403);
    const { token } = issueApiToken(db, { userId: ADMIN, label: "gr-test", scopes: ["read", "write"], now: NOW });
    const res = await nextRequest("/api/admin/human-roles", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ user_id: A, role_key: "group-ic-reviewer" }) });
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("human_only");
    const rev = await nextRequest("/api/admin/human-roles/x/revoke", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(rev.status).toBe(403);
  });

  test("an unauthenticated request is 401", async () => {
    expect((await nextRequest("/api/admin/human-roles", { method: "POST", body: "{}" })).status).toBe(401);
  });
});

describe("scenario support seed (design 3.11)", () => {
  test("seedGrantedReviewers creates two distinct holders, one per human role", async () => {
    const { seedGrantedReviewers } = await import("../scenarios/_support/deals.ts");
    await seedGrantedReviewers(TEST_DB_PATH, ADMIN, { entity: { userId: "gr-entity", password: "pw-gr-entity-12345" }, group: { userId: "gr-group", password: "pw-gr-group-12345" } });
    expect(H.hasHumanRole(db, "gr-entity", ["entity-ic-reviewer"])).toBe(true);
    expect(H.hasHumanRole(db, "gr-entity", ["group-ic-reviewer"])).toBe(false);
    expect(H.hasHumanRole(db, "gr-group", ["group-ic-reviewer"])).toBe(true);
    expect(db.query("SELECT must_change_password FROM app_user WHERE user_id = 'gr-entity'").get()).toEqual({ must_change_password: 0 });
  });
});
