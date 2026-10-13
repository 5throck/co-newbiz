// @version 1.0.0
/**
 * S11 establishment steps — status change, per-step assignee, reopen
 * (ADR-0165, migration 0140). Covers the server-side rules (evidence for
 * done, pending rejected, done immutable via PUT, origin applicability),
 * assignee membership, the reopen reason / dependency / cascade rules, the
 * events + audit trail (one transaction, target "<projectId>#step<n>@<via>"), and
 * the human-only agent boundary.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-establishment-assignee-reopen.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { grantProjectMembership, revokeProjectMembership } = await import("../../db/lib/access-control.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { changeEstablishmentStatus, establishmentProgress } = await import("../../app/web-next/lib/establishment.ts");
const { isHumanOnly, InProcessRestPort } = await import("../../app/web-next/lib/mcp/in-process-port.ts");

const NOW = new Date().toISOString();
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const LEAD = "est-lead";
const MEMBER = "est-member";
const REVOKED = "est-revoked";
const VIEWER = "est-viewer";
const OUTSIDER = "est-outsider";
let leadCookie = "";
let memberCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";
let oppId = "";

const base = () => `/api/projects/${projectId}/establishment`;
const json = (body: unknown) => JSON.stringify(body);
async function put(body: Record<string, unknown>, cookie = leadCookie) {
  return req(base(), { method: "PUT", headers: { cookie }, body: json({ origin: "internal", ...body }) });
}
async function assign(body: Record<string, unknown>, cookie = leadCookie) {
  return req(`${base()}/assignee`, { method: "PUT", headers: { cookie }, body: json(body) });
}
async function reopen(body: Record<string, unknown>, cookie = leadCookie) {
  return req(`${base()}/reopen`, { method: "POST", headers: { cookie }, body: json(body) });
}
async function done(stepNo: number) {
  const res = await put({ step_no: stepNo, status: "done", evidence_url: `https://evidence.example/${stepNo}` });
  expect(res.status).toBe(200);
}
const events = (stepNo: number, kind?: string) =>
  db.query(
    `SELECT * FROM entity_establishment_step_event WHERE project_id = ? AND step_no = ? ${kind ? "AND kind = ?" : ""} ORDER BY created_at, id`,
  ).all(...(kind ? [projectId, stepNo, kind] : [projectId, stepNo])) as Array<Record<string, any>>;
const audits = (action: string, stepNo: number) =>
  (db.query("SELECT COUNT(*) c FROM audit_log WHERE action = ? AND target LIKE ?").get(action, `${projectId}#step${stepNo}@%`) as { c: number }).c;
const stepRow = (stepNo: number) =>
  db.query("SELECT * FROM entity_establishment_step WHERE project_id = ? AND step_no = ?").get(projectId, stepNo) as Record<string, any>;

beforeAll(async () => {
  for (const [id, role] of [[LEAD, "analyst"], [MEMBER, "analyst"], [REVOKED, "analyst"], [VIEWER, "viewer"], [OUTSIDER, "analyst"]] as const) {
    await createUser(db, { userId: id, role, password: `pw-${id}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  db.run("UPDATE app_user SET display_name = '담당 홍길동' WHERE user_id = ?", [MEMBER]);
  leadCookie = await loginCookie(LEAD, `pw-${LEAD}-12345`);
  memberCookie = await loginCookie(MEMBER, `pw-${MEMBER}-12345`);
  viewerCookie = await loginCookie(VIEWER, `pw-${VIEWER}-12345`);
  outsiderCookie = await loginCookie(OUTSIDER, `pw-${OUTSIDER}-12345`);

  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "est 기회", "산업", "selected", LEAD, NOW]);
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, "greenfield", "test", "대안 검토", LEAD, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, "직접 진출", "M&A 대안", "test", LEAD, NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows: [{ id: "g", capability: "g", resolution: "hire" }], updatedAt: NOW }), oppId]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", LEAD, NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: LEAD, needToKnowBasis: "est test" }).project.id;
  db.run("UPDATE md_project SET origin = 'internal', establishment_mode = 'new_entity' WHERE id = ?", [projectId]);
  for (const u of [MEMBER, REVOKED]) {
    grantProjectMembership(db, { projectId, userId: u, projectRole: "member", grantedBy: LEAD, needToKnowBasis: "est test", now: NOW });
  }
  revokeProjectMembership(db, { projectId, userId: REVOKED, revokedBy: LEAD, now: NOW });
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("status change rules (server-side)", () => {
  test("pending is rejected; done requires evidence URL or note; bad URL rejected", async () => {
    expect((await put({ step_no: 1, status: "pending" })).status).toBe(400);
    const noEv = await put({ step_no: 1, status: "done" });
    expect(noEv.status).toBe(400);
    expect((await noEv.json()).error.code).toBe("evidence_required");
    expect((await put({ step_no: 1, status: "done", note: "   " })).status).toBe(400);
    const badUrl = await put({ step_no: 1, status: "done", evidence_url: "javascript:alert(1)" });
    expect(badUrl.status).toBe(400);
    expect((await badUrl.json()).error.code).toBe("invalid_request");
    expect(stepRow(1)).toBeFalsy();
  });

  test("in_progress/halted/escalated need no evidence; each writes an event and audit with #step target", async () => {
    for (const status of ["in_progress", "halted", "escalated", "in_progress"]) {
      expect((await put({ step_no: 1, status })).status).toBe(200);
    }
    const ev = events(1, "status_change");
    expect(ev.map((e) => e.to_status)).toEqual(["in_progress", "halted", "escalated", "in_progress"]);
    expect(ev[0].from_status).toBeNull();
    expect(ev[1].from_status).toBe("in_progress");
    expect(ev.every((e) => e.audit_id && e.actor_user_id === LEAD)).toBe(true);
    expect(audits("entity_establishment.update", 1)).toBe(4);
    expect(audits("entity_establishment.complete", 1)).toBe(0);
  });

  test("done with a note works, audits complete, and a done row is immutable via PUT (409 reopen_required)", async () => {
    expect((await put({ step_no: 1, status: "done", note: "등기부등본 확인 완료" })).status).toBe(200);
    expect(audits("entity_establishment.complete", 1)).toBe(1);
    for (const status of ["in_progress", "halted", "done"]) {
      const res = await put({ step_no: 1, status, note: "x", evidence_url: "https://e.example/x" });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("reopen_required");
    }
    expect(stepRow(1).status).toBe("done");
  });

  test("the opportunity route also refuses to change a done step", async () => {
    const res = await req(`/api/opportunities/${oppId}/establishment`, {
      method: "PUT", headers: { cookie: leadCookie }, body: json({ step_no: 1, status: "in_progress", origin: "internal" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("reopen_required");
  });

  test("step 5 done needs steps 1-4 done (sequence_violation)", async () => {
    const res = await put({ step_no: 5, status: "done", note: "n" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("sequence_violation");
  });

  test("viewer 403, non-member 404, origin mismatch / non internal-joint -> not_applicable", async () => {
    expect((await put({ step_no: 2, status: "in_progress" }, viewerCookie)).status).toBe(403);
    expect((await put({ step_no: 2, status: "in_progress" }, outsiderCookie)).status).toBe(404);
    const mismatch = await put({ step_no: 2, status: "in_progress", origin: "joint" });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error.code).toBe("not_applicable");
    db.run("UPDATE md_project SET origin = 'acquisition' WHERE id = ?", [projectId]);
    try {
      const res = await put({ step_no: 2, status: "in_progress" });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("not_applicable");
      expect((await assign({ step_no: 2, assignee_user_id: MEMBER })).status).toBe(400);
      expect((await reopen({ step_no: 1, reason: "충분히 긴 사유입니다" })).status).toBe(400);
    } finally {
      db.run("UPDATE md_project SET origin = 'internal', establishment_mode = 'new_entity' WHERE id = ?", [projectId]);
    }
  });

  test("a failure inside the transaction rolls back the row, event and audit", () => {
    const auditBefore = (db.query("SELECT COUNT(*) c FROM audit_log").get() as { c: number }).c;
    db.run("CREATE TRIGGER est_fail BEFORE INSERT ON entity_establishment_step_event BEGIN SELECT RAISE(ABORT, 'forced'); END");
    try {
      expect(() =>
        changeEstablishmentStatus(projectId, { step_no: 3, status: "in_progress", origin: "internal" }, LEAD),
      ).toThrow();
    } finally {
      db.run("DROP TRIGGER est_fail");
    }
    expect(stepRow(3)).toBeFalsy();
    expect((db.query("SELECT COUNT(*) c FROM audit_log").get() as { c: number }).c).toBe(auditBefore);
  });
});

describe("assignee", () => {
  test("active member can be assigned; GET shows name, last_recorded_by and members; event + audit written", async () => {
    const res = await assign({ step_no: 2, assignee_user_id: MEMBER, origin: "internal" });
    expect(res.status).toBe(200);
    expect(stepRow(2).status).toBe("pending"); // created as pending, the only sanctioned pending write
    expect(events(2, "assign")).toHaveLength(1);
    expect(audits("entity_establishment.assign", 2)).toBe(1);
    expect(establishmentProgress(projectId).done).toBe(1);

    const get = (await (await req(base(), { headers: { cookie: leadCookie } })).json()).data;
    const s2 = get.steps.find((s: any) => s.step_no === 2);
    expect(s2).toMatchObject({ assignee_user_id: MEMBER, assignee_name: "담당 홍길동", assignee_active: true, last_recorded_by: LEAD, owner: LEAD, reopen_count: 0 });
    expect(get.members.map((m: any) => m.user_id).sort()).toEqual([LEAD, MEMBER].sort());
    expect(get.history.length).toBeGreaterThan(0);
  });

  test("non-member / revoked member / empty -> 400; viewer 403; outsider 404; same assignee is a no-op", async () => {
    for (const bad of [OUTSIDER, REVOKED, "ghost"]) {
      const r = await assign({ step_no: 2, assignee_user_id: bad });
      expect(r.status).toBe(400);
      expect((await r.json()).error.code).toBe("assignee_not_member");
    }
    expect((await assign({ step_no: 2, assignee_user_id: "" })).status).toBe(400);
    expect((await assign({ step_no: 2 })).status).toBe(400);
    expect((await assign({ step_no: 2, assignee_user_id: MEMBER }, viewerCookie)).status).toBe(403);
    expect((await assign({ step_no: 2, assignee_user_id: MEMBER }, outsiderCookie)).status).toBe(404);
    const again = await assign({ step_no: 2, assignee_user_id: MEMBER });
    expect((await again.json()).data.changed).toBe(false);
    expect(events(2, "assign")).toHaveLength(1);
  });

  test("a revoked assignee is flagged inactive on read; null clears; assignment works on a done step", async () => {
    grantProjectMembership(db, { projectId, userId: REVOKED, projectRole: "member", grantedBy: LEAD, needToKnowBasis: "tmp", now: NOW });
    expect((await assign({ step_no: 4, assignee_user_id: REVOKED })).status).toBe(200);
    revokeProjectMembership(db, { projectId, userId: REVOKED, revokedBy: LEAD, now: NOW });
    let get = (await (await req(base(), { headers: { cookie: leadCookie } })).json()).data;
    expect(get.steps.find((s: any) => s.step_no === 4)).toMatchObject({ assignee_user_id: REVOKED, assignee_active: false });
    expect((await assign({ step_no: 4, assignee_user_id: null })).status).toBe(200);
    expect(stepRow(4).assignee_user_id).toBeNull();
    expect(events(4, "assign").map((e) => e.to_assignee)).toEqual([REVOKED, null]);

    // step 1 is done; reassigning does not touch completion.
    expect((await assign({ step_no: 1, assignee_user_id: MEMBER })).status).toBe(200);
    expect(stepRow(1)).toMatchObject({ status: "done", assignee_user_id: MEMBER });
    get = (await (await req(base(), { headers: { cookie: leadCookie } })).json()).data;
    expect(get.progress).toBe("1/5");
  });

  test("PUT status change can carry an assignee (same membership rules, one assign event)", async () => {
    expect((await put({ step_no: 3, status: "in_progress", assignee_user_id: OUTSIDER })).status).toBe(400);
    expect((await put({ step_no: 3, status: "in_progress", assignee_user_id: MEMBER })).status).toBe(200);
    expect(events(3, "assign")).toHaveLength(1);
    expect(events(3, "status_change")).toHaveLength(1);
  });
});

describe("reopen", () => {
  test("reason missing/short -> 400; not done -> 409 not_done; viewer 403; outsider 404", async () => {
    expect((await reopen({ step_no: 1 })).status).toBe(400);
    expect((await reopen({ step_no: 1, reason: "짧음" })).status).toBe(400);
    const nd = await reopen({ step_no: 3, reason: "충분히 긴 재개 사유입니다" });
    expect(nd.status).toBe(409);
    expect((await nd.json()).error.code).toBe("not_done");
    expect((await reopen({ step_no: 1, reason: "충분히 긴 재개 사유입니다" }, viewerCookie)).status).toBe(403);
    expect((await reopen({ step_no: 1, reason: "충분히 긴 재개 사유입니다" }, outsiderCookie)).status).toBe(404);
    expect(stepRow(1).status).toBe("done");
  });

  test("reopening step 1 clears row evidence, snapshots it in the event, updates owner, drops progress", async () => {
    const before = stepRow(1);
    expect(before.evidence_url).toBeNull(); // step 1 was completed with a note only
    const res = await reopen({ step_no: 1, reason: "등기 내용 정정으로 재개합니다" }, memberCookie);
    expect(res.status).toBe(200);
    const row = stepRow(1);
    expect(row).toMatchObject({ status: "in_progress", evidence_url: null, owner: MEMBER, note: "등기부등본 확인 완료" });
    const ev = events(1, "reopen");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ from_status: "done", to_status: "in_progress", reason: "등기 내용 정정으로 재개합니다", actor_user_id: MEMBER });
    expect(audits("entity_establishment.reopen", 1)).toBe(1);
    expect(establishmentProgress(projectId).done).toBe(0);
    const s1 = (await (await req(base(), { headers: { cookie: leadCookie } })).json()).data.steps.find((s: any) => s.step_no === 1);
    expect(s1.reopen_count).toBe(1);
  });

  test("evidence snapshot: a step completed with a URL keeps it only in the reopen event", async () => {
    await done(2); // step 2 row exists as pending with assignee
    expect(stepRow(2).evidence_url).toBe("https://evidence.example/2");
    expect((await reopen({ step_no: 2, reason: "증적 교체가 필요하여 재개" })).status).toBe(200);
    expect(stepRow(2).evidence_url).toBeNull();
    expect(events(2, "reopen")[0].evidence_url).toBe("https://evidence.example/2");
    expect(stepRow(2).assignee_user_id).toBe(MEMBER); // assignee survives a reopen
  });

  test("steps 1-4 while step 5 is done: 409 dependent_step_done, then cascade reopens both with two events/audits", async () => {
    for (const n of [1, 2, 3, 4, 5]) await done(n);
    expect(establishmentProgress(projectId)).toMatchObject({ done: 5, complete: true });

    const refused = await reopen({ step_no: 3, reason: "인허가 분류 재검토 필요" });
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error.code).toBe("dependent_step_done");
    expect(body.data.dependent_steps).toEqual([5]);
    expect(stepRow(3).status).toBe("done");
    expect(stepRow(5).status).toBe("done");

    const ok = await reopen({ step_no: 3, reason: "인허가 분류 재검토 필요", cascade_step5: true });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.reopened.map((r: any) => [r.step_no, r.cascade])).toEqual([[3, false], [5, true]]);
    expect(stepRow(3).status).toBe("in_progress");
    expect(stepRow(5).status).toBe("in_progress");
    expect(events(3, "reopen")).toHaveLength(1);
    expect(events(5, "reopen")).toHaveLength(1);
    expect(audits("entity_establishment.reopen", 3)).toBe(1);
    expect(audits("entity_establishment.reopen_cascade", 5)).toBe(1);
    expect(establishmentProgress(projectId)).toMatchObject({ done: 3, complete: false });
  });

  test("reopening step 5 alone is always allowed; reopen then re-complete requires fresh evidence", async () => {
    await done(3);
    await done(5);
    expect((await reopen({ step_no: 5, reason: "거버넌스 베이스라인 재확인" })).status).toBe(200);
    expect(stepRow(5).status).toBe("in_progress");
    expect(stepRow(3).status).toBe("done");
    expect((await put({ step_no: 5, status: "done" })).status).toBe(400); // evidence cleared; needs new evidence
    await done(5);
  });
});

describe("agent boundary (HUMAN_ONLY_ROUTES)", () => {
  test("done, assignment and reopen are human-only; in_progress/halted/escalated are not", () => {
    expect(isHumanOnly("PUT", `/api/projects/${projectId}/establishment`, { status: "done" })).toBe(true);
    expect(isHumanOnly("PUT", `/api/opportunities/${oppId}/establishment`, { status: "done" })).toBe(true);
    for (const status of ["in_progress", "halted", "escalated"]) {
      expect(isHumanOnly("PUT", `/api/projects/${projectId}/establishment`, { status })).toBe(false);
    }
    expect(isHumanOnly("PUT", `/api/projects/${projectId}/establishment/assignee`, {})).toBe(true);
    expect(isHumanOnly("POST", `/api/projects/${projectId}/establishment/reopen`, {})).toBe(true);
  });

  test("the in-process port refuses an agent's done and accepts halted", async () => {
    const port = new InProcessRestPort({ userId: LEAD, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    const refused = await port.put(base(), { step_no: 4, status: "done", origin: "internal", note: "x" });
    expect(refused.error?.code).toBe("human_only");
    expect((await reopen({ step_no: 4, reason: "에이전트 중단 신호 테스트용 재개", cascade_step5: true })).status).toBe(200);
    const halted = await port.put(base(), { step_no: 4, status: "halted", origin: "internal", note: "허가 지연" });
    expect(halted.error).toBeNull();
    expect(stepRow(4).status).toBe("halted");
  });

  test("assign resolves the existing row even when it carries a checklist_item; GET hides a stray duplicate", async () => {
    let real = db.query("SELECT id FROM entity_establishment_step WHERE project_id = ? AND step_no = 3").get(projectId) as { id: string } | null;
    if (!real) {
      real = { id: ulid() };
      db.run(
        `INSERT INTO entity_establishment_step (id, opportunity_id, project_id, step_no, status, origin, checklist_item, evidence_url, owner, updated_at)
         VALUES (?,?,?,3,'done','internal','seeded item','https://evidence.example/3','seed',?)`,
        [real.id, oppId, projectId, NOW],
      );
    }
    const realId = real.id;
    db.run("UPDATE entity_establishment_step SET status='done', checklist_item='seeded item', assignee_user_id=NULL WHERE id = ?", [realId]);
    const before = (db.query("SELECT COUNT(*) c FROM entity_establishment_step WHERE project_id = ? AND step_no = 3").get(projectId) as { c: number }).c;
    const res = await assign({ step_no: 3, assignee_user_id: MEMBER });
    expect(res.status).toBe(200);
    const rows = db.query("SELECT id, assignee_user_id FROM entity_establishment_step WHERE project_id = ? AND step_no = 3").all(projectId) as Array<Record<string, any>>;
    expect(rows.length).toBe(before);
    expect(rows[0].id).toBe(realId);
    expect(rows[0].assignee_user_id).toBe(MEMBER);

    // Pre-existing stray pending duplicate (the reported bug): hidden, assign hits the real row.
    const strayId = ulid();
    db.run(
      `INSERT INTO entity_establishment_step (id, opportunity_id, project_id, step_no, status, origin, checklist_item, owner, updated_at, assignee_user_id)
       VALUES (?,?,?,3,'pending','internal',NULL,'seed',?,?)`,
      [strayId, oppId, projectId, NOW, LEAD],
    );
    const { listEstablishmentSteps } = await import("../../app/web-next/lib/establishment.ts");
    const listed = listEstablishmentSteps(projectId).filter((r) => r.step_no === 3);
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(realId);
    expect(listed[0].status).toBe("done");
    expect((await assign({ step_no: 3, assignee_user_id: null })).status).toBe(200);
    expect((db.query("SELECT assignee_user_id a FROM entity_establishment_step WHERE id = ?").get(realId) as any).a).toBeNull();
    expect((db.query("SELECT COUNT(*) c FROM entity_establishment_step WHERE project_id = ? AND step_no = 3").get(projectId) as { c: number }).c).toBe(before + 1);
    db.run("DELETE FROM entity_establishment_step WHERE id = ?", [strayId]);
  });
});
