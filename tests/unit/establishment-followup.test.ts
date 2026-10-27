// @version 1.0.0
/**
 * ADR-0165 follow-up implementation (2026-10-13, DEC-20261013-09, migration 0141):
 *  (1) reopen / assign notifications to the project lead(s) and the assignee (never the actor), deduped;
 *  (2) the server field reopened_after_gate (GET /establishment, IC package, process-flow);
 *  (3) the call path (`via`) on the event row and the audit target;
 *  (4) human-only is enforced on REST itself — a bearer token or agent account gets 403 human_only
 *      for done / assignee / reopen, while in_progress stays open to bearer callers.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-establishment-followup.sqlite");
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
const { grantProjectMembership, revokeProjectMembership } = await import("../../db/lib/access-control.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { reopenedAfterGate } = await import("../../app/web-next/lib/establishment.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { InProcessRestPort } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const { AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");

const NOW = new Date().toISOString();
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const LEAD = "fu-lead";
const ACTOR = "fu-actor";
const ASSIGNEE = "fu-assignee";
const GONE = "fu-gone";
const AGENT = [...AGENT_KEYS][0] as string;
let leadCookie = "";
let actorCookie = "";
let agentCookie = "";
let bearer = "";
let projectId = "";
let oppId = "";

const base = () => `/api/projects/${projectId}/establishment`;
const json = (body: unknown) => JSON.stringify(body);
const put = (body: Record<string, unknown>, headers: Record<string, string>) =>
  req(base(), { method: "PUT", headers, body: json({ origin: "internal", ...body }) });
const assign = (body: Record<string, unknown>, headers: Record<string, string>) =>
  req(`${base()}/assignee`, { method: "PUT", headers, body: json(body) });
const reopen = (body: Record<string, unknown>, headers: Record<string, string>) =>
  req(`${base()}/reopen`, { method: "POST", headers, body: json(body) });
const asActor = () => ({ cookie: actorCookie });
const asLead = () => ({ cookie: leadCookie });
const asBearer = () => ({ authorization: `Bearer ${bearer}` });

async function done(stepNo: number, headers: Record<string, string> = asActor()) {
  const res = await put({ step_no: stepNo, status: "done", evidence_url: `https://evidence.example/${stepNo}` }, headers);
  expect(res.status).toBe(200);
}
async function ensureDone(...steps: number[]) {
  for (const n of steps) {
    const row = db.query("SELECT status FROM entity_establishment_step WHERE project_id = ? AND step_no = ?").get(projectId, n) as { status: string } | null;
    if (row?.status !== "done") await done(n);
  }
}
const events = (stepNo: number, kind?: string) =>
  db.query(
    `SELECT * FROM entity_establishment_step_event WHERE project_id = ? AND step_no = ? ${kind ? "AND kind = ?" : ""} ORDER BY created_at, id`,
  ).all(...(kind ? [projectId, stepNo, kind] : [projectId, stepNo])) as Array<Record<string, any>>;
const notes = (userId: string, type?: string) =>
  db.query(
    `SELECT * FROM notification WHERE user_id = ? AND project_id = ? ${type ? "AND trigger_type = ?" : "AND trigger_type LIKE 'establishment_step_%'"} ORDER BY sent_at, id`,
  ).all(...(type ? [userId, projectId, type] : [userId, projectId])) as Array<Record<string, any>>;

beforeAll(async () => {
  for (const id of [LEAD, ACTOR, ASSIGNEE, GONE, AGENT]) {
    await createUser(db, { userId: id, role: "analyst", password: `pw-${id}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  db.run("UPDATE app_user SET display_name = '실행 담당자' WHERE user_id = ?", [ACTOR]);
  leadCookie = await loginCookie(LEAD, `pw-${LEAD}-12345`);
  actorCookie = await loginCookie(ACTOR, `pw-${ACTOR}-12345`);
  agentCookie = await loginCookie(AGENT, `pw-${AGENT}-12345`);
  bearer = issueApiToken(db, { userId: ACTOR, label: "followup", scopes: ["read", "write"], now: NOW }).token;

  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "followup 기회", "산업", "selected", LEAD, NOW]);
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
  projectId = promoteOpportunity(oppId, { promotedBy: LEAD, needToKnowBasis: "followup test" }).project.id;
  db.run("UPDATE md_project SET origin = 'internal', establishment_mode = 'new_entity' WHERE id = ?", [projectId]);
  for (const u of [ACTOR, ASSIGNEE, GONE, AGENT]) {
    grantProjectMembership(db, { projectId, userId: u, projectRole: "member", grantedBy: LEAD, needToKnowBasis: "followup test", now: NOW });
  }
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("(4) human-only is enforced on REST itself", () => {
  test("a bearer token cannot complete, assign or reopen; in_progress stays open to it", async () => {
    const doneRes = await put({ step_no: 1, status: "done", evidence_url: "https://evidence.example/1" }, asBearer());
    expect(doneRes.status).toBe(403);
    expect((await doneRes.json()).error.code).toBe("human_only");
    const asg = await assign({ step_no: 1, assignee_user_id: ASSIGNEE }, asBearer());
    expect(asg.status).toBe(403);
    expect((await asg.json()).error.code).toBe("human_only");
    const reo = await reopen({ step_no: 1, reason: "bearer 토큰으로 재개 시도" }, asBearer());
    expect(reo.status).toBe(403);
    expect((await reo.json()).error.code).toBe("human_only");
    expect(events(1)).toHaveLength(0); // nothing was written

    const prog = await put({ step_no: 1, status: "in_progress", note: "진행 중" }, asBearer());
    expect(prog.status).toBe(200);
    expect(events(1)[0].via).toBe("api");
  });

  test("an agent-registry account with a cookie session is refused too", async () => {
    const r = await put({ step_no: 2, status: "done", note: "x" }, { cookie: agentCookie });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("human_only");
    expect((await assign({ step_no: 2, assignee_user_id: ASSIGNEE }, { cookie: agentCookie })).status).toBe(403);
    expect((await reopen({ step_no: 2, reason: "에이전트 계정 재개 시도" }, { cookie: agentCookie })).status).toBe(403);
  });

  test("the legacy opportunity route refuses a bearer done as well", async () => {
    const r = await req(`/api/opportunities/${oppId}/establishment`, {
      method: "PUT", headers: asBearer(), body: json({ step_no: 1, status: "done", origin: "internal", note: "x" }),
    });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("human_only");
  });

  test("the MCP in-process principal keeps being refused by the port (and by the route)", async () => {
    const port = new InProcessRestPort({ userId: ACTOR, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    expect((await port.put(base(), { step_no: 3, status: "done", origin: "internal", note: "x" })).error?.code).toBe("human_only");
    expect((await port.post(`${base()}/reopen`, { step_no: 3, reason: "에이전트 재개 시도 테스트" })).error?.code).toBe("human_only");
  });
});

describe("(3) call path on the event row and the audit target", () => {
  test("ui / api / mcp are recorded for status, assign and reopen; old rows default to unknown", async () => {
    // ui: cookie session
    const ui = await put({ step_no: 2, status: "in_progress", note: "ui" }, asActor());
    expect(ui.status).toBe(200);
    expect(events(2, "status_change").at(-1)!.via).toBe("ui");
    const auditUi = db.query("SELECT target FROM audit_log WHERE action = 'entity_establishment.update' AND target = ?").get(`${projectId}#step2@ui`);
    expect(auditUi).not.toBeNull();

    // mcp: in-process delegated principal (agents may record halted)
    const port = new InProcessRestPort({ userId: ACTOR, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    expect((await port.put(base(), { step_no: 2, status: "halted", origin: "internal", note: "허가 지연" })).error).toBeNull();
    expect(events(2, "status_change").at(-1)!.via).toBe("mcp");
    expect(db.query("SELECT 1 FROM audit_log WHERE target = ?").get(`${projectId}#step2@mcp`)).not.toBeNull();

    // ui: assign + done + reopen
    expect((await assign({ step_no: 2, assignee_user_id: ASSIGNEE }, asActor())).status).toBe(200);
    expect(events(2, "assign").at(-1)!.via).toBe("ui");
    await done(2);
    expect(events(2, "status_change").at(-1)!.via).toBe("ui");
    expect((await reopen({ step_no: 2, reason: "증적 보완이 필요합니다" }, asActor())).status).toBe(200);
    expect(events(2, "reopen").at(-1)!.via).toBe("ui");
    expect(db.query("SELECT 1 FROM audit_log WHERE action = 'entity_establishment.reopen' AND target = ?").get(`${projectId}#step2@ui`)).not.toBeNull();

    // history exposes it
    const get = await req(base(), { headers: asActor() });
    const hist = (await get.json()).data.history as Array<{ via: string }>;
    expect(hist.map((h) => h.via)).toContain("mcp");
    expect(hist.every((h) => ["ui", "api", "mcp", "unknown"].includes(h.via))).toBe(true);
  });

  test("a caller that does not state it is recorded as unknown", () => {
    const row = db.query("SELECT id FROM entity_establishment_step WHERE project_id = ? AND step_no = 2").get(projectId) as { id: string };
    db.run(
      `INSERT INTO entity_establishment_step_event (id, step_id, project_id, step_no, kind, to_status, actor_user_id, created_at)
       VALUES (?,?,?,2,'status_change','in_progress','x',?)`,
      [ulid(), row.id, projectId, NOW],
    );
    expect(events(2).find((e) => e.actor_user_id === "x")!.via).toBe("unknown");
  });
});

describe("(1) reopen / assign notifications", () => {
  test("assignment notifies the new assignee only, never the actor or the lead", async () => {
    const before = notes(ASSIGNEE, "establishment_step_assigned").length;
    expect((await assign({ step_no: 4, assignee_user_id: ASSIGNEE }, asActor())).status).toBe(200);
    const n = notes(ASSIGNEE, "establishment_step_assigned");
    expect(n).toHaveLength(before + 1);
    expect(n.at(-1)!.severity).toBe("info");
    const payload = JSON.parse(n.at(-1)!.payload);
    expect(payload.message).toContain("4단계");
    expect(payload.actor_user_id).toBe(ACTOR);
    expect(payload.via).toBe("ui");
    expect(payload.href).toBe(`/deals/${projectId}/s11`);
    expect(notes(ACTOR)).toHaveLength(0);
    expect(notes(LEAD, "establishment_step_assigned")).toHaveLength(0);
    // re-assigning the same person is a no-op: no event, no second notification
    expect((await assign({ step_no: 4, assignee_user_id: ASSIGNEE }, asActor())).status).toBe(200);
    expect(notes(ASSIGNEE, "establishment_step_assigned")).toHaveLength(before + 1);
    // clearing notifies nobody
    expect((await assign({ step_no: 4, assignee_user_id: null }, asActor())).status).toBe(200);
    expect(notes(ASSIGNEE, "establishment_step_assigned")).toHaveLength(before + 1);
  });

  test("reopen notifies the lead and the step's assignee, not the actor; payload carries the reason", async () => {
    expect((await assign({ step_no: 3, assignee_user_id: ASSIGNEE }, asActor())).status).toBe(200);
    await ensureDone(3);
    const leadBefore = notes(LEAD, "establishment_step_reopened").length;
    const asgBefore = notes(ASSIGNEE, "establishment_step_reopened").length;
    const res = await reopen({ step_no: 3, reason: "인허가 분류를 다시 검토해야 합니다" }, asActor());
    expect(res.status).toBe(200);
    const lead = notes(LEAD, "establishment_step_reopened");
    const asg = notes(ASSIGNEE, "establishment_step_reopened");
    expect(lead).toHaveLength(leadBefore + 1);
    expect(asg).toHaveLength(asgBefore + 1);
    expect(notes(ACTOR, "establishment_step_reopened")).toHaveLength(0);
    const p = JSON.parse(lead.at(-1)!.payload);
    expect(lead.at(-1)!.severity).toBe("warning");
    expect(p.message).toContain("3단계");
    expect(p.message).toContain("인허가 분류를 다시 검토해야 합니다");
    expect(p.step_nos).toEqual([3]);
    expect(p.actor_name).toBe("실행 담당자");
    expect(lead.at(-1)!.dedupe_key).toBe(`establishment:${p.event_id}`);
  });

  test("a cascade reopen is one act: one notification per recipient listing both steps", async () => {
    await ensureDone(1, 2, 3, 4, 5);
    const leadBefore = notes(LEAD, "establishment_step_reopened").length;
    const asgBefore = notes(ASSIGNEE, "establishment_step_reopened").length;
    expect((await reopen({ step_no: 3, reason: "연쇄 재개 알림 확인용 사유", cascade_step5: true }, asActor())).status).toBe(200);
    const lead = notes(LEAD, "establishment_step_reopened");
    expect(lead).toHaveLength(leadBefore + 1);
    expect(JSON.parse(lead.at(-1)!.payload).step_nos).toEqual([3, 5]);
    expect(notes(ASSIGNEE, "establishment_step_reopened")).toHaveLength(asgBefore + 1); // step 3 assignee
  });

  test("the lead is not told about their own reopen; a revoked assignee is skipped", async () => {
    await ensureDone(3);
    revokeProjectMembership(db, { projectId, userId: ASSIGNEE, revokedBy: LEAD, now: NOW });
    const leadBefore = notes(LEAD, "establishment_step_reopened").length;
    const asgBefore = notes(ASSIGNEE, "establishment_step_reopened").length;
    expect((await reopen({ step_no: 3, reason: "리드가 직접 재개합니다 사유" }, asLead())).status).toBe(200);
    expect(notes(LEAD, "establishment_step_reopened")).toHaveLength(leadBefore);
    expect(notes(ASSIGNEE, "establishment_step_reopened")).toHaveLength(asgBefore);
    grantProjectMembership(db, { projectId, userId: ASSIGNEE, projectRole: "member", grantedBy: LEAD, needToKnowBasis: "followup test", now: NOW });
  });

  test("dedupe: the same event cannot notify the same person twice (unique index)", () => {
    const row = notes(LEAD, "establishment_step_reopened").at(-1) ?? notes(ASSIGNEE, "establishment_step_reopened").at(-1)!;
    const dup = db.run(
      `INSERT OR IGNORE INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, dedupe_key)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ulid(), row.user_id, projectId, "establishment_step_reopened", "warning", "{}", "in_app", "immediate", NOW, row.dedupe_key],
    );
    expect(dup.changes).toBe(0);
    // rows without a dedupe_key are unconstrained (watch-engine / pipeline writers)
    for (let i = 0; i < 2; i++) {
      db.run(
        `INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at)
         VALUES (?,?,?,'staleness','info','{}','in_app','daily',?)`,
        [ulid(), LEAD, projectId, NOW],
      );
    }
  });

  test("visible in GET /api/notifications and through the MCP relay (list_notifications)", async () => {
    const res = await req("/api/notifications", { headers: asLead() });
    const rows = (await res.json()).data as Array<{ trigger_type: string; payload: string }>;
    expect(rows.some((r) => r.trigger_type === "establishment_step_reopened")).toBe(true);
    const port = new InProcessRestPort({ userId: LEAD, role: "analyst", scopes: ["read"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    const viaMcp = await port.get<Array<{ trigger_type: string }>>("/api/notifications");
    expect(viaMcp.data.some((r) => r.trigger_type === "establishment_step_reopened")).toBe(true);
  });

  test("the inbox turns the payload href into the item link", async () => {
    const { buildInbox } = await import("../../app/web-next/lib/inbox.ts");
    const n = notes(LEAD, "establishment_step_reopened").at(-1)!;
    const items = buildInbox({ notifications: [{ id: n.id, project_id: projectId, trigger_type: n.trigger_type, severity: "warning", payload: n.payload, sent_at: n.sent_at, read_at: null }] });
    expect(items[0].href).toBe(`/deals/${projectId}/s11`);
    expect(items[0].title).toContain("재개");
    const evil = buildInbox({ notifications: [{ id: "n", project_id: projectId, trigger_type: "x", severity: "info", payload: JSON.stringify({ href: "//evil.example" }), sent_at: NOW, read_at: null }] });
    expect(evil[0].href).toBe(`/projects/${projectId}/process`);
  });
});

describe("(2) reopened_after_gate (server field)", () => {
  const insertGate = (gate: string, decision: string, at: string, id = ulid()) => {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, "project", projectId, gate, decision, "t", LEAD, at],
    );
    return id;
  };
  const clearGates = () => {
    db.run("DELETE FROM gate_decision_stale WHERE decision_id IN (SELECT id FROM gate_decision WHERE entity_type = 'project' AND entity_id = ?)", [projectId]);
    db.run("DROP TRIGGER IF EXISTS trg_gate_decision_no_delete"); // fixture cleanup only (ADR-0186 H1 guard)
    db.run("DELETE FROM gate_decision WHERE entity_type = 'project' AND entity_id = ?", [projectId]);
  };

  test("false without any valid GO, even with reopen events on file", () => {
    clearGates();
    expect(db.query("SELECT COUNT(*) c FROM entity_establishment_step_event WHERE project_id = ? AND kind = 'reopen'").get(projectId)).not.toEqual({ c: 0 });
    expect(reopenedAfterGate(projectId)).toEqual({ reopened_after_gate: false, reopened_after_gate_detail: null });
  });

  test("true when a reopen is newer than the latest valid GO of dd / entity_ic / group_ic", () => {
    clearGates();
    insertGate("entity_ic", "go", "2020-01-01T00:00:00.000Z");
    const r = reopenedAfterGate(projectId);
    expect(r.reopened_after_gate).toBe(true);
    expect(r.reopened_after_gate_detail!.since).toBe("2020-01-01");
    expect(r.reopened_after_gate_detail!.steps).toEqual([2, 3, 5]);
    expect(r.reopened_after_gate_detail!.count).toBe(5);
    // the other gates count the same way
    clearGates();
    insertGate("dd", "go", "2020-01-01 00:00:00");
    expect(reopenedAfterGate(projectId).reopened_after_gate).toBe(true);
  });

  test("false when the GO is newer than every reopen, when only another gate has a GO, or when the latest verdict is not GO", () => {
    clearGates();
    insertGate("group_ic", "go", "2099-01-01T00:00:00.000Z");
    expect(reopenedAfterGate(projectId).reopened_after_gate).toBe(false);
    clearGates();
    insertGate("fs", "go", "2020-01-01T00:00:00.000Z"); // not one of the three gates
    expect(reopenedAfterGate(projectId).reopened_after_gate).toBe(false);
    clearGates();
    insertGate("entity_ic", "go", "2020-01-01T00:00:00.000Z");
    insertGate("entity_ic", "hold", "2021-01-01T00:00:00.000Z");
    expect(reopenedAfterGate(projectId).reopened_after_gate).toBe(false);
  });

  test("a stale GO (ADR-0157) is not a valid GO", () => {
    clearGates();
    const id = insertGate("dd", "go", "2020-01-01T00:00:00.000Z");
    expect(reopenedAfterGate(projectId).reopened_after_gate).toBe(true);
    db.run("INSERT INTO gate_decision_stale (decision_id, stale_at, stale_reason) VALUES (?,?,?)", [id, NOW, "target changed"]);
    expect(reopenedAfterGate(projectId).reopened_after_gate).toBe(false);
  });

  test("served by GET /establishment, the IC package and the process evaluation", async () => {
    clearGates();
    insertGate("entity_ic", "go", "2020-01-01T00:00:00.000Z");
    const est = (await (await req(base(), { headers: asActor() })).json()).data;
    expect(est.reopened_after_gate).toBe(true);
    expect(est.reopened_after_gate_detail.steps).toEqual([2, 3, 5]);
    const ic = (await (await req(`/api/projects/${projectId}/ic-package`, { headers: asActor() })).json()).data;
    expect(ic.establishment.reopened_after_gate).toBe(true);
    expect(ic.establishment.reopened_after_gate_detail.count).toBeGreaterThan(0);
    expect(evaluateProcess({ type: "project", id: projectId }).reopenedAfterGate).toBe(true);
    expect(evaluateProcess({ type: "opportunity", id: oppId }).reopenedAfterGate).toBeUndefined();

    clearGates();
    const est2 = (await (await req(base(), { headers: asActor() })).json()).data;
    expect(est2.reopened_after_gate).toBe(false);
    expect(est2.reopened_after_gate_detail).toBeNull();
    expect(evaluateProcess({ type: "project", id: projectId }).reopenedAfterGate).toBe(false);
  });
});
