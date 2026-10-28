// @version 1.0.0
// PUT/DELETE /api/projects/:id/debt/:debtId — auth, viewer 403, admin 403, need-to-know 404,
// validation 400, update/delete effects and audit rows.
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-debt-edit-delete.sqlite";
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
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = "2026-10-29T09:00:00Z";
const cookies: Record<string, string> = {};
const USERS = { analyst: "debt-ed-analyst", outsider: "debt-ed-outsider", viewer: "debt-ed-viewer", admin: "debt-ed-admin" } as const;
let projectId = "";

const call = (method: string, who: keyof typeof USERS | null, path: string, body?: unknown) =>
  nextRequest(path, { method, headers: who ? { cookie: cookies[who] } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
const seedDebt = (): string => {
  const rid = ulid();
  db.run("INSERT INTO debt_instrument (id, project_id, lender, principal, rate_type, rate, maturity, amortization, covenant_json, security, seniority) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [rid, projectId, "OldBank", 100, "fixed", 4, "5년", "annuity", "DSCR >= 1.2", "담보", "senior"]);
  return rid;
};
const url = (rid: string) => `/api/projects/${projectId}/debt/${rid}`;
const auditCount = (action: string, rid: string) =>
  (db.query("SELECT COUNT(*) n FROM audit_log WHERE action = ? AND target = ?").get(action, `${projectId}:${rid}`) as { n: number }).n;
const GOOD = { lender: "NewBank", principal: 250, rate: 5.5, rate_type: "floating", maturity: "2031-06", amortization: "bullet", covenant_json: "DSCR >= 1.3" };

beforeAll(async () => {
  for (const [role, userId] of Object.entries(USERS)) {
    await createUser(db, { userId, role: (role === "outsider" ? "analyst" : role) as "analyst", password: "pw-debt-ed-1234", createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const [role, userId] of Object.entries(USERS)) {
    const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: "pw-debt-ed-1234" }) });
    cookies[role] = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  }
  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, track) VALUES (?,?,?,?)", [projectId, `DED-${projectId.slice(-8)}`, NOW, "greenfield"]);
  for (const u of [USERS.analyst, USERS.viewer]) {
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, u, "member", "root", NOW, "test"]);
  }
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("PUT /debt/:debtId", () => {
  test("unauthenticated -> 401", async () => {
    expect((await call("PUT", null, url(seedDebt()), GOOD)).status).toBe(401);
  });
  test("viewer -> 403, admin -> 403, row unchanged", async () => {
    const rid = seedDebt();
    expect((await call("PUT", "viewer", url(rid), GOOD)).status).toBe(403);
    expect((await call("PUT", "admin", url(rid), GOOD)).status).toBe(403);
    expect((db.query("SELECT lender FROM debt_instrument WHERE id = ?").get(rid) as { lender: string }).lender).toBe("OldBank");
  });
  test("non-member -> 404 (project stays invisible)", async () => {
    const rid = seedDebt();
    expect((await call("PUT", "outsider", url(rid), GOOD)).status).toBe(404);
  });
  test("unknown debt id -> 404", async () => {
    expect((await call("PUT", "analyst", url("nope"), GOOD)).status).toBe(404);
  });
  test("invalid body -> 400 invalid_debt_instrument, row unchanged", async () => {
    const rid = seedDebt();
    const res = await call("PUT", "analyst", url(rid), { ...GOOD, rate: 0 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_debt_instrument");
    expect((db.query("SELECT principal FROM debt_instrument WHERE id = ?").get(rid) as { principal: number }).principal).toBe(100);
  });
  test("analyst updates the row and an audit row is written", async () => {
    const rid = seedDebt();
    const res = await call("PUT", "analyst", url(rid), GOOD);
    expect(res.status).toBe(200);
    expect(db.query("SELECT lender, principal, rate_type, rate, maturity, amortization, covenant_json FROM debt_instrument WHERE id = ?").get(rid))
      .toMatchObject({ lender: "NewBank", principal: 250, rate_type: "floating", rate: 5.5, maturity: "2031-06", amortization: "bullet", covenant_json: "DSCR >= 1.3" });
    expect(auditCount("debt.update", rid)).toBe(1);
  });
});

describe("DELETE /debt/:debtId", () => {
  test("unauthenticated 401, viewer 403, admin 403, non-member 404 - row survives", async () => {
    const rid = seedDebt();
    expect((await call("DELETE", null, url(rid))).status).toBe(401);
    expect((await call("DELETE", "viewer", url(rid))).status).toBe(403);
    expect((await call("DELETE", "admin", url(rid))).status).toBe(403);
    expect((await call("DELETE", "outsider", url(rid))).status).toBe(404);
    expect(db.query("SELECT id FROM debt_instrument WHERE id = ?").get(rid)).toBeTruthy();
  });
  test("analyst deletes the row, audit written, second delete -> 404", async () => {
    const rid = seedDebt();
    expect((await call("DELETE", "analyst", url(rid))).status).toBe(200);
    expect(db.query("SELECT id FROM debt_instrument WHERE id = ?").get(rid)).toBeNull();
    expect(auditCount("debt.delete", rid)).toBe(1);
    expect((await call("DELETE", "analyst", url(rid))).status).toBe(404);
  });
});
