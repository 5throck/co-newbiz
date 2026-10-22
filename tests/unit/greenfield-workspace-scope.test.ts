// @version 1.0.0
/**
 * ADR-0160 addendum (b) — greenfield S9 workspace scope (Row 2 of design
 * 2026-10-12-greenfield-dd-workspace-domains-by-track), against a scratch
 * SQLite and the REAL route handlers:
 *  (a) per sub-track Y (56 / 60 / 55 after the risk-officer review 2026-10-12, +3 when the site is in scope);
 *  (b) replacement fallback: an unjudged earlier-stage target makes the S9 item judgeable;
 *  (c) brownfield and grandfathered greenfield payloads unchanged (no new keys);
 *  (d) opt-in preview on a 37-judgement fixture; opt-in keeps every row; fails stay unmet;
 *  (e) server enforcement: new judgement on N/X -> 409; re-judging an existing row allowed;
 *  (f) opt-in POST human-only (bearer / agent 403), migration_note, audit, wiring;
 *  (g) fail-closed overlay rows (missing / unapproved -> A).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-greenfield-workspace-scope.sqlite";
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
const { ulid } = await import("../../db/lib/ulid.ts");
const { AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");
const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const gf = await import("../../app/web-next/lib/greenfield-subtrack.ts");
const tailor = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
const { getChecklistItems, getWorkspaceOverlay } = await import("../../app/web-next/lib/library.ts");
const { DdTargetError } = await import("../../app/web-next/lib/dd-target.ts");
const { buildS8LensSummary } = await import("../../app/web-next/lib/s8-lens-summary.ts");

const NOW = new Date().toISOString();
const OLD = "2026-06-01T00:00:00.000Z"; // before GF_SUBTRACK_PREDICATE_DATE / GF_WORKSPACE_SCOPE_DATE (2026-07-01)
const NEW = "2026-10-20T00:00:00.000Z";
const A1 = "ws_analyst1";
const A2 = "ws_analyst2";
const AGENT = [...AGENT_KEYS][0];
let c1 = "";
let agentCookie = "";
let bearer = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const json = async (res: Response) => (await res.json()) as Record<string, any>;

function seedProject(track: "greenfield" | "brownfield", subTrack: string | null, opts: { old?: boolean } = {}): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `ws ${ulid()}`, "테스트", "selected", A1, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), opp, track, subTrack, "test", A1, NOW]);
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id) VALUES (?,?,?,?)", [id, `WS-${id.slice(-8)}`, NEW, opp]);
  for (const [u, basis] of [[A1, "author"], [A2, "review"]]) {
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, u, "member", "root", NOW, basis]);
  }
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), id, "t", "h", A1, NOW]);
  if (opts.old) {
    db.run("UPDATE md_project SET created_at = ? WHERE id = ?", [OLD, id]);
    db.run("UPDATE project_policy_pin SET pinned_at = ? WHERE project_id = ?", [OLD, id]);
  }
  return id;
}

function setSite(projectId: string, value: boolean) {
  const a = gf.confirmSiteRequired({ projectId, value, rationale: "현장 확인", actor: A1 }, db);
  if (!a.ok) throw new Error(a.message);
}

function judge(projectId: string, checklistId: string, itemId: string, status: string) {
  db.run(
    "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), projectId, checklistId, itemId, status, A1, OLD],
  );
}
/** Earlier-stage replacement targets judged at Screening/Pre-FS. */
function judgeEarlierTargets(projectId: string) {
  for (const it of ["gf-04", "gf-09", "gf-10"]) judge(projectId, "chk-greenfield-feasibility-checklist", it, "pass");
}

beforeAll(async () => {
  for (const [id, pw] of [[A1, "pw-ws-analyst-1"], [A2, "pw-ws-analyst-2"], [AGENT, "pw-agent-1234567"]] as const) {
    await createUser(db, { userId: id, role: "analyst", password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  c1 = await loginCookie(A1, "pw-ws-analyst-1");
  agentCookie = await loginCookie(AGENT, "pw-agent-1234567");
  bearer = issueApiToken(db, { userId: A1, label: "agent", scopes: ["read", "write"], now: NOW }).token;
});

afterAll(() => {
  gf.setWorkspaceOverlayForTest();
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("(a) Y per sub-track (design section 5)", () => {
  test("null sub-track: 56 (55 before the risk-officer review 2026-10-12)", () => {
    const p = seedProject("greenfield", null);
    judgeEarlierTargets(p);
    const c = tailor.ddCompletionSummary(p);
    expect(c.workspace_judgeable).toBe(56);
    expect(c.excluded).toBe(21);
    expect(c.judgeable).toBe(56); // no sub-track extras
  });
  // Risk review 2026-10-12: in-S9 replacement targets now need a pass/fail row too, so with only the
  // earlier-stage targets judged the in-S9 X rows stay judgeable (rbd: 59 -> 60, 62 -> 63); risk-officer review 2026-10-12 (ldd-06 N -> R) adds 1 more (61, 64).
  test("existing_business_rbd: 61, +3 when the site is in scope", () => {
    const off = seedProject("greenfield", "existing_business_rbd");
    judgeEarlierTargets(off);
    setSite(off, false);
    expect(tailor.ddCompletionSummary(off).workspace_judgeable).toBe(61);
    const on = seedProject("greenfield", "existing_business_rbd");
    judgeEarlierTargets(on);
    setSite(on, true);
    expect(tailor.ddCompletionSummary(on).workspace_judgeable).toBe(64);
    const unconfirmed = seedProject("greenfield", "existing_business_rbd"); // fail-closed: site applies
    expect(tailor.ddCompletionSummary(unconfirmed).workspace_judgeable).toBe(64);
  });
  test("intra_venture: 59 with in-S9 targets unjudged (55 once decided), +3 when the site is in scope; extras add to Y", () => {
    const off = seedProject("greenfield", "intra_venture");
    setSite(off, false);
    const c = tailor.ddCompletionSummary(off);
    expect(c.workspace_judgeable).toBe(59); // 55 before the risk-officer review 2026-10-12 (+4 N -> R); 51 under the membership-only rule
    const extras = ["chk-rbd-technology-checklist", "chk-entity-formation-checklist"].reduce((n, id) => n + (gf.scopedChecklistItems(id)?.length ?? 0), 0);
    expect(c.judgeable).toBe(59 + extras);
    const on = seedProject("greenfield", "intra_venture");
    setSite(on, true);
    expect(tailor.ddCompletionSummary(on).workspace_judgeable).toBe(62);
  });
});

describe("(b) replacement pointers", () => {
  test("earlier-stage target never judged: the S9 item is judgeable again", () => {
    const p = seedProject("greenfield", null);
    expect(tailor.ddCompletionSummary(p).workspace_judgeable).toBe(58); // 56 + cdd-04 + ldd-15 revert
    const cdd04 = gf.workspaceItemScope(p, "chk-commercial-dd-checklist", "cdd-04", db)!;
    expect(cdd04.judgeable).toBe(true);
    expect(cdd04.fallback).toBe("replacement_not_judged");
    expect(cdd04.replaced_by[0]).toMatchObject({ item_id: "gf-09", judged: false, in_s9: false });
  });
  test("judged target: read-only pointer status, item out of Y", () => {
    const p = seedProject("greenfield", null);
    judgeEarlierTargets(p);
    const sc = gf.workspaceItemScope(p, "chk-legal-dd-checklist", "ldd-15", db)!;
    expect(sc.code).toBe("X");
    expect(sc.replaced_by[0]).toMatchObject({ item_id: "gf-04", status: "pass", judged: true });
  });
  test("S9-internal targets (IV ef-03) hold the X only once judged pass/fail", () => {
    const p = seedProject("greenfield", "intra_venture");
    expect(gf.workspaceItemScope(p, "chk-legal-dd-checklist", "ldd-02", db)!).toMatchObject({ code: "A", judgeable: true, fallback: "replacement_not_judged" });
    judge(p, "chk-entity-formation-checklist", "ef-03", "pass");
    expect(gf.workspaceItemScope(p, "chk-legal-dd-checklist", "ldd-02", db)!.code).toBe("X");
  });
  test("ldd-10 (intra_venture -> ef-07): na keeps it judgeable, pass makes it X", () => {
    const na = seedProject("greenfield", "intra_venture");
    judge(na, "chk-entity-formation-checklist", "ef-07", "na");
    expect(gf.workspaceItemScope(na, "chk-legal-dd-checklist", "ldd-10", db)!).toMatchObject({ code: "A", judgeable: true });
    const w = seedProject("greenfield", "intra_venture");
    judge(w, "chk-entity-formation-checklist", "ef-07", "waived");
    expect(gf.workspaceItemScope(w, "chk-legal-dd-checklist", "ldd-10", db)!.judgeable).toBe(true);
    const pass = seedProject("greenfield", "intra_venture");
    judge(pass, "chk-entity-formation-checklist", "ef-07", "pass");
    // ldd-10 also points to rbd-03: the X needs every target decided
    expect(gf.workspaceItemScope(pass, "chk-legal-dd-checklist", "ldd-10", db)!.judgeable).toBe(true);
    judge(pass, "chk-rbd-technology-checklist", "rbd-03", "pass");
    const sc = gf.workspaceItemScope(pass, "chk-legal-dd-checklist", "ldd-10", db)!;
    expect(sc.code).toBe("X");
    expect(sc.replaced_by.find((r) => r.item_id === "ef-07")).toMatchObject({ status: "pass", judged: true, in_s9: true });
  });
  test("ldd-15 -> gf-04: na keeps it judgeable, pass makes it X", () => {
    const na = seedProject("greenfield", null);
    judge(na, "chk-greenfield-feasibility-checklist", "gf-04", "na");
    expect(gf.workspaceItemScope(na, "chk-legal-dd-checklist", "ldd-15", db)!).toMatchObject({ code: "A", judgeable: true });
    const pass = seedProject("greenfield", null);
    judge(pass, "chk-greenfield-feasibility-checklist", "gf-04", "pass");
    expect(gf.workspaceItemScope(pass, "chk-legal-dd-checklist", "ldd-15", db)!.code).toBe("X");
  });
});

describe("(c) unchanged payloads", () => {
  test("brownfield: no scope keys, summary shape unchanged", () => {
    const p = seedProject("brownfield", "m_and_a");
    const c = tailor.ddCompletionSummary(p);
    expect(Object.keys(c).sort()).toEqual(["mandatoryUnmet", "pending", "total", "unassessed"]);
    const ws = tailor.listDdWorkspace(p);
    expect(ws.greenfield_scope).toBeUndefined();
    for (const d of ws.domains) for (const i of d.items) expect("scope" in i).toBe(false);
    expect(gf.naRequiresReason(p, "chk-commercial-dd-checklist", "cdd-01", db)).toBe(false);
  });
  test("grandfathered greenfield: old view and counts until opt-in", () => {
    const p = seedProject("greenfield", null, { old: true });
    expect(gf.workspaceScopeContext(p, db)).toBeNull();
    const c = tailor.ddCompletionSummary(p);
    expect(c.judged).toBeUndefined();
    const ws = tailor.listDdWorkspace(p);
    expect(ws.greenfield_scope!.workspace_scope).toBeUndefined();
    for (const d of ws.domains) for (const i of d.items) expect("scope" in i).toBe(false);
  });
  test("grandfathered / brownfield: hr stays reference-only (counted false)", () => {
    for (const p of [seedProject("greenfield", null, { old: true }), seedProject("brownfield", "m_and_a", { old: true })]) {
      judge(p, "chk-hr-dd-checklist", "hdd-01", "pending");
      expect(tailor.listDdWorkspace(p).domains.find((d) => d.domain === "hr")).toMatchObject({ counted: false });
      expect(tailor.ddCompletionSummary(p)).toMatchObject({ total: 0, pending: 0 });
    }
  });
  test("ADR-0160 opt-in alone does not move a project into the workspace scope (section 10)", () => {
    const p = seedProject("greenfield", "existing_business_rbd", { old: true });
    expect(gf.optInSubTrackSelection({ projectId: p, migrationNote: "site scoping only", actor: A1 }, db).ok).toBe(true);
    expect(gf.workspaceScopeContext(p, db)).toBeNull();
  });
  test("new scope: dd GET carries per-item scope, step tags, plan readiness", () => {
    const p = seedProject("greenfield", "existing_business_rbd");
    const ws = tailor.listDdWorkspace(p).greenfield_scope!.workspace_scope!;
    expect(ws.overlay_doc_id).toBe("ovl-greenfield-workspace-scope");
    expect(ws.plan_readiness.map((r) => r.step)).toEqual([4, 5, 6]);
    const s6 = () => tailor.listDdWorkspace(p).greenfield_scope!.workspace_scope!.plan_readiness.find((r) => r.step === 6)!;
    expect(s6()).toMatchObject({ status: "not_recorded", detail: "hdd-01(핵심 인력 지도)을 아직 판정하지 않았습니다. 인력/조직 계획 탭에서 판정하세요." });
    judge(p, "chk-hr-dd-checklist", "hdd-01", "pending");
    expect(s6()).toMatchObject({ status: "not_recorded", detail: "hdd-01(핵심 인력 지도) 판정이 보류 중입니다." });
    db.run("UPDATE project_checklist_item_state SET status = 'pass' WHERE project_id = ? AND item_id = 'hdd-01'", [p]);
    expect(s6()).toMatchObject({ status: "recorded", detail: "hdd-01(핵심 인력 지도) 판정 통과로 확인되었습니다." });
    expect(ws.step_tabs.hr!.map((t) => t.step)).toEqual([2, 6]);
    expect(ws.items["chk-financing-plan-checklist:fin-06"]!.code).toBe("N");
    expect(ws.items["chk-commercial-dd-checklist:cdd-01"]!.reading).toBeTruthy();
    expect(gf.naRequiresReason(p, "chk-commercial-dd-checklist", "cdd-01", db)).toBe(true);
  });
});

describe("(d) opt-in preview and opt-in on a 37-judgement fixture", () => {
  test("preview numbers, no rows deleted, fails stay unmet", () => {
    const p = seedProject("greenfield", null, { old: true }); // created before 2026-10-01: three counted domains
    judgeEarlierTargets(p);
    const keys = ["chk-commercial-dd-checklist", "chk-technical-dd-checklist", "chk-legal-dd-checklist"].flatMap((c) => getChecklistItems(c)!.map((i) => [c, i.id] as const));
    expect(keys.length).toBe(38);
    const fixture = keys.filter(([, id]) => id !== "ldd-22"); // 37 judgements
    for (const [c, id] of fixture) judge(p, c, id, id === "ldd-01" ? "fail" : "pass");
    // Reference-only hr judgements recorded before the opt-in (hdd-03 is N for null).
    judge(p, "chk-hr-dd-checklist", "hdd-01", "pass");
    judge(p, "chk-hr-dd-checklist", "hdd-03", "pass");
    const before = tailor.ddCompletionSummary(p);
    const rowsBefore = (db.query("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ?").get(p) as { c: number }).c;

    const pv = tailor.workspaceOptInPreview(p)!;
    expect(pv.eligible).toBe(true);
    expect(pv.before).toMatchObject({ judged: 37, judgeable: 38 });
    // hr (9 judgeable for null, 2 N) enters the count with the scope; hdd-01 is already judged.
    expect(pv.after).toMatchObject({ judged: 27, judgeable: 35, workspace_judgeable: 35, excluded: 14 });
    expect(pv.newly_counted).toEqual([{ checklist_id: "chk-hr-dd-checklist", judgeable: 9, judged: 1, judged_item_ids: ["hdd-01"] }]);
    expect(pv.moves_to_previous_scope.map((m) => m.item_id).sort()).toEqual(
      ["cdd-02", "cdd-04", "hdd-03", "ldd-01", "ldd-02", "ldd-03", "ldd-04", "ldd-06", "ldd-07", "ldd-08", "ldd-15", "ldd-20"].sort(),
    );
    expect(pv.fails_stay_unmet.map((m) => m.item_id)).toEqual(["ldd-01"]);
    expect(pv.after.mandatory_unmet).toBe(before.mandatoryUnmet);
    expect(before.mandatoryUnmet).toBe(1);

    const r = gf.optInWorkspaceScope({ projectId: p, migrationNote: "PRJ preview reviewed", actor: A1 }, db);
    expect(r.ok).toBe(true);
    const rowsAfter = (db.query("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ?").get(p) as { c: number }).c;
    expect(rowsAfter).toBe(rowsBefore);
    const after = tailor.ddCompletionSummary(p);
    expect(after).toMatchObject({ judged: 27, judgeable: 35, mandatoryUnmet: 1 });
    const domains = tailor.listDdWorkspace(p).domains;
    expect(domains.find((d) => d.domain === "hr")).toMatchObject({ counted: true });
    for (const d of ["financial", "market", "financing"]) expect(domains.find((x) => x.domain === d)).toMatchObject({ counted: false });
    expect(tailor.workspaceOptInPreview(p)!.newly_counted).toEqual([]);
    const prev = tailor.listDdWorkspace(p).greenfield_scope!.workspace_scope!.previous_scope;
    expect(prev.find((e) => e.item_id === "ldd-01")).toMatchObject({ status: "fail", stays_unmet: true, assessed_by: A1 });
    expect(tailor.workspaceOptInPreview(p)!.eligible).toBe(false);
  });
});

describe("(e) server enforcement", () => {
  test("new judgement on an N item -> 409; existing row may be re-judged (clears a fail)", () => {
    const p = seedProject("greenfield", null);
    let e: unknown;
    try {
      tailor.upsertChecklistState(p, "chk-financing-plan-checklist", "fin-07", "pass", A1);
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(DdTargetError);
    expect((e as InstanceType<typeof DdTargetError>).code).toBe("dd_item_out_of_scope");
    judge(p, "chk-legal-dd-checklist", "ldd-01", "fail");
    expect(tailor.ddCompletionSummary(p).mandatoryUnmet).toBe(1);
    expect(tailor.upsertChecklistState(p, "chk-legal-dd-checklist", "ldd-01", "pass", A1)).not.toBeNull();
    expect(tailor.ddCompletionSummary(p).mandatoryUnmet).toBe(0);
  });
  test("HTTP PUT state on an out-of-scope item -> 409", async () => {
    const p = seedProject("greenfield", null);
    const r = await nextRequest(`/api/projects/${p}/dd-checklist/state`, {
      method: "PUT", headers: { cookie: c1 }, body: JSON.stringify({ checklist_id: "chk-financing-plan-checklist", item_id: "fin-08", status: "pass" }),
    });
    expect(r.status).toBe(409);
  });
});

describe("(f) opt-in route", () => {
  test("wiring: HUMAN_ONLY_ROUTES + coverage exclusions", () => {
    expect(isHumanOnly("POST", "/api/projects/X/greenfield-scope/workspace-opt-in", {})).toBe(true);
    expect(readFileSync("scripts/co-newbiz/mcp-coverage.exclusions.yaml", "utf-8")).toContain('route: "POST /api/projects/{}/greenfield-scope/workspace-opt-in"');
  });
  test("bearer / agent 403; note required; human 201 with audit; second 409; GET preview", async () => {
    const p = seedProject("greenfield", "intra_venture", { old: true });
    const path = `/api/projects/${p}/greenfield-scope/workspace-opt-in`;
    const g = await nextRequest(path, { headers: { cookie: c1 } });
    expect(g.status).toBe(200);
    expect((await json(g)).data.preview.records_subtrack_pin).toBe(true);
    const b = await nextRequest(path, { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ migration_note: "x" }) });
    expect(b.status).toBe(403);
    expect((await json(b)).error.code).toBe("human_only");
    const a = await nextRequest(path, { method: "POST", headers: { cookie: agentCookie }, body: JSON.stringify({ migration_note: "x" }) });
    expect(a.status).toBe(403);
    const n = await nextRequest(path, { method: "POST", headers: { cookie: c1 }, body: JSON.stringify({}) });
    expect(n.status).toBe(400);
    const ok = await nextRequest(path, { method: "POST", headers: { cookie: c1 }, body: JSON.stringify({ migration_note: "opt in after preview" }) });
    expect(ok.status).toBe(201);
    const body = await json(ok);
    expect(body.data.subtrack_pin_id).toBeTruthy();
    const audit = db.query("SELECT target FROM audit_log WHERE action = 'policy_pin_migrated' AND target LIKE ?").all(`${p}:ovl-greenfield-workspace-scope%`) as { target: string }[];
    expect(audit.length).toBe(1);
    expect(audit[0]!.target).toContain("migration_note=opt in after preview");
    expect(gf.workspaceScopeContext(p, db)).not.toBeNull();
    const again = await nextRequest(path, { method: "POST", headers: { cookie: c1 }, body: JSON.stringify({ migration_note: "again" }) });
    expect(again.status).toBe(409);
  });
});

describe("(g) fail-closed overlay rows", () => {
  test("unapproved row and missing row apply as-is (A)", () => {
    const raw = structuredClone(getWorkspaceOverlay()) as any;
    const legal = raw.checklists["chk-legal-dd-checklist"].items;
    legal.find((r: any) => r.id === "ldd-07").approval.status = "proposed";
    raw.checklists["chk-legal-dd-checklist"].items = legal.filter((r: any) => r.id !== "ldd-08");
    gf.setWorkspaceOverlayForTest(raw);
    try {
      const p = seedProject("greenfield", null);
      expect(gf.workspaceItemScope(p, "chk-legal-dd-checklist", "ldd-07", db)).toMatchObject({ code: "A", judgeable: true, fallback: "unapproved" });
      expect(gf.workspaceItemScope(p, "chk-legal-dd-checklist", "ldd-08", db)).toMatchObject({ code: "A", judgeable: true, fallback: "missing_from_overlay" });
    } finally {
      gf.setWorkspaceOverlayForTest();
    }
  });
  test("no overlay at all: workspace scope inactive", () => {
    gf.setWorkspaceOverlayForTest(null);
    try {
      const p = seedProject("greenfield", null);
      expect(gf.workspaceScopeContext(p, db)).toBeNull();
      expect(tailor.ddCompletionSummary(p).judged).toBeUndefined();
    } finally {
      gf.setWorkspaceOverlayForTest();
    }
  });
});

describe("(h) lens constituents excluded by the overlay are absent, not pending (2026-10-22 live-use report)", () => {
  test("greenfield T3: hdd-03 is overlay-N — the three judgeable constituents roll T3 to met (3/3)", () => {
    const p = seedProject("greenfield", null);
    // hdd-03 carries NO state row and the workspace scope marks it N (Day-1 does not
    // exist for greenfield) — before the fix the S8 lens rolled it up as pending and
    // T3 could never complete.
    const judged: Array<[string, string]> = [
      ["chk-technical-dd-checklist", "tdd-05"],
      ["chk-technical-dd-checklist", "tdd-07"],
      ["chk-hr-dd-checklist", "hdd-01"],
    ];
    for (const [cl, id] of judged) {
      db.run(
        "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, note, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), p, cl, id, "pass", "test", A1, NOW],
      );
    }
    // The workspace item itself must carry the exclusion flag the lens filters on.
    const hr = tailor.listDdWorkspace(p, { targetId: null }).domains.find((d) => d.checklistId === "chk-hr-dd-checklist")!;
    const hdd03 = hr.items.find((x) => x.id === "hdd-03")!;
    expect(hdd03.scope?.judgeable).toBe(false);

    const s = buildS8LensSummary(db, p);
    const t3 = s.technical.items.find((i) => i.key === "T3")!;
    expect(t3.status).toBe("met");
    expect(t3.note).toContain("구성 항목 3건"); // 4가 아니라 3 — 범위 밖 항목은 부재
    // The other lens items keep their own constituent sets (tdd-03/04 unjudged -> undetermined).
    const t2 = s.technical.items.find((i) => i.key === "T2")!;
    expect(t2.status).toBe("undetermined");
  });
});
