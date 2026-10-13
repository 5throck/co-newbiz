// @version 1.0.0
/**
 * Green Field establishment mode (ADR-0167, migration 0142) — lib, route, MCP,
 * process-flow check and procedure applicability. Covers: mode-aware titles and
 * step sets, no default for a Green Field project (409 mode_not_chosen and the
 * "establishment mode not chosen" S11 reason), the human-only PUT with origin /
 * reason rules, mode change keeping old-mode steps as read-only history, the
 * mode-scoped progress / sequence / reopen / events, the S5 hint on the project
 * row, record_establishment's consistency-only `mode`, the proposal-only MCP tool
 * and the two procedures' applies_when over the routing resolver.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-establishment-mode.sqlite");
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
const est = await import("../../app/web-next/lib/establishment.ts");
const { establishmentS11Check } = await import("../../app/web-next/lib/process-flow.ts");
const { isHumanOnly, InProcessRestPort } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const { validatePayload, targetFor, stageFor } = await import("../../app/web-next/lib/proposals.ts");
const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
const { evaluateAppliesWhen, resolveRoutingVars } = await import("../../db/lib/applies-when.ts");
const { parsePredicate } = await import("../../db/lib/predicate.ts");
const yaml = await import("js-yaml");

const NOW = new Date().toISOString();
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const LEAD = "mode-lead";
const VIEWER = "mode-viewer";
const OUTSIDER = "mode-outsider";
let leadCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";

const json = JSON.stringify;
const modeUrl = () => `/api/projects/${projectId}/establishment-mode`;
const estUrl = () => `/api/projects/${projectId}/establishment`;
const putMode = (body: Record<string, unknown>, cookie = leadCookie) => req(modeUrl(), { method: "PUT", headers: { cookie }, body: json(body) });
const putStep = (body: Record<string, unknown>, cookie = leadCookie) =>
  req(estUrl(), { method: "PUT", headers: { cookie }, body: json({ origin: "internal", ...body }) });
const getEst = async () => ((await (await req(estUrl(), { headers: { cookie: leadCookie } })).json()) as { data: Record<string, any> }).data;
const setProject = (sql: string) => db.run(`UPDATE md_project SET ${sql} WHERE id = ?`, [projectId]);
const modeOfRow = () => (db.query("SELECT establishment_mode m FROM md_project WHERE id = ?").get(projectId) as { m: string | null }).m;
async function doneStep(n: number) {
  const r = await putStep({ step_no: n, status: "done", evidence_url: `https://evidence.example/${n}` });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  for (const [id, role] of [[LEAD, "analyst"], [VIEWER, "viewer"], [OUTSIDER, "analyst"]] as const) {
    await createUser(db, { userId: id, role, password: `pw-${id}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  leadCookie = await loginCookie(LEAD, `pw-${LEAD}-12345`);
  viewerCookie = await loginCookie(VIEWER, `pw-${VIEWER}-12345`);
  outsiderCookie = await loginCookie(OUTSIDER, `pw-${OUTSIDER}-12345`);

  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "mode 기회", "산업", "selected", LEAD, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, "greenfield", "test", "대안 검토", LEAD, NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, "직접 진출", "M&A 대안", "test", LEAD, NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows: [{ id: "g", capability: "g", resolution: "hire" }], updatedAt: NOW }), oppId]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", LEAD, NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: LEAD, needToKnowBasis: "mode test" }).project.id;
  // A promoted Green Field project: origin internal, NO mode (ADR-0167 D4).
  setProject("origin = 'internal', track = 'greenfield', establishment_mode = NULL");
});

describe("step titles per mode", () => {
  test("stepTitles(mode) has five titles each; the legacy constant is the new_entity set", () => {
    expect(Object.keys(est.stepTitles("new_entity"))).toHaveLength(5);
    expect(Object.keys(est.stepTitles("business_unit"))).toHaveLength(5);
    expect(est.stepTitles()).toEqual(est.stepTitles("new_entity"));
    expect(est.ESTABLISHMENT_STEP_TITLES).toEqual(est.stepTitles("new_entity"));
    expect(est.stepTitles("business_unit")[1]).toBe("사업부 신설 결의");
    expect(est.stepTitles("business_unit")[5]).toBe("완료 확인(조직·예산·권한 기준선)");
    expect(est.ESTABLISHMENT_MODE_LABELS).toEqual({ new_entity: "신규 법인 설립", business_unit: "신규 사업부 추진" });
  });
});

describe("no default: a Green Field project must choose at S10", () => {
  test("S11 check says 'establishment mode not chosen'; steps are empty; writes 409 mode_not_chosen", async () => {
    expect(est.activeEstablishmentMode(projectId)).toBeNull();
    const check = establishmentS11Check(projectId);
    expect(check.blockers.join("\n")).toContain("establishment mode not chosen");
    expect(check.missing[0]).toContain("설립 방식");
    expect(est.establishmentProgress(projectId)).toMatchObject({ done: 0, complete: false, mode: null });

    const data = await getEst();
    expect(data.mode).toBeNull();
    expect(data.steps).toEqual([]);
    expect(data.step_titles).toBeNull();
    expect(data.allowed_modes).toEqual(["new_entity", "business_unit"]);
    expect(data.all_step_titles.business_unit["1"]).toBe("사업부 신설 결의");

    const res = await putStep({ step_no: 1, status: "in_progress" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe("mode_not_chosen");
    expect((db.query("SELECT COUNT(*) c FROM entity_establishment_step WHERE project_id = ?").get(projectId) as { c: number }).c).toBe(0);
  });

  test("a non-Green-Field project with no stored mode keeps the new_entity behaviour (unchanged)", () => {
    setProject("track = 'brownfield'");
    expect(est.activeEstablishmentMode(projectId)).toBe("new_entity");
    expect(establishmentS11Check(projectId).blockers.join("\n")).toContain("설립 실행 미완료 (0/5단계)");
    setProject("track = 'greenfield'");
    expect(est.activeEstablishmentMode(projectId)).toBeNull();
  });
});

describe("PUT /establishment-mode — human-only, origin and reason rules", () => {
  test("auth: viewer 403, outsider 404, agent via the in-process port human_only; the route is in HUMAN_ONLY_ROUTES", async () => {
    expect((await putMode({ mode: "new_entity" }, viewerCookie)).status).toBe(403);
    expect((await putMode({ mode: "new_entity" }, outsiderCookie)).status).toBe(404);
    expect(isHumanOnly("PUT", modeUrl(), {})).toBe(true);
    const port = new InProcessRestPort({ userId: LEAD, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });
    const refused = await port.put(modeUrl(), { mode: "business_unit" });
    expect(refused.error?.code).toBe("human_only");
    expect(modeOfRow()).toBeNull();
  });

  test("bad bodies: missing/unknown mode 400", async () => {
    expect((await putMode({})).status).toBe(400);
    expect((await putMode({ mode: "franchise" })).status).toBe(400);
    expect((await putMode({ mode: "new_entity", reason: 5 })).status).toBe(400);
  });

  test("business_unit with origin joint -> 400 mode_not_allowed; external origin -> 400 not_applicable; new_entity with joint is fine", async () => {
    setProject("origin = 'joint'");
    const bad = await putMode({ mode: "business_unit" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe("mode_not_allowed");
    expect((await getEst()).allowed_modes).toEqual(["new_entity"]);
    setProject("origin = 'external'");
    const na = await putMode({ mode: "new_entity" });
    expect(na.status).toBe(400);
    expect(((await na.json()) as any).error.code).toBe("not_applicable");
    setProject("origin = 'joint'");
    expect((await putMode({ mode: "new_entity" })).status).toBe(200);
    setProject("origin = 'internal', establishment_mode = NULL");
    db.run("DELETE FROM establishment_mode_event WHERE project_id = ?", [projectId]);
    expect(modeOfRow()).toBeNull();
  });

  test("business_unit needs a Green Field track too", async () => {
    setProject("track = 'brownfield'");
    expect(((await (await putMode({ mode: "business_unit" })).json()) as any).error.code).toBe("mode_not_allowed");
    setProject("track = 'greenfield'");
  });

  test("first choice needs no reason: stores the mode, writes an audit entry and a 'set' event", async () => {
    const auditCount = () => (db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'establishment_mode.set' AND target = ?").get(`${projectId}#mode@ui`) as { c: number }).c;
    const auditBefore = auditCount();
    const res = await putMode({ mode: "business_unit" });
    expect(res.status).toBe(200);
    const body = ((await res.json()) as any).data;
    expect(body).toMatchObject({ mode: "business_unit", previous_mode: null, changed: true, kind: "set" });
    expect(modeOfRow()).toBe("business_unit");
    const ev = db.query("SELECT kind, from_mode, to_mode, actor_user_id, via, audit_id FROM establishment_mode_event WHERE project_id = ?").all(projectId) as any[];
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "set", from_mode: null, to_mode: "business_unit", actor_user_id: LEAD, via: "ui" });
    expect(ev[0].audit_id).toBeTruthy();
    expect(auditCount()).toBe(auditBefore + 1);
  });

  test("same mode again is a no-op (changed false, no new event)", async () => {
    const body = ((await (await putMode({ mode: "business_unit" })).json()) as any).data;
    expect(body).toMatchObject({ changed: false, kind: null });
    expect((db.query("SELECT COUNT(*) c FROM establishment_mode_event WHERE project_id = ?").get(projectId) as { c: number }).c).toBe(1);
  });

  test("GET /establishment-mode returns the state", async () => {
    const data = ((await (await req(modeUrl(), { headers: { cookie: leadCookie } })).json()) as any).data;
    expect(data).toMatchObject({ mode: "business_unit", active_mode: "business_unit", mode_label: "신규 사업부 추진", applicable: true, steps_started: false, changed_after_gate: false });
    expect(data.history).toHaveLength(1);
    expect((await req(modeUrl(), { headers: { cookie: outsiderCookie } })).status).toBe(404);
  });
});

describe("business_unit step set", () => {
  test("GET serves the business unit titles; sequence rule: step 5 needs 1-4", async () => {
    const data = await getEst();
    expect(data).toMatchObject({ mode: "business_unit", mode_label: "신규 사업부 추진", progress: "0/5" });
    expect(data.step_titles["3"]).toBe("인허가 명의 확인");

    expect((await putStep({ step_no: 1, status: "in_progress", note: "결의안 준비" })).status).toBe(200);
    const early = await putStep({ step_no: 5, status: "done", evidence_url: "https://evidence.example/5" });
    expect(early.status).toBe(400);
    expect(((await early.json()) as any).error.code).toBe("sequence_violation");
    expect(establishmentS11Check(projectId).blockers.join("\n")).toContain("사업부 신설 실행 미완료 (0/5단계)");
  });

  test("record_establishment's mode is a consistency check only: mismatch 409 mode_mismatch, match ok, it never sets", async () => {
    const mismatch = await putStep({ step_no: 2, status: "in_progress", mode: "new_entity" });
    expect(mismatch.status).toBe(409);
    expect(((await mismatch.json()) as any).error.code).toBe("mode_mismatch");
    expect((await putStep({ step_no: 2, status: "in_progress", mode: "business_unit" })).status).toBe(200);
    expect((await putStep({ step_no: 2, status: "in_progress", mode: "bogus" })).status).toBe(400);
    const row = db.query("SELECT mode FROM entity_establishment_step WHERE project_id = ? AND step_no = 2").get(projectId) as { mode: string };
    expect(row.mode).toBe("business_unit");
    const ev = db.query("SELECT mode FROM entity_establishment_step_event WHERE project_id = ? AND step_no = 2").all(projectId) as Array<{ mode: string }>;
    expect(ev.every((e) => e.mode === "business_unit")).toBe(true);
  });

  test("5/5 in the business unit set completes the S11 establishment requirement", async () => {
    for (const n of [1, 2, 3, 4, 5]) await doneStep(n);
    expect(est.establishmentProgress(projectId)).toMatchObject({ done: 5, complete: true, mode: "business_unit" });
    expect(establishmentS11Check(projectId)).toEqual({ blockers: [], missing: [] });
    const data = await getEst();
    expect(data).toMatchObject({ complete: true, progress: "5/5" });
    expect(data.steps.every((s: any) => s.mode === "business_unit")).toBe(true);
  });
});

describe("changing the mode keeps old steps as read-only history", () => {
  test("a change needs a reason (>= 10 chars); without one 400 reason_required", async () => {
    const none = await putMode({ mode: "new_entity" });
    expect(none.status).toBe(400);
    expect(((await none.json()) as any).error.code).toBe("reason_required");
    const short = await putMode({ mode: "new_entity", reason: "too short" });
    expect(short.status).toBe(400);
    expect(((await short.json()) as any).error.code).toBe("invalid_request");
    expect(modeOfRow()).toBe("business_unit");
  });

  test("with a reason: audited change, old rows untouched, new mode starts at 0/5, S11 blocked again", async () => {
    const before = db.query("SELECT id, status, mode, evidence_url FROM entity_establishment_step WHERE project_id = ? ORDER BY step_no").all(projectId);
    const res = await putMode({ mode: "new_entity", reason: "Permit cannot be held by the existing entity" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toMatchObject({ mode: "new_entity", previous_mode: "business_unit", kind: "change" });
    expect(modeOfRow()).toBe("new_entity");
    expect(db.query("SELECT id, status, mode, evidence_url FROM entity_establishment_step WHERE project_id = ? ORDER BY step_no").all(projectId)).toEqual(before);

    const ev = db.query("SELECT kind, from_mode, to_mode, reason FROM establishment_mode_event WHERE project_id = ? ORDER BY created_at DESC, id DESC").all(projectId) as any[];
    expect(ev[0]).toMatchObject({ kind: "change", from_mode: "business_unit", to_mode: "new_entity", reason: "Permit cannot be held by the existing entity" });
    expect((db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'establishment_mode.change' AND target = ?").get(`${projectId}#mode@ui`) as { c: number }).c).toBe(1);

    const data = await getEst();
    expect(data).toMatchObject({ mode: "new_entity", progress: "0/5" });
    expect(data.steps).toEqual([]);
    expect(data.history_steps).toHaveLength(5);
    expect(data.history_steps.every((s: any) => s.mode === "business_unit" && s.status === "done")).toBe(true);
    expect(establishmentS11Check(projectId).blockers.join("\n")).toContain("설립 실행 미완료 (0/5단계)");
  });

  test("old-mode rows are history: they are not counted, cannot be reopened under the new mode, new steps are independent", async () => {
    const reopen = await req(`${estUrl()}/reopen`, { method: "POST", headers: { cookie: leadCookie }, body: json({ step_no: 1, reason: "reopen an old mode row please" }) });
    expect(reopen.status).toBe(409); // not_done in the active (new_entity) set
    expect((await putStep({ step_no: 1, status: "done", evidence_url: "https://evidence.example/e1" })).status).toBe(200);
    expect(est.establishmentProgress(projectId)).toMatchObject({ done: 1, mode: "new_entity" });
    expect((db.query("SELECT COUNT(*) c FROM entity_establishment_step WHERE project_id = ? AND step_no = 1").get(projectId) as { c: number }).c).toBe(2);
    expect(est.establishmentProgress(projectId).done).toBe(1);
    expect(est.listEstablishmentHistory(projectId)).toHaveLength(5);
  });

  test("changed_after_gate: false without a valid GO or when the GO is newer; true when a mode change is newer than the latest valid GO", async () => {
    expect((await getEst()).mode_changed_after_gate).toBe(false);
    const gid = ulid();
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [gid, "project", projectId, "entity_ic", "go", "t", LEAD, new Date(Date.now() + 60_000).toISOString()]);
    expect((await getEst()).mode_changed_after_gate).toBe(false); // the GO is newer than the change
    db.run("UPDATE gate_decision SET decided_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [gid]);
    expect((await getEst()).mode_changed_after_gate).toBe(true); // the change came after the approval (warning only)
    expect((await req(modeUrl(), { headers: { cookie: leadCookie } }).then((r) => r.json()) as any).data.changed_after_gate).toBe(true);
  });
});

describe("S5 hint and storage", () => {
  test("storeSuggestedMode keeps a non-binding hint that never changes the active mode", async () => {
    est.storeSuggestedMode(db, projectId, "business_unit");
    const st = est.getEstablishmentModeState(projectId)!;
    expect(st.suggested).toBe("business_unit");
    expect(st.active_mode).toBe("new_entity");
    expect((await getEst()).mode_suggested).toBe("business_unit");
  });

  test("the promote route rejects an unknown establishment_mode_suggested value", async () => {
    const res = await req(`/api/opportunities/${ulid()}/promote`, { method: "POST", headers: { cookie: leadCookie }, body: json({ needToKnowBasis: "x", establishment_mode_suggested: "franchise" }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("invalid_request");
  });
});

describe("MCP surface", () => {
  test("record_establishment describes the optional mode and still blocks done; propose_establishment_mode is proposal-only", () => {
    const rec = REGISTRY.find((t) => t.name === "record_establishment")!;
    expect(JSON.stringify(rec)).toContain("mode?: new_entity | business_unit");
    const prop = REGISTRY.find((t) => t.name === "propose_establishment_mode")!;
    expect(prop.kind).toBe("propose");
    expect(prop.scope).toBe("propose");
    expect(prop.routes).toEqual(["POST /api/proposals"]);
    expect(JSON.stringify(prop.inputSchema)).toContain("business_unit");
  });

  test("propose_establishment_mode creates an approval proposal (subject establishment_mode) via POST /api/proposals only", async () => {
    const prop = REGISTRY.find((t) => t.name === "propose_establishment_mode")!;
    const calls: Array<{ path: string; body: any }> = [];
    const port = { post: async (path: string, body: any) => { calls.push({ path, body }); return { data: { proposal_id: "p1" }, error: null }; } };
    await prop.run({ port } as never, { projectId, mode: "business_unit", rationale: "No new legal vehicle is needed" } as never);
    expect(calls).toEqual([{ path: "/api/proposals", body: { kind: "approval", entity_id: projectId, payload: { subject: "establishment_mode", mode: "business_unit" }, rationale: "No new legal vehicle is needed", evidence_refs: undefined } }]);
  });

  test("proposal payload validation, stage and confirm target map to the human-only PUT", () => {
    expect(validatePayload("approval", { subject: "establishment_mode", mode: "business_unit" }).ok).toBe(true);
    expect(validatePayload("approval", { subject: "establishment_mode", mode: "franchise" }).ok).toBe(false);
    expect(validatePayload("approval", { subject: "establishment_mode", mode: "new_entity", extra: 1 }).ok).toBe(false);
    expect(stageFor("approval", { subject: "establishment_mode" })).toBe("S10");
    const t = targetFor("approval", "project", "P1", { subject: "establishment_mode", mode: "business_unit", reason: "A valid reason text" });
    expect(t).toMatchObject({ pattern: "establishment-mode", method: "PUT", path: "/api/projects/P1/establishment-mode", body: { mode: "business_unit", reason: "A valid reason text" } });
  });
});

describe("procedure applicability (applies_when over the routing resolver)", () => {
  const load = (dir: string) => parsePredicate((yaml.load(readFileSync(join(PROJECT_ROOT, `procedures/_shared/${dir}/schema.yaml`), "utf-8"), { schema: yaml.JSON_SCHEMA }) as any).applies_when);
  const ENTITY = load("entity-establishment-execution");
  const BU = load("business-unit-establishment-execution");
  function applies(pred: any, origin: string | null, mode: string | null): boolean {
    const pid = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at, establishment_mode) VALUES (?,?,?,?)", [pid, `NP-${pid.slice(-6)}`, NOW, null]);
    if (origin) {
      db.run("INSERT INTO project_case_classification (id, project_id, case_type, origin, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?)", [ulid(), pid, "greenfield", origin, LEAD, NOW, "t"]);
    }
    if (mode) db.run("UPDATE md_project SET establishment_mode = ?, origin = ? WHERE id = ?", [mode, mode === "business_unit" ? "internal" : (origin ?? "internal"), pid]);
    return evaluateAppliesWhen({ procedure: "x" }, pred, resolveRoutingVars(pid, db), { now: new Date(NOW) }).applies;
  }

  test("new_entity procedure: applies for new_entity or NULL mode (legacy), skips for business_unit and external", () => {
    expect(applies(ENTITY, "internal", "new_entity")).toBe(true);
    expect(applies(ENTITY, "joint", "new_entity")).toBe(true);
    expect(applies(ENTITY, "internal", null)).toBe(true);
    expect(applies(ENTITY, "internal", "business_unit")).toBe(false);
    expect(applies(ENTITY, "external", null)).toBe(false);
    expect(applies(ENTITY, null, null)).toBe(false); // the unclassified-origin skip is unchanged
  });

  test("business_unit procedure: only origin internal AND mode business_unit; an unchosen mode skips", () => {
    expect(applies(BU, "internal", "business_unit")).toBe(true);
    expect(applies(BU, "internal", "new_entity")).toBe(false);
    expect(applies(BU, "joint", "new_entity")).toBe(false);
    expect(applies(BU, "internal", null)).toBe(false);
    expect(applies(BU, "external", null)).toBe(false);
  });
});
