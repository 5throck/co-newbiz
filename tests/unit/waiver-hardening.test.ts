// @version 1.0.0
/**
 * ADR-0186 P1 D5 - waiver hardening on the real routes:
 *   POST /waivers                 : clause resolves, not_waivable, approver_role, reason substance, approved_by body field
 *   POST /waivers/:id/approve     : authenticated approver, differs from requester, holds the grant, <= 90 days, approved_at
 *   PATCH /waivers/:id (approve)  : the legacy path is held to the same rules under enforce
 *   findActiveWaiver              : an approved waiver is returned (approved_at set)
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-waiver-hardening.sqlite");
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
const { issueHumanRoleGrant } = await import("../../db/lib/human-roles.ts");
const { findActiveWaiver, issueWaiver } = await import("../../db/lib/compliance.ts");
const { gateIntegrityEnvName, GATE_INTEGRITY_FAMILIES } = await import("../../app/web-next/lib/gate-integrity-flags.ts");
const { resetRateLimits } = await import("../../app/web-next/lib/gate-integrity.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const S = await import("./_gate-integrity-support.ts");

const REQUESTER = "wh-requester";
const APPROVER = "wh-approver";
const OTHER = "wh-other";
const OUTSIDER = "wh-outsider";
const cookies: Record<string, string> = {};
let projectId = "";
let docId = "";

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();
// bf-04 is mandatory AND waiver-eligible; bf-01 is mandatory and NOT waiver-eligible (checklists/brownfield-feasibility-checklist).
const WAIVABLE = { checklist_id: "chk-brownfield-feasibility-checklist", item_id: "bf-04" };
const BINDING = { checklist_id: "chk-brownfield-feasibility-checklist", item_id: "bf-01" };
const REASON = "대상 기업의 임원 보상 자료가 데이터룸에 없어 면제를 요청함";
// A pool of distinct waiver-eligible items (the duplicate-active rule forbids re-filing one clause).
const { getChecklistItems } = await import("../../app/web-next/lib/library.ts");
const POOL: Array<{ checklist_id: string; item_id: string }> = [];
for (const c of ["chk-financial-dd-checklist", "chk-legal-dd-checklist", "chk-commercial-dd-checklist", "chk-hr-dd-checklist", "chk-technical-dd-checklist", "chk-market-dd-checklist"]) {
  for (const i of getChecklistItems(c) ?? []) if (i.waiver_eligible) POOL.push({ checklist_id: c, item_id: i.id });
}
let poolAt = 0;
const nextItem = () => {
  const it = POOL[poolAt++];
  if (!it) throw new Error("waiver item pool exhausted");
  return it;
};

async function login(userId: string, pw: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const flagNames = GATE_INTEGRITY_FAMILIES.map(gateIntegrityEnvName);
afterEach(() => {
  for (const n of flagNames) delete process.env[n];
  delete process.env.CO_NEWBIZ_WAIVER_APPROVED_BY_COMPAT;
  resetRateLimits();
});

beforeAll(async () => {
  for (const [u, role] of [[REQUESTER, "analyst"], [APPROVER, "analyst"], [OTHER, "analyst"], [OUTSIDER, "analyst"], ["wh-admin", "admin"]] as const) {
    await createUser(db, { userId: u, role, password: `pw-${u}-12345`, createdBy: "test", now: S.NOW });
    approveUser(db, { userId: u, approvedBy: "test", now: S.NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const u of [REQUESTER, APPROVER, OTHER, OUTSIDER, "wh-admin"]) cookies[u] = await login(u, `pw-${u}-12345`);
  docId = S.insertGovernanceDoc(db);
  const seeded = S.seedReadyProject(db, REQUESTER);
  projectId = seeded.projectId;
  // OTHER is a project member (lead) too, so visibility is not the thing under test.
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, APPROVER, "lead", "test", S.NOW, "waiver test"]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, OTHER, "lead", "test", S.NOW, "waiver test"]);
  issueHumanRoleGrant(db, { userId: APPROVER, roleKey: "entity-ic-reviewer", grantedBy: "wh-admin", now: S.NOW });
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function request(body: Record<string, unknown>, who = REQUESTER) {
  return nextRequest(`/api/projects/${projectId}/waivers`, { method: "POST", headers: { cookie: cookies[who] }, body: JSON.stringify({ governance_doc_id: docId, ...body }) });
}
const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
async function pendingWaiver(over: Record<string, unknown> = {}): Promise<string> {
  const res = await request({ dd_item: WAIVABLE, reason: REASON, approver_role: "entity-ic-reviewer", expires_at: inDays(60), ...over });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data.id;
}
const approve = (waiverId: string, who: string, init: RequestInit = {}) =>
  nextRequest(`/api/projects/${projectId}/waivers/${waiverId}/approve`, { method: "POST", headers: { cookie: cookies[who] }, ...init });
const row = (id: string) => db.query("SELECT status, approved_by, approved_at FROM waiver WHERE id = ?").get(id) as { status: string; approved_by: string | null; approved_at: string | null };

describe("issue time (family waiver / rationale)", () => {
  test("off: legacy behavior - a policy-style clause_ref and a free approver_role are accepted", async () => {
    const res = await request({ clause_ref: "sec-4.2", reason: "x", approver_role: "pgm", expires_at: inDays(400) });
    expect(res.status).toBe(201);
  });

  test("enforce: a mandatory non-waiver-eligible item is 422 not_waivable", async () => {
    process.env[gateIntegrityEnvName("waiver")] = "enforce";
    const res = await request({ dd_item: BINDING, reason: REASON, approver_role: "entity-ic-reviewer", expires_at: inDays(30) });
    expect(res.status).toBe(422);
    expect(await errCode(res)).toBe("not_waivable");
    expect(db.query("SELECT COUNT(*) c FROM waiver WHERE clause_ref = ?").get(`${BINDING.checklist_id} ${BINDING.item_id}`)).toEqual({ c: 0 });
  });

  test("shadow: not_waivable is recorded as a would-block and the request still files", async () => {
    process.env[gateIntegrityEnvName("waiver")] = "shadow";
    const res = await request({ dd_item: BINDING, reason: REASON, approver_role: "entity-ic-reviewer", expires_at: inDays(30) });
    expect(res.status).toBe(201);
    expect(db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'gate_integrity.would_block:not_waivable'").get()).toEqual({ c: 1 });
  });

  test("enforce: unresolved clause_ref, bad approver_role", async () => {
    process.env[gateIntegrityEnvName("waiver")] = "enforce";
    const unresolved = await request({ clause_ref: "sec-4.2", reason: REASON, approver_role: "entity-ic-reviewer", expires_at: inDays(30) });
    expect(await errCode(unresolved)).toBe("clause_unresolved");
    const unknownItem = await request({ clause_ref: "chk-brownfield-feasibility-checklist bf-99", reason: REASON, approver_role: "entity-ic-reviewer", expires_at: inDays(30) });
    expect(await errCode(unknownItem)).toBe("clause_unresolved");
    const role = await request({ dd_item: WAIVABLE, reason: REASON, approver_role: "pgm", expires_at: inDays(30) });
    expect(await errCode(role)).toBe("approver_role_invalid");
  });

  test("enforce (rationale family): a thin waiver reason is 422 rationale_insufficient; the defaulted dd_item reason too", async () => {
    process.env[gateIntegrityEnvName("rationale")] = "enforce";
    const thin = await request({ dd_item: WAIVABLE, reason: "면제 요청", approver_role: "entity-ic-reviewer", expires_at: inDays(30) });
    expect(thin.status).toBe(422);
    expect(await errCode(thin)).toBe("rationale_insufficient");
    const defaulted = await request({ dd_item: nextItem(), approver_role: "entity-ic-reviewer", expires_at: inDays(30) });
    expect(await errCode(defaulted)).toBe("rationale_insufficient");
    const good = await request({ dd_item: nextItem(), reason: REASON, approver_role: "entity-ic-reviewer", expires_at: inDays(30) });
    expect(good.status).toBe(201);
  });

  test("approved_by in the body NEVER confers authority in any mode: the request stays pending and findActiveWaiver is null", async () => {
    for (const mode of [null, "shadow", "enforce"] as const) {
      if (mode) process.env[gateIntegrityEnvName("waiver")] = mode; else delete process.env[gateIntegrityEnvName("waiver")];
      const item = nextItem();
      const res = await request({ dd_item: item, reason: REASON, approver_role: "entity-ic-reviewer", expires_at: inDays(30), approved_by: "someone" });
      const data = ((await res.json()) as { data: { id: string; status: string } }).data;
      expect(data.status, String(mode)).toBe("pending");
      expect(row(data.id)).toMatchObject({ status: "pending", approved_by: null, approved_at: null });
      expect(findActiveWaiver(db, { projectId, governanceDocId: docId, clauseRef: `${item.checklist_id} ${item.item_id}`, now: new Date().toISOString() })).toBeNull();
    }
    expect(db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'waiver.approved_by_ignored'").get().c).toBeGreaterThanOrEqual(3);
    process.env[gateIntegrityEnvName("waiver")] = "enforce";
    process.env.CO_NEWBIZ_WAIVER_APPROVED_BY_COMPAT = "0";
    const rejected = await request({ dd_item: nextItem(), reason: REASON, approver_role: "entity-ic-reviewer", expires_at: inDays(30), approved_by: "someone" });
    expect(rejected.status).toBe(400);
    expect(await errCode(rejected)).toBe("approved_by_removed");
  });
});

describe("approval (POST /waivers/:id/approve)", () => {
  test("a grant holder who is not the requester approves; approver and approved_at are the authenticated user and now; findActiveWaiver returns it", async () => {
    const id = await pendingWaiver();
    const res = await approve(id, APPROVER);
    expect(res.status).toBe(200);
    const r = row(id);
    expect(r.status).toBe("active");
    expect(r.approved_by).toBe(APPROVER);
    expect(r.approved_at).not.toBeNull();
    const clause = `${WAIVABLE.checklist_id} ${WAIVABLE.item_id}`;
    const clauseRows = db.query("SELECT clause_ref FROM waiver WHERE id = ?").get(id) as { clause_ref: string };
    expect(clauseRows.clause_ref).toBe(clause);
    const active = findActiveWaiver(db, { projectId, governanceDocId: docId, clauseRef: clause, now: new Date().toISOString() });
    expect(active?.id).toBe(id);
    expect(db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'waiver.approve' AND target = ?").get(`${projectId}:${id}`)).toEqual({ c: 1 });
  });

  test("self-approval is refused even for a grant holder", async () => {
    // the approver files and tries to approve their own request
    const res = await request({ dd_item: nextItem(), reason: REASON, approver_role: "entity-ic-reviewer", expires_at: inDays(30) }, APPROVER);
    const id = ((await res.json()) as { data: { id: string } }).data.id;
    const denied = await approve(id, APPROVER);
    expect(denied.status).toBe(403);
    expect(await errCode(denied)).toBe("approver_must_differ");
    expect(row(id).status).toBe("pending");
    expect(row(id).approved_at).toBeNull();
  });

  test("a user without the grant is 403 human_role_required (deny-by-default); a revoked grant too", async () => {
    const id = await pendingWaiver({ dd_item: nextItem() });
    const none = await approve(id, OTHER);
    expect(none.status).toBe(403);
    expect(await errCode(none)).toBe("human_role_required");
    const grantId = issueHumanRoleGrant(db, { userId: OTHER, roleKey: "entity-ic-reviewer", grantedBy: "wh-admin", now: S.NOW });
    db.run("UPDATE app_user_human_role SET revoked_at = ?, revoked_by = 'wh-admin' WHERE id = ?", [S.NOW, grantId]);
    expect(await errCode(await approve(id, OTHER))).toBe("human_role_required");
    expect(row(id).status).toBe("pending");
  });

  test("a grant of the WRONG role does not approve (group-ic-reviewer holder cannot approve an entity-ic-reviewer request)", async () => {
    const grp = "wh-group";
    await createUser(db, { userId: grp, role: "analyst", password: "pw-wh-group-12345", createdBy: "test", now: S.NOW });
    approveUser(db, { userId: grp, approvedBy: "test", now: S.NOW });
    db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [grp]);
    cookies[grp] = await login(grp, "pw-wh-group-12345");
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, grp, "lead", "test", S.NOW, "waiver test"]);
    issueHumanRoleGrant(db, { userId: grp, roleKey: "group-ic-reviewer", grantedBy: "wh-admin", now: S.NOW });
    const id = await pendingWaiver({ dd_item: nextItem() });
    expect(await errCode(await approve(id, grp))).toBe("human_role_required");
    const gid = await pendingWaiver({ dd_item: nextItem(), approver_role: "group-ic-reviewer" });
    expect((await approve(gid, grp)).status).toBe(200);
  });

  test("over-90-day terms are refused at approval (422 waiver_term_too_long); exactly 90 days passes", async () => {
    const long = await pendingWaiver({ dd_item: nextItem(), expires_at: inDays(91) });
    const denied = await approve(long, APPROVER);
    expect(denied.status).toBe(422);
    expect(await errCode(denied)).toBe("waiver_term_too_long");
    expect(row(long).status).toBe("pending");
    const edge = await pendingWaiver({ dd_item: nextItem(), expires_at: new Date(Date.now() + 90 * DAY - 60_000).toISOString() });
    expect((await approve(edge, APPROVER)).status).toBe(200);
  });

  test("not-pending waivers cannot be approved again; unknown waiver and outsiders are 404", async () => {
    const id = await pendingWaiver({ dd_item: nextItem() });
    expect((await approve(id, APPROVER)).status).toBe(200);
    expect((await approve(id, APPROVER)).status).toBe(400);
    expect((await approve("nope", APPROVER)).status).toBe(404);
    const other = await pendingWaiver({ dd_item: nextItem() });
    expect((await approve(other, OUTSIDER)).status).toBe(404); // not a project member: deny-by-default visibility
  });

  test("bearer tokens (valid or not) are rejected with 403 human_only - a grant is exercised from a cookie session only", async () => {
    const id = await pendingWaiver({ dd_item: nextItem() });
    const { token } = issueApiToken(db, { userId: APPROVER, label: "wh-test", scopes: ["read", "write"], now: S.NOW });
    const res = await nextRequest(`/api/projects/${projectId}/waivers/${id}/approve`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect(await errCode(res)).toBe("human_only");
    const junk = await nextRequest(`/api/projects/${projectId}/waivers/${id}/approve`, { method: "POST", headers: { authorization: "Bearer cnb_not-a-token" } });
    expect(junk.status).toBe(403);
    expect(row(id).status).toBe("pending");
  });

  test("CSRF is enforced like every cookie mutation, and the route is rate-limited", async () => {
    const id = await pendingWaiver({ dd_item: nextItem() });
    const noCsrf = await nextRequest(`/api/projects/${projectId}/waivers/${id}/approve`, {
      method: "POST",
      headers: { cookie: `${cookies[APPROVER]}; co_newbiz_csrf=right`, "x-csrf-token": "wrong", origin: "http://localhost" },
    });
    expect(noCsrf.status).toBe(403);
    expect(await errCode(noCsrf)).toBe("csrf_token_mismatch");
    const crossOrigin = await nextRequest(`/api/projects/${projectId}/waivers/${id}/approve`, {
      method: "POST",
      headers: { cookie: `${cookies[APPROVER]}; co_newbiz_csrf=t`, "x-csrf-token": "t", origin: "http://evil.example", host: "localhost" },
    });
    expect(crossOrigin.status).toBe(403);
    expect(await errCode(crossOrigin)).toBe("csrf_rejected");
    // rate limit: 60 per user per hour
    let last = 0;
    for (let i = 0; i < 62; i++) last = (await approve("nope", APPROVER)).status;
    expect(last).toBe(429);
  });
});

describe("PATCH /waivers/:id (legacy approve path)", () => {
  const patch = (id: string, who: string, decision = "approve") =>
    nextRequest(`/api/projects/${projectId}/waivers/${id}`, { method: "PATCH", headers: { cookie: cookies[who] }, body: JSON.stringify({ decision }) });

  test("off: a different person approves; the requester can NEVER approve their own request (all modes)", async () => {
    const id = await pendingWaiver({ dd_item: nextItem() });
    const self = await patch(id, REQUESTER);
    expect(self.status).toBe(403);
    expect(await errCode(self)).toBe("approver_must_differ");
    expect(row(id).status).toBe("pending");
    expect((await patch(id, OTHER)).status).toBe(200);
  });

  test("an already-expired request cannot be approved", async () => {
    const id = await pendingWaiver({ dd_item: nextItem() });
    db.run("UPDATE waiver SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000).toISOString(), id]);
    expect((await patch(id, OTHER)).status).toBe(400);
    expect(row(id).status).toBe("pending");
  });

  test("shadow: still approves, and records the would-block", async () => {
    process.env[gateIntegrityEnvName("waiver")] = "shadow";
    const id = await pendingWaiver({ dd_item: nextItem() });
    expect((await patch(id, OTHER)).status).toBe(200);
    expect(db.query("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'gate_integrity.would_block:%' AND target = ?").get(`project:${projectId}:waiver_approve`).c).toBeGreaterThanOrEqual(1);
  });

  test("enforce: the same rules as /approve - requester refused, grant holder accepted; reject and revoke stay as before", async () => {
    process.env[gateIntegrityEnvName("waiver")] = "enforce";
    const id = await pendingWaiver({ dd_item: nextItem() });
    expect((await patch(id, REQUESTER)).status).toBe(403);
    expect(row(id).status).toBe("pending");
    expect((await patch(id, APPROVER)).status).toBe(200);
    expect(row(id).approved_by).toBe(APPROVER);
    expect((await patch(id, REQUESTER, "revoke")).status).toBe(200);
    const id2 = await pendingWaiver({ dd_item: nextItem() });
    expect((await patch(id2, REQUESTER, "reject")).status).toBe(200);
  });
});

describe("engine: issueWaiver", () => {
  test("an immediately approved waiver carries approved_at and is returned by findActiveWaiver", () => {
    const id = issueWaiver(db, { projectId, governanceDocId: docId, clauseRef: "engine-clause", reason: "r", requestedBy: "a", approverRole: "entity-ic-reviewer", expiresAt: inDays(10), approvedBy: "b", now: new Date().toISOString() });
    const r = row(id);
    expect(r.status).toBe("active");
    expect(r.approved_at).not.toBeNull();
    expect(findActiveWaiver(db, { projectId, governanceDocId: docId, clauseRef: "engine-clause", now: new Date().toISOString() })?.id).toBe(id);
    // a pending request has no approved_at and is not active
    const pending = issueWaiver(db, { projectId, governanceDocId: docId, clauseRef: "engine-clause-2", reason: "r", requestedBy: "a", approverRole: "entity-ic-reviewer", expiresAt: inDays(10), now: new Date().toISOString() });
    expect(row(pending).approved_at).toBeNull();
    expect(findActiveWaiver(db, { projectId, governanceDocId: docId, clauseRef: "engine-clause-2", now: new Date().toISOString() })).toBeNull();
    void ulid;
  });
});
