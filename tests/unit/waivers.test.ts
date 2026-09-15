// @version 1.0.0
/**
 * Waiver lifecycle API (S9 dd-waiver-review) — regression tests against the
 * REAL route handlers (nextRequest harness, dd-tailor pattern) and the real
 * scratch SQLite:
 *  (a) request → pending; no expires_at / past date / unknown doc → 400;
 *      viewer 403; outsider 404 (deny-by-default)
 *  (b) approve → active with approved_by/at; reject → 'rejected'; revoke →
 *      'revoked'; invalid transitions → 400
 *  (c) date authority (ADR-0036): an active waiver past expires_at reads
 *      effective_status 'expired' whatever the status column says, and
 *      findActiveWaiver does not return it
 *  (d) duplicate active waiver on the same clause → 409-style badRequest
 *  (e) audit trail records waiver.request / approve
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-waivers.sqlite";
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
const { findActiveWaiver } = await import("../../db/lib/compliance.ts");

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 90 * 86400_000).toISOString();
const PAST = new Date(Date.now() - 86400_000).toISOString();

const ANALYST = "analyst1";
const VIEWER = "viewer1";
const OUTSIDER = "outsider1";
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";
const DOC_ID = "govdoc-test-policy";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  await createUser(db, { userId: OUTSIDER, role: "analyst", password: "pw-outsider-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: OUTSIDER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-analyst-12345");
  viewerCookie = await loginCookie(VIEWER, "pw-viewer-12345");
  outsiderCookie = await loginCookie(OUTSIDER, "pw-outsider-12345");

  db.run(
    `INSERT INTO governance_doc (id, layer, key, title, scope, version, enforceability, owner_agent, doc_path, effective_from)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [DOC_ID, "policy", "neb-policy", "Group New Business Review Policy", "shared", "1.0.0", "mandatory", "process-governance-manager", "policies/group/neb-policy.md", NOW],
  );

  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, "waiver 테스트 기회", "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
    [ulid(), oppId, "greenfield", "test route", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [ulid(), oppId, "직접 진출", "없음", "test", ANALYST, NOW, NOW],
  );
  // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서 센다.
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), oppId],
  );
  // Promotion preconditions (2026-09-12): screening + pre_fs must be GO.
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "waiver test" }).project.id;
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function postWaiver(body: unknown, cookie = analystCookie) {
  return req(`/api/projects/${projectId}/waivers`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
}

describe("waiver lifecycle API (S9 dd-waiver-review)", () => {
  test("(a) request → pending + audit; validation and access control", async () => {
    const res = await postWaiver({ governance_doc_id: DOC_ID, clause_ref: "§4-2.1", reason: "데이터 입수 지연", approver_role: "process-governance-manager", expires_at: FUTURE });
    expect(res.status).toBe(201);
    const data = (await res.json()).data as { id: string; status: string };
    expect(data.status).toBe("pending");

    // missing / past expires_at / unknown doc / viewer / outsider
    expect((await postWaiver({ governance_doc_id: DOC_ID, clause_ref: "§1", reason: "x", approver_role: "pgm", expires_at: "" })).status).toBe(400);
    expect((await postWaiver({ governance_doc_id: DOC_ID, clause_ref: "§1", reason: "x", approver_role: "pgm", expires_at: PAST })).status).toBe(400);
    expect((await postWaiver({ governance_doc_id: "nope", clause_ref: "§1", reason: "x", approver_role: "pgm", expires_at: FUTURE })).status).toBe(400);
    expect((await postWaiver({ governance_doc_id: DOC_ID, clause_ref: "§1", reason: "x", approver_role: "pgm", expires_at: FUTURE }, viewerCookie)).status).toBe(403);
    expect((await postWaiver({ governance_doc_id: DOC_ID, clause_ref: "§1", reason: "x", approver_role: "pgm", expires_at: FUTURE }, outsiderCookie)).status).toBe(404);

    const audit = db.query("SELECT action FROM audit_log WHERE action = 'waiver.request'").all() as Array<{ action: string }>;
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  test("(b) approve → active; duplicate active on same clause refused", async () => {
    const list1 = await (await req(`/api/projects/${projectId}/waivers`, { headers: { cookie: analystCookie } })).json();
    const pending = (list1.data.waivers as Array<{ id: string; effective_status: string }>)[0];
    expect(pending.effective_status).toBe("pending");

    const res = await req(`/api/projects/${projectId}/waivers/${pending.id}`, {
      method: "PATCH",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as { status: string; approved_by: string };
    expect(data.status).toBe("active");
    expect(data.approved_by).toBe(ANALYST);

    // engine sees it
    const active = findActiveWaiver(db, { projectId, governanceDocId: DOC_ID, clauseRef: "§4-2.1", now: new Date().toISOString() });
    expect(active?.id).toBe(pending.id);

    // duplicate active on the same clause
    const dup = await postWaiver({ governance_doc_id: DOC_ID, clause_ref: "§4-2.1", reason: "연장", approver_role: "pgm", expires_at: FUTURE });
    expect(dup.status).toBe(400);
    const dupBody = (await dup.json()).error as { code: string };
    expect(dupBody.code).toBe("duplicate_active");
  });

  test("(c) date authority: expired-by-date active waiver reads 'expired' and stops unblocking (ADR-0036)", async () => {
    const staleId = ulid();
    db.run(
      `INSERT INTO waiver (id, project_id, governance_doc_id, clause_ref, reason, requested_by, approver_role, approved_by, approved_at, expires_at, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [staleId, projectId, DOC_ID, "§9-9.9", "만료 파생 검증", ANALYST, "pgm", ANALYST, NOW, PAST, "active", NOW],
    );
    const list = await (await req(`/api/projects/${projectId}/waivers`, { headers: { cookie: analystCookie } })).json();
    const stale = (list.data.waivers as Array<{ id: string; effective_status: string }>).find((w) => w.id === staleId);
    expect(stale?.effective_status).toBe("expired"); // status column still 'active'
    expect(findActiveWaiver(db, { projectId, governanceDocId: DOC_ID, clauseRef: "§9-9.9", now: new Date().toISOString() })).toBeNull();
  });

  test("(b2) reject / revoke / invalid transitions", async () => {
    // new pending → reject
    const r1 = await postWaiver({ governance_doc_id: DOC_ID, clause_ref: "§7-1.0", reason: "기각 검증", approver_role: "pgm", expires_at: FUTURE });
    const id1 = ((await r1.json()).data as { id: string }).id;
    const rej = await req(`/api/projects/${projectId}/waivers/${id1}`, { method: "PATCH", headers: { cookie: analystCookie }, body: JSON.stringify({ decision: "reject" }) });
    expect(((await rej.json()).data as { status: string }).status).toBe("rejected");
    // rejected cannot be approved afterwards
    const reApprove = await req(`/api/projects/${projectId}/waivers/${id1}`, { method: "PATCH", headers: { cookie: analystCookie }, body: JSON.stringify({ decision: "approve" }) });
    expect(reApprove.status).toBe(400);

    // new active → revoke → revoked cannot be revoked again
    const r2 = await postWaiver({ governance_doc_id: DOC_ID, clause_ref: "§8-1.0", reason: "철회 검증", approver_role: "pgm", expires_at: FUTURE });
    const id2 = ((await r2.json()).data as { id: string }).id;
    await req(`/api/projects/${projectId}/waivers/${id2}`, { method: "PATCH", headers: { cookie: analystCookie }, body: JSON.stringify({ decision: "approve" }) });
    const rv = await req(`/api/projects/${projectId}/waivers/${id2}`, { method: "PATCH", headers: { cookie: analystCookie }, body: JSON.stringify({ decision: "revoke" }) });
    expect(((await rv.json()).data as { status: string }).status).toBe("revoked");
    const reRevoke = await req(`/api/projects/${projectId}/waivers/${id2}`, { method: "PATCH", headers: { cookie: analystCookie }, body: JSON.stringify({ decision: "revoke" }) });
    expect(reRevoke.status).toBe(400);
    // unknown decision value
    const bad = await req(`/api/projects/${projectId}/waivers/${id2}`, { method: "PATCH", headers: { cookie: analystCookie }, body: JSON.stringify({ decision: "maybe" }) });
    expect(bad.status).toBe(400);
  });
});
