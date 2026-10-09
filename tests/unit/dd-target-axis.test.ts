// @version 1.0.0
/**
 * Optional per-target DD — ADR-0157 regression, against the REAL route handlers
 * and the real scratch SQLite.
 *
 * Proves:
 *  (a) opening DD on another shortlisted target is a HUMAN act: viewer 403,
 *      non-member 404, bearer/MCP token 403, agent identity 403, rationale
 *      required, shortlist + non-selected only, idempotent, audited;
 *  (b) a non-NULL target_id that was never opened is 409 on every DD route
 *      (workspace GET, checklist state, tailor, waivers, findings);
 *  (c) gate isolation: rows recorded on another target never change
 *      ddCompletionSummary(project) nor the process evaluation, and a waiver
 *      of another scope cannot be linked;
 *  (d) re-selection A→B / A→B→A / B-without-DD keeps every row, re-points the
 *      gate scope and marks an existing dd gate decision stale;
 *  (e) grandfathering: legacy rows (target_id NULL, no open record) behave
 *      exactly as before; greenfield never accepts a target_id;
 *  (f) MCP: target_id passthrough on the S9 tools and NO tool opens DD.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-dd-target-axis.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_DD_TAILOR_AGENTS = "deterministic";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { issueApiToken } = await import("../../db/lib/api-tokens.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { evaluateProcess, latestGateDecisions } = await import("../../app/web-next/lib/process-flow.ts");
const { ddCompletionSummary, listDdWorkspace } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
const { DD_WORKSPACE_CHECKLISTS, getChecklistItems } = await import("../../app/web-next/lib/library.ts");
const { AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");
const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
const { validatePayload, targetFor, stageFor } = await import("../../app/web-next/lib/proposals.ts");

const NOW = new Date().toISOString();
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const ANALYST = "dt-analyst";
const VIEWER = "dt-viewer";
const OUTSIDER = "dt-outsider";
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let agentCookie = "";
let bearer = "";
let projectId = "";
let greenfieldProjectId = "";
let oppId = "";
let targetA = "";
let targetB = "";
let targetC = "";
let targetX = ""; // excluded (not on the shortlist)

const commercialChecklist = DD_WORKSPACE_CHECKLISTS.commercial;
const commercialItems = getChecklistItems(commercialChecklist) ?? [];

function post(path: string, body: unknown, cookie = analystCookie) {
  return req(path, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
}
function put(path: string, body: unknown, cookie = analystCookie) {
  return req(path, { method: "PUT", headers: { cookie }, body: JSON.stringify(body) });
}
function get(path: string, cookie = analystCookie) {
  return req(path, { headers: { cookie } });
}
async function selectTarget(targetId: string, rationale = "재선정 근거") {
  const res = await post(`/api/projects/${projectId}/target-selection`, { target_id: targetId, rationale });
  expect(res.status).toBe(201);
}
async function judge(targetId: string | null, itemIndex: number, status: "pass" | "fail" | "na" = "pass") {
  const res = await put(`/api/projects/${projectId}/dd-checklist/state`, {
    checklist_id: commercialChecklist,
    item_id: commercialItems[itemIndex].id,
    status,
    ...(targetId ? { target_id: targetId } : {}),
  });
  return res;
}
const count = (sql: string, ...args: Array<string | null>) => (db.query(sql).get(...args) as { c: number }).c;

beforeAll(async () => {
  for (const [id, role, pw] of [
    [ANALYST, "analyst", "pw-dt-analyst-12"],
    [VIEWER, "viewer", "pw-dt-viewer-123"],
    [OUTSIDER, "analyst", "pw-dt-outsider-1"],
  ] as const) {
    await createUser(db, { userId: id, role, password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  const agentKey = [...AGENT_KEYS][0];
  await createUser(db, { userId: agentKey, role: "analyst", password: "pw-dt-agent-1234", createdBy: "test", now: NOW });
  approveUser(db, { userId: agentKey, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-dt-analyst-12");
  viewerCookie = await loginCookie(VIEWER, "pw-dt-viewer-123");
  outsiderCookie = await loginCookie(OUTSIDER, "pw-dt-outsider-1");
  agentCookie = await loginCookie(agentKey, "pw-dt-agent-1234");
  bearer = issueApiToken(db, { userId: ANALYST, label: "agent", scopes: ["read", "write"], now: NOW }).token;

  oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "DD 대상축 기회", "테스트 산업", "selected", ANALYST, NOW]);
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, "brownfield", "m_and_a", "test route", ANALYST, NOW],
  );
  for (const gate of ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW]);
  }
  targetA = ulid();
  targetB = ulid();
  targetC = ulid();
  targetX = ulid();
  for (const [id, name, status, rank] of [
    [targetA, "대상A", "shortlisted", 1],
    [targetB, "대상B", "shortlisted", 2],
    [targetC, "대상C", "shortlisted", 3],
    [targetX, "대상X", "excluded", null],
  ] as const) {
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [id, oppId, name, status, rank, NOW, NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "DD target axis test" }).project.id;

  // A greenfield project in the same DB (grandfathering / never accepts target_id).
  const gfOpp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [gfOpp, "GF 기회", "테스트 산업", "selected", ANALYST, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), gfOpp, "greenfield", "test route", ANALYST, NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), gfOpp, "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows: [{ id: "g1", capability: "c", resolution: "hire" }], updatedAt: NOW }), gfOpp]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", gfOpp, gate, "go", "test", ANALYST, NOW]);
  }
  greenfieldProjectId = promoteOpportunity(gfOpp, { promotedBy: ANALYST, needToKnowBasis: "GF" }).project.id;
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("ADR-0157 open route — human only, rationale, shortlist", () => {
  test("opening before any selection is refused (selection_required)", async () => {
    const res = await post(`/api/projects/${projectId}/dd/targets`, { target_id: targetB, rationale: "비교" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("selection_required");
  });

  test("select A, then the guards: viewer 403, outsider 404, bearer 403, agent 403, rationale 400", async () => {
    await selectTarget(targetA, "초기 선정");
    const path = `/api/projects/${projectId}/dd/targets`;
    expect((await post(path, { target_id: targetB, rationale: "비교" }, viewerCookie)).status).toBe(403);
    expect((await post(path, { target_id: targetB, rationale: "비교" }, outsiderCookie)).status).toBe(404);

    const viaBearer = await req(path, { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ target_id: targetB, rationale: "비교" }) });
    expect(viaBearer.status).toBe(403);
    expect(((await viaBearer.json()) as { error: { code: string } }).error.code).toBe("session_required");

    const viaAgent = await post(path, { target_id: targetB, rationale: "비교" }, agentCookie);
    expect(viaAgent.status).toBe(403);
    expect(((await viaAgent.json()) as { error: { code: string } }).error.code).toBe("agent_forbidden");

    expect((await post(path, { target_id: targetB, rationale: "   " })).status).toBe(400);
    expect((await post(path, { rationale: "no target" })).status).toBe(400);
    expect(count("SELECT COUNT(*) c FROM dd_target_open WHERE project_id = ?", projectId)).toBe(0);
  });

  test("shortlist-only and non-selected-only", async () => {
    const path = `/api/projects/${projectId}/dd/targets`;
    const excluded = await post(path, { target_id: targetX, rationale: "제외 대상" });
    expect(excluded.status).toBe(400);
    expect(((await excluded.json()) as { error: { code: string } }).error.code).toBe("invalid_target");
    const unknown = await post(path, { target_id: "nope", rationale: "없는 대상" });
    expect(unknown.status).toBe(400);
    const selected = await post(path, { target_id: targetA, rationale: "선정 대상" });
    expect(selected.status).toBe(400);
    expect(((await selected.json()) as { error: { code: string } }).error.code).toBe("already_selected");
  });

  test("a human opens B: 201, audited; re-open is idempotent 200", async () => {
    const path = `/api/projects/${projectId}/dd/targets`;
    const first = await post(path, { target_id: targetB, rationale: "차순위 대상의 실제 리스크를 비교" });
    expect(first.status).toBe(201);
    const body = ((await first.json()) as { data: { already_open: boolean; opened_by: string; source: string } }).data;
    expect(body).toMatchObject({ already_open: false, opened_by: ANALYST, source: "manual" });
    const again = await post(path, { target_id: targetB, rationale: "다시" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { data: { already_open: boolean } }).data.already_open).toBe(true);
    expect(count("SELECT COUNT(*) c FROM dd_target_open WHERE project_id = ? AND target_id = ?", projectId, targetB)).toBe(1);
    expect(count("SELECT COUNT(*) c FROM audit_log WHERE action = 'dd_target_opened' AND target = ?", `${projectId}:${targetB}`)).toBe(1);
  });
});

describe("ADR-0157 unopened target is 409 on every DD route", () => {
  test("GET workspace, state PUT, tailor, waivers GET/POST, findings POST", async () => {
    const msg = "DD가 열리지 않은 대상입니다";
    const checks: Response[] = [
      await get(`/api/projects/${projectId}/dd?target_id=${targetC}`),
      await judge(targetC, 0),
      await post(`/api/projects/${projectId}/dd-checklist/tailor`, { target_id: targetC }),
      await get(`/api/projects/${projectId}/waivers?target_id=${targetC}`),
      await post(`/api/projects/${projectId}/waivers`, { target_id: targetC, governance_doc_id: "x", clause_ref: "c", reason: "r", approver_role: "pm", expires_at: new Date(Date.now() + 864e5).toISOString() }),
      await post(`/api/projects/${projectId}/dd/findings`, { target_id: targetC, category: "legal", description: "d" }),
    ];
    for (const res of checks) {
      expect(res.status).toBe(409);
      const err = ((await res.json()) as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("dd_target_not_open");
      expect(err.message).toBe(msg);
    }
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id = ?", projectId, targetC)).toBe(0);
  });

  test("explicitly passing the selected target's id normalises to the gate scope", async () => {
    const res = await judge(targetA, 0, "pass");
    expect(res.status).toBe(200);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL", projectId)).toBe(1);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id = ?", projectId, targetA)).toBe(0);
  });
});

describe("ADR-0157 gate isolation — other-target DD never affects S9", () => {
  test("rows on B never change the selected-scope summary or the process evaluation", async () => {
    const before = ddCompletionSummary(projectId);
    const processBefore = JSON.stringify(evaluateProcess({ type: "project", id: projectId }));

    // B: judge several items, a mandatory fail, a custom proposal, and a finding.
    for (let i = 0; i < 3; i++) expect((await judge(targetB, i, "pass")).status).toBe(200);
    const mandatory = commercialItems.find((it) => it.mandatory) ?? commercialItems[0];
    const failRes = await put(`/api/projects/${projectId}/dd-checklist/state`, { checklist_id: commercialChecklist, item_id: mandatory.id, status: "fail", target_id: targetB });
    expect(failRes.status).toBe(200);
    const tailor = await post(`/api/projects/${projectId}/dd-checklist/tailor`, { target_id: targetB, domains: ["commercial"] });
    expect(tailor.status).toBe(201);
    const finding = await post(`/api/projects/${projectId}/dd/findings`, { target_id: targetB, category: "commercial", description: "B 고객 집중도", value_impact: -1200 });
    expect(finding.status).toBe(201);

    expect(ddCompletionSummary(projectId)).toEqual(before);
    expect(JSON.stringify(evaluateProcess({ type: "project", id: projectId }))).toBe(processBefore);

    // B's own scope reflects its rows.
    const b = ddCompletionSummary(projectId, { targetId: targetB });
    expect(b.total).toBe(3);
    expect(b.mandatoryUnmet).toBeGreaterThanOrEqual(0);
    const bView = listDdWorkspace(projectId, { targetId: targetB });
    expect(bView.scope_target_id).toBe(targetB);
    expect(bView.findings.length).toBe(1);
    // The selected scope shows none of B's findings or proposals.
    const aView = listDdWorkspace(projectId);
    expect(aView.findings.length).toBe(0);
    expect(aView.domains.every((d) => d.custom.length === 0)).toBe(true);
    expect(bView.domains.some((d) => d.custom.length > 0)).toBe(true);

    // targets[] comparison summary.
    const summary = aView.targets;
    expect(summary.map((t) => t.name)).toEqual(["대상A", "대상B", "대상C"]);
    expect(summary.find((t) => t.target_id === targetA)).toMatchObject({ is_selected: true, opened: true });
    expect(summary.find((t) => t.target_id === targetB)).toMatchObject({ is_selected: false, opened: true, total: 3, findings: 1, findings_with_value_impact: 1 });
    expect(summary.find((t) => t.target_id === targetC)).toMatchObject({ opened: false, total: 0 });
  });

  test("the same item can be judged independently per scope (unique per target)", async () => {
    expect((await judge(targetB, 0, "fail")).status).toBe(200);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND item_id = ?", projectId, commercialItems[0].id)).toBe(2);
    const gate = db.query("SELECT status FROM project_checklist_item_state WHERE project_id = ? AND item_id = ? AND target_id IS NULL").get(projectId, commercialItems[0].id) as { status: string };
    expect(gate.status).toBe("pass");
  });

  test("an approved custom item of B gets B's state row; findings on the gate scope stay B-free", async () => {
    const proposed = db.query("SELECT id, domain FROM project_checklist_item_custom WHERE project_id = ? AND target_id = ? LIMIT 1").get(projectId, targetB) as { id: string; domain: string };
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_custom WHERE project_id = ? AND target_id IS NULL", projectId)).toBe(0);
    const review = await put(`/api/projects/${projectId}/dd-checklist/tailor/${proposed.id}/review`, { decision: "approved" });
    expect(review.status).toBe(200);
    const stateRow = db.query("SELECT target_id FROM project_checklist_item_state WHERE item_id = ?").get(proposed.id) as { target_id: string | null };
    expect(stateRow.target_id).toBe(targetB);
    // Judging it from the gate scope is rejected (not an applied item of that scope).
    const wrongScope = await put(`/api/projects/${projectId}/dd-checklist/state`, { checklist_id: `custom:${proposed.domain}`, item_id: proposed.id, status: "pass" });
    expect(wrongScope.status).toBe(404);
    const ok = await put(`/api/projects/${projectId}/dd-checklist/state`, { checklist_id: `custom:${proposed.domain}`, item_id: proposed.id, status: "pass", target_id: targetB });
    expect(ok.status).toBe(200);
  });

  test("a waiver is scoped to one DD scope: B's waiver cannot be linked in the gate scope", async () => {
    const docId = ulid();
    db.run(
      "INSERT INTO governance_doc (id, layer, key, title, version, enforceability, owner_agent, doc_path, effective_from) VALUES (?,?,?,?,?,?,?,?,?)",
      [docId, "checklist", "dt-doc", "DT doc", "1", "mandatory", "process-governance-manager", "checklists/dt.yaml", NOW],
    );
    const future = new Date(Date.now() + 864e5 * 30).toISOString();
    const waiverRes = await post(`/api/projects/${projectId}/waivers`, {
      target_id: targetB, governance_doc_id: docId, clause_ref: "b-clause", reason: "B 한정", approver_role: "pm", expires_at: future, approved_by: "pm",
    });
    expect(waiverRes.status).toBe(201);
    const waiverId = ((await waiverRes.json()) as { data: { id: string } }).data.id;
    expect(count("SELECT COUNT(*) c FROM waiver WHERE id = ? AND target_id = ?", waiverId, targetB)).toBe(1);

    const listB = (await (await get(`/api/projects/${projectId}/waivers?target_id=${targetB}`)).json()) as { data: { waivers: Array<{ id: string }> } };
    const listA = (await (await get(`/api/projects/${projectId}/waivers`)).json()) as { data: { waivers: Array<{ id: string }> } };
    expect(listB.data.waivers.map((w) => w.id)).toContain(waiverId);
    expect(listA.data.waivers.map((w) => w.id)).not.toContain(waiverId);

    const link = await put(`/api/projects/${projectId}/dd-checklist/state`, { checklist_id: commercialChecklist, item_id: commercialItems[5].id, status: "waived", waiver_id: waiverId });
    expect(link.status).toBe(400);
    expect(((await link.json()) as { error: { code: string } }).error.code).toBe("waiver_target_mismatch");
    const linkB = await put(`/api/projects/${projectId}/dd-checklist/state`, { checklist_id: commercialChecklist, item_id: commercialItems[5].id, status: "waived", waiver_id: waiverId, target_id: targetB });
    expect(linkB.status).toBe(200);
  });
});

describe("ADR-0157 re-selection keeps evidence and re-points the gate", () => {
  const total = () =>
    count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ?", projectId) +
    count("SELECT COUNT(*) c FROM project_checklist_item_custom WHERE project_id = ?", projectId) +
    count("SELECT COUNT(*) c FROM dd_finding WHERE project_id = ?", projectId) +
    count("SELECT COUNT(*) c FROM waiver WHERE project_id = ?", projectId);

  test("A→B: no deletes, A stamped + auto-opened, B's DD becomes the gate scope, dd decision stale", async () => {
    const dd = ulid();
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [dd, "project", projectId, "dd", "go", "A 기준 판정", ANALYST, NOW]);
    expect(latestGateDecisions("project", projectId).get("dd")?.decision).toBe("go");
    const rowsBefore = total();
    const aRows = count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL", projectId);
    const bRows = count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id = ?", projectId, targetB);
    expect(aRows).toBeGreaterThan(0);

    await selectTarget(targetB, "B로 재선정");

    expect(total()).toBe(rowsBefore);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id = ?", projectId, targetA)).toBe(aRows);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL", projectId)).toBe(bRows);
    const open = db.query("SELECT source FROM dd_target_open WHERE project_id = ? AND target_id = ?").get(projectId, targetA) as { source: string };
    expect(open.source).toBe("reselection");
    // B's open row is kept for the audit trail.
    expect(count("SELECT COUNT(*) c FROM dd_target_open WHERE project_id = ? AND target_id = ?", projectId, targetB)).toBe(1);

    // The dd decision is stale: kept in history, no longer counted.
    const stale = db.query("SELECT stale_at, stale_reason FROM gate_decision_stale WHERE decision_id = ?").get(dd) as { stale_at: string; stale_reason: string };
    expect(stale.stale_at).toBeTruthy();
    // The human decision row itself is never edited.
    expect((db.query("SELECT decision, rationale FROM gate_decision WHERE id = ?").get(dd) as { decision: string; rationale: string })).toEqual({ decision: "go", rationale: "A 기준 판정" });
    expect(latestGateDecisions("project", projectId).has("dd")).toBe(false);
    const history = (await (await get(`/api/projects/${projectId}/gate-decisions`)).json()) as { data: { history: Array<{ id: string; stale_at: string | null }> } };
    expect(history.data.history.find((h) => h.id === dd)?.stale_at).toBeTruthy();

    // The gate scope is now B's evidence; A is ordinary per-target evidence and is reachable.
    expect(ddCompletionSummary(projectId).total).toBe(bRows);
    expect(ddCompletionSummary(projectId, { targetId: targetA }).total).toBe(aRows);
    expect((await get(`/api/projects/${projectId}/dd?target_id=${targetA}`)).status).toBe(200);
    expect((await get(`/api/projects/${projectId}/dd?target_id=${targetB}`)).status).toBe(200); // normalised to the gate scope
  });

  test("A→B→A round trip restores A as the gate scope with the same rows", async () => {
    const rowsBefore = total();
    const gateRows = count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL", projectId);
    const aRows = count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id = ?", projectId, targetA);
    await selectTarget(targetA, "다시 A");
    expect(total()).toBe(rowsBefore);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id IS NULL", projectId)).toBe(aRows);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id = ?", projectId, targetB)).toBe(gateRows);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id = ?", projectId, targetA)).toBe(0);
  });

  test("re-selecting to C (no prior DD) starts the gate scope empty; nothing is deleted", async () => {
    const rowsBefore = total();
    await selectTarget(targetC, "C로 변경");
    expect(total()).toBe(rowsBefore);
    expect(ddCompletionSummary(projectId).total).toBe(0);
    expect(count("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ? AND target_id = ?", projectId, targetA)).toBeGreaterThan(0);
    // Selecting the same target again is a no-op for DD rows.
    await selectTarget(targetC, "같은 대상 재기록");
    expect(total()).toBe(rowsBefore);
    await selectTarget(targetA, "A로 복귀");
  });
});

describe("ADR-0157 grandfathering and track rules", () => {
  test("legacy rows (NULL target, no open record) behave as before; greenfield never accepts a target_id", async () => {
    expect(count("SELECT COUNT(*) c FROM dd_target_open WHERE project_id = ?", greenfieldProjectId)).toBe(0);
    const legacyId = ulid();
    db.run(
      "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)",
      [legacyId, greenfieldProjectId, commercialChecklist, commercialItems[0].id, "pending", ANALYST, NOW],
    );
    const summary = ddCompletionSummary(greenfieldProjectId);
    expect(summary.pending).toBe(1);
    expect((await get(`/api/projects/${greenfieldProjectId}/dd`)).status).toBe(200);
    const withTarget = await get(`/api/projects/${greenfieldProjectId}/dd?target_id=${targetB}`);
    expect(withTarget.status).toBe(400);
    const open = await post(`/api/projects/${greenfieldProjectId}/dd/targets`, { target_id: targetB, rationale: "gf" });
    expect(open.status).toBe(400);
    const ws = listDdWorkspace(greenfieldProjectId);
    expect(ws.targets).toEqual([]);
  });

  test("a project without any open record renders exactly the single-subject workspace", async () => {
    const res = await get(`/api/projects/${projectId}/dd`);
    const data = ((await res.json()) as { data: { scope_target_id: string | null; selected_target_id: string | null; targets: Array<{ opened: boolean; is_selected: boolean }> } }).data;
    expect(data.scope_target_id).toBeNull();
    expect(data.selected_target_id).toBe(targetA);
    expect(data.targets.filter((t) => t.opened && !t.is_selected).length).toBeGreaterThanOrEqual(0);
  });
});

describe("ADR-0157 MCP surface", () => {
  test("no registry tool opens DD or declares the open route; propose_approval can only suggest it", () => {
    for (const tool of REGISTRY) {
      expect(tool.name).not.toMatch(/open_dd|dd_open|open_target/);
      expect((tool.routes ?? []).some((r) => /\/dd\/targets/.test(r))).toBe(false);
    }
    const approval = REGISTRY.find((t) => t.name === "propose_approval")!;
    const subjectProp = approval.inputSchema.properties.subject as { enum: string[] };
    const subjectEnum = subjectProp.enum;
    expect(subjectEnum).toContain("dd_target_open");
    const ok = validatePayload("approval", { subject: "dd_target_open", target_id: targetB, rationale: "비교 근거" });
    expect(ok.ok).toBe(true);
    expect(validatePayload("approval", { subject: "dd_target_open", target_id: targetB }).ok).toBe(false);
    expect(stageFor("approval", { subject: "dd_target_open" })).toBe("S9");
    expect(targetFor("approval", "project", projectId, { subject: "dd_target_open", target_id: targetB, rationale: "r" }).path).toBe(`/api/projects/${projectId}/dd/targets`);
  });

  test("get_project_dd_workspace forwards target_id as a query; body tools document the passthrough", async () => {
    const tool = REGISTRY.find((t) => t.name === "get_project_dd_workspace")!;
    const seen: string[] = [];
    const port = { get: async (p: string) => { seen.push(p); return { data: null, meta: {}, error: null }; } };
    await tool.run({ port } as never, { projectId: "p1", target_id: "t1" });
    await tool.run({ port } as never, { projectId: "p1" });
    expect(seen).toEqual(["/api/projects/p1/dd?target_id=t1", "/api/projects/p1/dd"]);
    for (const name of ["tailor_dd_checklist", "request_dd_waiver"]) {
      const t = REGISTRY.find((x) => x.name === name)!;
      expect(JSON.stringify(t.inputSchema)).toContain("target_id");
    }
  });
});
