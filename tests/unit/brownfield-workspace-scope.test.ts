// @version 1.0.0
/**
 * ADR-0162 — brownfield S9 workspace scope by sub-track (Row 3 of design
 * 2026-10-12-brownfield-dd-workspace-scope-by-subtrack), against a scratch
 * SQLite and the REAL route handlers:
 *  (a) per sub-track counts (design §5 / §7) and extra-section scoping (§6);
 *  (b) m_and_a byte-identical; grandfathered and null sub-track unchanged; greenfield unaffected;
 *  (c) opt-in preview on a PRJ-QGB2W5-like 37-judgement fixture; opt-in keeps every row; fails stay unmet;
 *  (d) server enforcement: new judgement on N/X -> 409; na needs a reason;
 *  (e) opt-in route human-only (bearer / agent 403), migration_note, audit, wiring;
 *  (f) fail-closed (unapproved / missing rows, X target not attached, no overlay);
 *  (g) overlay extra_checklists.attached_to == SUB_TRACK_DD_CHECKLISTS;
 *  (h) read-only in-flight counts helper.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-brownfield-workspace-scope.sqlite";
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
const bf = await import("../../app/web-next/lib/brownfield-subtrack.ts");
const tailor = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
const { getChecklistItems, getBrownfieldWorkspaceOverlay, SUB_TRACK_DD_CHECKLISTS, DD_WORKSPACE_CHECKLISTS } = await import("../../app/web-next/lib/library.ts");
const { DdTargetError } = await import("../../app/web-next/lib/dd-target.ts");

const NOW = new Date().toISOString();
const OLD = "2026-09-03T00:00:00.000Z"; // before 2026-10-01, WAVE_F and the BF cut-off
const MID = "2026-10-09T00:00:00.000Z"; // after 2026-10-01 and WAVE_F, before a later BF cut-off
const NEW = "2026-10-20T00:00:00.000Z";
const A1 = "bfws_analyst1";
const AGENT = [...AGENT_KEYS][0];
let c1 = "";
let agentCookie = "";
let bearer = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const json = async (res: Response) => (await res.json()) as Record<string, any>;

function seedProject(track: "greenfield" | "brownfield", subTrack: string | null, createdAt = NEW): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `bf ${ulid()}`, "테스트", "selected", A1, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), opp, track, subTrack, "test", A1, NOW]);
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, track) VALUES (?,?,?,?,?)", [id, `BF-${id.slice(-8)}`, createdAt, opp, track]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, A1, "member", "root", NOW, "author"]);
  db.run("UPDATE project_policy_pin SET pinned_at = ? WHERE project_id = ?", [createdAt, id]);
  return id;
}

function judge(projectId: string, checklistId: string, itemId: string, status: string) {
  db.run(
    "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), projectId, checklistId, itemId, status, A1, OLD],
  );
}
const rowCount = (p: string) => (db.query("SELECT COUNT(*) c FROM project_checklist_item_state WHERE project_id = ?").get(p) as { c: number }).c;
const L = DD_WORKSPACE_CHECKLISTS.legal!;
const C = DD_WORKSPACE_CHECKLISTS.commercial!;
const T = DD_WORKSPACE_CHECKLISTS.technical!;
const F = DD_WORKSPACE_CHECKLISTS.financial!;

beforeAll(async () => {
  for (const [id, pw] of [[A1, "pw-bfws-analyst-1"], [AGENT, "pw-agent-1234567"]] as const) {
    await createUser(db, { userId: id, role: "analyst", password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  c1 = await loginCookie(A1, "pw-bfws-analyst-1");
  agentCookie = await loginCookie(AGENT, "pw-agent-1234567");
  bearer = issueApiToken(db, { userId: A1, label: "agent", scopes: ["read", "write"], now: NOW }).token;
});

afterAll(() => {
  bf.setBrownfieldOverlayForTest();
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const EXPECTED: Record<string, [number, number]> = {
  m_and_a: [77, 102],
  jv: [75, 93],
  strategic_investment: [71, 71],
  minority_investment: [71, 87],
  partnership: [52, 78],
  rbd: [77, 92],
  corporate_venture: [71, 71],
};

describe("(a) counts per sub-track (design sections 5 and 7)", () => {
  test("static counts from the overlay", () => {
    for (const [st, [ws, total]] of Object.entries(EXPECTED)) {
      const c = bf.brownfieldScopeCounts(st as never);
      expect([st, c.workspace_judgeable, c.total_judgeable]).toEqual([st, ws, total]);
    }
    expect(bf.brownfieldScopeCounts("partnership")).toMatchObject({ A: 22, R: 30, X: 2, N: 23 }); // fin-09 R -> A (risk-officer review 2026-10-12)
  });
  test("ddCompletionSummary of an in-scope project (all extras attached, X targets in S9)", () => {
    for (const [st, [ws, total]] of Object.entries(EXPECTED)) {
      const p = seedProject("brownfield", st);
      const c = tailor.ddCompletionSummary(p);
      if (st === "m_and_a") {
        expect(c.judgeable).toBeUndefined(); // baseline path
        expect(c.unassessed).toBe(102);
        continue;
      }
      // Risk review 2026-10-12: an X holds only on a pass/fail target, so partnership's two X rows
      // (fdd-01/02 -> pt-03, pt-03 not yet judged) revert to judgeable in this unjudged fixture.
      const shift = st === "partnership" ? 2 : 0;
      expect([st, c.workspace_judgeable, c.judgeable, c.unassessed]).toEqual([st, ws + shift, total + shift, total + shift]);
    }
  });
  test("extras section scoping (design section 6)", () => {
    const ids = (st: string, c: string) => {
      const p = seedProject("brownfield", st);
      const d = tailor.listDdWorkspace(p).domains.find((x) => x.checklistId === c)!;
      return d.items.filter((i) => i.scope?.judgeable !== false).map((i) => i.id);
    };
    const DS = "chk-deal-shape-presigning-checklist";
    expect(ids("minority_investment", DS)).toEqual(["min-01", "min-02", "min-03", "min-04", "min-05"]);
    expect(ids("minority_investment", "chk-partnership-checklist")).toHaveLength(11);
    expect(ids("minority_investment", "chk-partnership-checklist")).not.toContain("pt-06");
    expect(ids("jv", DS).every((i) => i.startsWith("jvd-"))).toBe(true);
    expect(ids("jv", DS)).toHaveLength(6);
    expect(ids("jv", "chk-partnership-checklist")).toHaveLength(12);
    const pt = ids("partnership", DS);
    expect(pt).toHaveLength(15);
    expect(pt.every((i) => i.startsWith("lic-") || i.startsWith("cdv-"))).toBe(true);
    const p = seedProject("brownfield", "minority_investment");
    const jvd = tailor.listDdWorkspace(p).domains.find((x) => x.checklistId === DS)!.items.find((i) => i.id === "jvd-01")!;
    expect(jvd.scope).toMatchObject({ code: "N", judgeable: false, note: "section:jvd" });
    expect(jvd.scope!.reason).toBeTruthy();
  });
  test("partnership X rows point to pt-03 in the attached partnership checklist; X only on a pass/fail pt-03", () => {
    const p = seedProject("brownfield", "partnership");
    const unjudged = bf.brownfieldItemScope(p, F, "fdd-01", db)!;
    expect(unjudged).toMatchObject({ code: "A", judgeable: true, fallback: "replacement_not_judged" });
    expect(unjudged.replaced_by[0]).toMatchObject({ checklist_id: "chk-partnership-checklist", item_id: "pt-03", in_s9: true, judged: false });
    const na = seedProject("brownfield", "partnership");
    judge(na, "chk-partnership-checklist", "pt-03", "na");
    expect(bf.brownfieldItemScope(na, F, "fdd-01", db)).toMatchObject({ code: "A", judgeable: true });
    const pass = seedProject("brownfield", "partnership");
    judge(pass, "chk-partnership-checklist", "pt-03", "pass");
    const sc = bf.brownfieldItemScope(pass, F, "fdd-01", db)!;
    expect(sc.code).toBe("X");
    expect(sc.replaced_by[0]).toMatchObject({ checklist_id: "chk-partnership-checklist", item_id: "pt-03", in_s9: true, status: "pass", judged: true });
  });
});

describe("(b) unchanged paths", () => {
  test("m_and_a: payload and counts byte-identical to the path without any brownfield overlay", () => {
    const p = seedProject("brownfield", "m_and_a");
    judge(p, L, "ldd-07", "pass");
    judge(p, "chk-brownfield-feasibility-checklist", "bf-01", "na");
    const withOv = JSON.stringify([tailor.listDdWorkspace(p), tailor.ddCompletionSummary(p)]);
    bf.setBrownfieldOverlayForTest(null);
    try {
      expect(JSON.stringify([tailor.listDdWorkspace(p), tailor.ddCompletionSummary(p)])).toBe(withOv);
    } finally {
      bf.setBrownfieldOverlayForTest();
    }
    expect(Object.keys(tailor.ddCompletionSummary(p)).sort()).toEqual(["mandatoryUnmet", "pending", "total", "unassessed"]);
    expect(tailor.listDdWorkspace(p).brownfield_scope).toBeUndefined();
    expect(bf.brownfieldNaRequiresReason(p, L, db)).toBe(false);
  });
  test("grandfathered and null sub-track: identical to the no-overlay path", () => {
    for (const p of [seedProject("brownfield", "strategic_investment", MID), seedProject("brownfield", null)]) {
      judge(p, L, "ldd-14", "pass");
      const withOv = JSON.stringify([tailor.listDdWorkspace(p), tailor.ddCompletionSummary(p)]);
      bf.setBrownfieldOverlayForTest(null);
      try {
        expect(JSON.stringify([tailor.listDdWorkspace(p), tailor.ddCompletionSummary(p)])).toBe(withOv);
      } finally {
        bf.setBrownfieldOverlayForTest();
      }
      expect(bf.brownfieldScopeContext(p, db)).toBeNull();
    }
  });
  test("greenfield unaffected: no brownfield key, brownfield helpers inert", () => {
    const p = seedProject("greenfield", null);
    const ws = tailor.listDdWorkspace(p);
    expect(ws.brownfield_scope).toBeUndefined();
    expect(ws.greenfield_scope).toBeDefined();
    expect(bf.brownfieldRouteInfo(p, db)).toBeNull();
    expect(tailor.brownfieldOptInPreview(p)).toBeNull();
    expect(bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "x", actor: A1 }, db)).toMatchObject({ ok: false, code: "not_brownfield" });
  });
  test("extras attach rule equals subTrackChecklistIds for brownfield", () => {
    for (const st of bf.BROWNFIELD_SUB_TRACKS) {
      for (const at of [OLD, MID, NEW]) {
        const p = seedProject("brownfield", st, at);
        expect(bf.brownfieldAttachedExtras(p, st, db)).toEqual(tailor.subTrackChecklistIds(p));
        if (st !== "m_and_a" && at === OLD) {
          bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "x", actor: A1 }, db);
          expect(bf.brownfieldAttachedExtras(p, st, db)).toEqual(SUB_TRACK_DD_CHECKLISTS[st] ?? []);
          expect(tailor.subTrackChecklistIds(p)).toEqual(SUB_TRACK_DD_CHECKLISTS[st] ?? []);
        }
      }
    }
  });
});

describe("(c) opt-in preview on a PRJ-QGB2W5-like fixture (strategic_investment, 37 judgements)", () => {
  test("preview, opt-in keeps every row, ldd-07/14 move (ldd-22 is R for SI since overlay 1.1.0), fail stays unmet", () => {
    const p = seedProject("brownfield", "strategic_investment", OLD);
    const commercial = getChecklistItems(C)!.slice(0, 7).map((i) => [C, i.id] as const);
    const legal = getChecklistItems(L)!.map((i) => [L, i.id] as const);
    const technical = getChecklistItems(T)!.map((i) => [T, i.id] as const);
    const fixture = [...commercial, ...legal, ...technical];
    expect([commercial.length, legal.length, technical.length, fixture.length]).toEqual([7, 22, 8, 37]);
    for (const [c, id] of fixture) judge(p, c, id, id === "ldd-14" ? "fail" : "pass");
    const before = tailor.ddCompletionSummary(p);
    const rowsBefore = rowCount(p);

    const pv = tailor.brownfieldOptInPreview(p)!;
    expect(pv.eligible).toBe(true);
    expect(pv.before).toMatchObject({ judged: 37, judgeable: 38 }); // three counted domains (created before 2026-10-01), no extras
    expect(pv.after).toMatchObject({ judged: 35, judgeable: 36, workspace_judgeable: 36, excluded: 2 });
    expect(pv.moves_to_previous_scope.map((m) => m.item_id).sort()).toEqual(["ldd-07", "ldd-14"]);
    expect(pv.fails_stay_unmet.map((m) => m.item_id)).toEqual(["ldd-14"]);
    expect(before.mandatoryUnmet).toBe(1);
    expect(pv.after.mandatory_unmet).toBe(1);

    const r = bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "preview reviewed", actor: A1 }, db);
    expect(r.ok).toBe(true);
    expect(rowCount(p)).toBe(rowsBefore);
    expect(tailor.ddCompletionSummary(p)).toMatchObject({ judged: 35, judgeable: 36, mandatoryUnmet: 1 });
    const view = tailor.listDdWorkspace(p).brownfield_scope!.workspace_scope;
    expect(view.opted_in).toBe(true);
    expect(view.previous_scope.find((e) => e.item_id === "ldd-14")).toMatchObject({ status: "fail", stays_unmet: true, assessed_by: A1 });
    expect(tailor.brownfieldOptInPreview(p)!.eligible).toBe(false);
    // extras attach rule untouched by the opt-in pin
    expect(tailor.subTrackChecklistIds(p)).toEqual([]);
    // re-judging the moved fail clears it (by a person, never silently)
    expect(tailor.upsertChecklistState(p, L, "ldd-14", "pass", A1)).not.toBeNull();
    expect(tailor.ddCompletionSummary(p).mandatoryUnmet).toBe(0);
  });
  test("PRJ-T7T81A-like (partnership, no S9 rows): nothing moves", () => {
    const p = seedProject("brownfield", "partnership", OLD);
    const pv = tailor.brownfieldOptInPreview(p)!;
    expect(pv.eligible).toBe(true);
    expect(pv.moves_to_previous_scope).toEqual([]);
    expect(pv.before.judgeable).toBe(38);
    // the opt-in attaches the partnership extras (user decision 2026-10-12), section-scoped
    const extras = pv.extras_attached_by_opt_in!;
    expect(extras.map((e) => e.checklist_id)).toEqual(["chk-partnership-checklist", "chk-deal-shape-presigning-checklist"]);
    const extraY = extras.reduce((n, e) => n + e.judgeable, 0);
    expect(extras.find((e) => e.checklist_id === "chk-deal-shape-presigning-checklist")!.judgeable).toBe(15);
    expect(pv.after).toMatchObject({ workspace_judgeable: pv.after.workspace_judgeable, judgeable: pv.after.workspace_judgeable + extraY });
    expect(pv.after.workspace_judgeable + pv.after.excluded).toBe(38);
  });
  test("m_and_a / null sub-track: preview not eligible, opt-in 409-class error", () => {
    const p = seedProject("brownfield", "m_and_a", OLD);
    expect(tailor.brownfieldOptInPreview(p)!.eligible).toBe(false);
    expect(bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "x", actor: A1 }, db)).toMatchObject({ ok: false, code: "no_scope_change" });
  });
});

describe("(d) server enforcement", () => {
  test("new judgement on an N item (workspace and extra) -> 409; existing row may be re-judged", () => {
    const p = seedProject("brownfield", "minority_investment");
    for (const [c, id] of [[DD_WORKSPACE_CHECKLISTS.financing!, "fin-07"], ["chk-deal-shape-presigning-checklist", "jvd-01"]] as const) {
      let e: unknown;
      try {
        tailor.upsertChecklistState(p, c, id, "pass", A1);
      } catch (x) {
        e = x;
      }
      expect(e).toBeInstanceOf(DdTargetError);
      expect((e as InstanceType<typeof DdTargetError>).code).toBe("dd_item_out_of_scope");
    }
    expect(tailor.upsertChecklistState(p, L, "ldd-01", "pass", A1)).not.toBeNull(); // A item fine
  });
  test("HTTP: PUT on out-of-scope item 409; na without note 400 on a workspace item", async () => {
    const p = seedProject("brownfield", "partnership");
    const put = (body: object) => nextRequest(`/api/projects/${p}/dd-checklist/state`, { method: "PUT", headers: { cookie: c1 }, body: JSON.stringify(body) });
    expect((await put({ checklist_id: L, item_id: "ldd-02", status: "pass" })).status).toBe(409);
    const na = await put({ checklist_id: C, item_id: "cdd-05", status: "na" });
    expect(na.status).toBe(400);
    expect((await json(na)).error.code).toBe("na_reason_required");
  });
});

describe("(e) opt-in route", () => {
  test("wiring: HUMAN_ONLY_ROUTES + coverage exclusions", () => {
    expect(isHumanOnly("POST", "/api/projects/X/brownfield-scope/workspace-opt-in", {})).toBe(true);
    expect(readFileSync("scripts/co-newbiz/mcp-coverage.exclusions.yaml", "utf-8")).toContain('route: "POST /api/projects/{}/brownfield-scope/workspace-opt-in"');
  });
  test("bearer / agent 403; note required; human 201 with audit; second 409; GET preview", async () => {
    const p = seedProject("brownfield", "jv", OLD);
    const path = `/api/projects/${p}/brownfield-scope/workspace-opt-in`;
    const g = await nextRequest(path, { headers: { cookie: c1 } });
    expect(g.status).toBe(200);
    expect((await json(g)).data.preview.eligible).toBe(true);
    const b = await nextRequest(path, { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ migration_note: "x" }) });
    expect(b.status).toBe(403);
    expect((await json(b)).error.code).toBe("human_only");
    const a = await nextRequest(path, { method: "POST", headers: { cookie: agentCookie }, body: JSON.stringify({ migration_note: "x" }) });
    expect(a.status).toBe(403);
    const n = await nextRequest(path, { method: "POST", headers: { cookie: c1 }, body: JSON.stringify({}) });
    expect(n.status).toBe(400);
    const ok = await nextRequest(path, { method: "POST", headers: { cookie: c1 }, body: JSON.stringify({ migration_note: "opt in after preview" }) });
    expect(ok.status).toBe(201);
    const audit = db.query("SELECT target FROM audit_log WHERE action = 'policy_pin_migrated' AND target LIKE ?").all(`${p}:ovl-brownfield-workspace-scope%`) as { target: string }[];
    expect(audit.length).toBe(1);
    expect(audit[0]!.target).toContain("migration_note=opt in after preview");
    expect(bf.brownfieldScopeContext(p, db)).not.toBeNull();
    const again = await nextRequest(path, { method: "POST", headers: { cookie: c1 }, body: JSON.stringify({ migration_note: "again" }) });
    expect(again.status).toBe(409);
    const gp = seedProject("greenfield", null);
    expect((await nextRequest(`/api/projects/${gp}/brownfield-scope/workspace-opt-in`, { headers: { cookie: c1 } })).status).toBe(409); // not_brownfield
  });
});

describe("(f) fail-closed", () => {
  test("unapproved and missing rows apply as-is (A)", () => {
    const raw = structuredClone(getBrownfieldWorkspaceOverlay()) as any;
    const legal = raw.checklists[L].items;
    legal.find((r: any) => r.id === "ldd-07").approval.status = "proposed";
    raw.checklists[L].items = legal.filter((r: any) => r.id !== "ldd-14");
    raw.extra_checklists["chk-partnership-checklist"].approval.status = "proposed";
    bf.setBrownfieldOverlayForTest(raw);
    try {
      const p = seedProject("brownfield", "minority_investment");
      expect(bf.brownfieldItemScope(p, L, "ldd-07", db)).toMatchObject({ code: "A", judgeable: true, fallback: "unapproved" });
      expect(bf.brownfieldItemScope(p, L, "ldd-14", db)).toMatchObject({ code: "A", judgeable: true, fallback: "missing_from_overlay" });
      expect(bf.brownfieldItemScope(p, "chk-partnership-checklist", "pt-06", db)).toMatchObject({ code: "A", judgeable: true, fallback: "unapproved" });
    } finally {
      bf.setBrownfieldOverlayForTest();
    }
  });
  test("pre-WAVE_F partnership opted in: extras attach and count; X -> pt-03 resolves", () => {
    const p = seedProject("brownfield", "partnership", OLD);
    expect(tailor.subTrackChecklistIds(p)).toEqual([]);
    const pv = tailor.brownfieldOptInPreview(p)!;
    expect(bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "x", actor: A1 }, db).ok).toBe(true);
    expect(tailor.subTrackChecklistIds(p)).toEqual(["chk-partnership-checklist", "chk-deal-shape-presigning-checklist"]);
    const c = tailor.ddCompletionSummary(p);
    expect(c.judgeable).toBe(pv.after.judgeable);
    expect(c.judgeable! - c.workspace_judgeable!).toBe(11 + 15);
    expect(tailor.listDdWorkspace(p).domains.map((d) => d.checklistId)).toContain("chk-deal-shape-presigning-checklist");
    expect(bf.brownfieldItemScope(p, F, "fdd-01", db)).toMatchObject({ code: "A", judgeable: true }); // pt-03 not judged yet
    judge(p, "chk-partnership-checklist", "pt-03", "fail");
    expect(bf.brownfieldItemScope(p, F, "fdd-01", db)).toMatchObject({ code: "X", judgeable: false });
    expect(tailor.brownfieldOptInPreview(p)!.extras_attached_by_opt_in).toEqual([]);
  });
  test("opt-in on a grandfathered strategic_investment attaches nothing (no extras for SI)", () => {
    const p = seedProject("brownfield", "strategic_investment", OLD);
    expect(tailor.brownfieldOptInPreview(p)!.extras_attached_by_opt_in).toEqual([]);
    expect(bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "x", actor: A1 }, db).ok).toBe(true);
    expect(tailor.subTrackChecklistIds(p)).toEqual([]);
  });
  test("review route is human-only (bearer / agent -> 403 human_only)", async () => {
    const p = seedProject("brownfield", "jv");
    const path = `/api/projects/${p}/dd-checklist/tailor/NOPE/review`;
    const b = await nextRequest(path, { method: "PUT", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ decision: "approved" }) });
    expect(b.status).toBe(403);
    expect((await json(b)).error.code).toBe("human_only");
    const a = await nextRequest(path, { method: "PUT", headers: { cookie: agentCookie }, body: JSON.stringify({ decision: "approved" }) });
    expect(a.status).toBe(403);
    const h = await nextRequest(path, { method: "PUT", headers: { cookie: c1 }, body: JSON.stringify({ decision: "approved" }) });
    expect(h.status).toBe(404);
  });
  test("X target in a checklist not attached -> the original item stays judgeable", () => {
    const raw = structuredClone(getBrownfieldWorkspaceOverlay()) as any;
    const fdd01 = raw.checklists[F].items.find((r: any) => r.id === "fdd-01");
    fdd01.sub_tracks.partnership.replaced_by = [{ checklist: "chk-rbd-technology-checklist", item: "rbd-01", stage: "S9 x" }];
    bf.setBrownfieldOverlayForTest(raw);
    try {
      const p = seedProject("brownfield", "partnership");
      expect(bf.brownfieldItemScope(p, F, "fdd-01", db)).toMatchObject({ code: "A", judgeable: true, fallback: "replacement_not_judged" });
    } finally {
      bf.setBrownfieldOverlayForTest();
    }
  });
  test("binding items can never be excluded, whatever the file says", () => {
    const raw = structuredClone(getBrownfieldWorkspaceOverlay()) as any;
    const fin09 = raw.checklists[DD_WORKSPACE_CHECKLISTS.financing!].items.find((r: any) => r.id === "fin-09");
    fin09.sub_tracks.jv = { code: "N", na_reason: "x" };
    bf.setBrownfieldOverlayForTest(raw);
    try {
      const p = seedProject("brownfield", "jv");
      expect(bf.brownfieldItemScope(p, DD_WORKSPACE_CHECKLISTS.financing!, "fin-09", db)).toMatchObject({ code: "A", judgeable: true, rule: "fail_closed" });
    } finally {
      bf.setBrownfieldOverlayForTest();
    }
  });
  test("no overlay: scope inactive", () => {
    bf.setBrownfieldOverlayForTest(null);
    try {
      const p = seedProject("brownfield", "partnership");
      expect(bf.brownfieldScopeContext(p, db)).toBeNull();
      expect(tailor.ddCompletionSummary(p).judgeable).toBeUndefined();
      expect(bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "x", actor: A1 }, db)).toMatchObject({ ok: false, code: "overlay_unavailable" });
    } finally {
      bf.setBrownfieldOverlayForTest();
    }
  });
});

describe("(g) overlay attached_to mirrors SUB_TRACK_DD_CHECKLISTS", () => {
  test("every extra checklist and only those", () => {
    const raw = getBrownfieldWorkspaceOverlay() as any;
    const fromLib = new Map<string, string[]>();
    for (const st of bf.BROWNFIELD_SUB_TRACKS) for (const c of SUB_TRACK_DD_CHECKLISTS[st] ?? []) fromLib.set(c, [...(fromLib.get(c) ?? []), st]);
    const fromOverlay = new Map(Object.entries(raw.extra_checklists).map(([c, b]: [string, any]) => [c, [...b.attached_to].sort()]));
    expect([...fromOverlay.keys()].sort()).toEqual([...fromLib.keys()].sort());
    for (const [c, sts] of fromLib) expect(fromOverlay.get(c)).toEqual([...sts].sort());
  });
});

describe("(h) in-flight counts helper (read-only, counts only)", () => {
  test("reports grandfathered projects and what an opt-in would move", () => {
    const before = bf.inFlightBrownfieldCounts(db);
    const p = seedProject("brownfield", "strategic_investment", OLD);
    for (const id of ["ldd-07", "ldd-14", "ldd-22", "ldd-01"]) judge(p, L, id, "pass");
    const q = seedProject("brownfield", "partnership", OLD);
    const rowsBefore = rowCount(p) + rowCount(q);
    const after = bf.inFlightBrownfieldCounts(db);
    expect(after.total).toBe(before.total + 2);
    expect(after.grandfathered).toBe(before.grandfathered + 2);
    const pn = db.query("SELECT project_no FROM md_project WHERE id = ?").get(p) as { project_no: string };
    const qn = db.query("SELECT project_no FROM md_project WHERE id = ?").get(q) as { project_no: string };
    expect(after.projects.find((x) => x.project_no === pn.project_no)).toMatchObject({ sub_track: "strategic_investment", grandfathered: true, s9_rows: 4, would_move: 2, fails_stay_unmet: 0 });
    expect(after.projects.find((x) => x.project_no === qn.project_no)).toMatchObject({ sub_track: "partnership", grandfathered: true, s9_rows: 0, would_move: 0 });
    expect(rowCount(p) + rowCount(q)).toBe(rowsBefore);
  });
});

describe("(h) opt-in atomicity (security review 2026-10-12)", () => {
  test("a failing audit write rolls back the pin; the re-check runs inside the transaction", () => {
    const p = seedProject("brownfield", "strategic_investment", OLD);
    const failing = new Proxy(db, {
      get(t, k) {
        if (k === "run") {
          return (sql: string, params?: unknown[]) => {
            if (sql.includes("INSERT INTO audit_log")) throw new Error("disk full");
            return t.run(sql, params as never);
          };
        }
        const v = Reflect.get(t, k, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as typeof db;
    expect(() => bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "note", actor: A1 }, failing)).toThrow(/disk full/);
    expect((db.query("SELECT COUNT(*) c FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = ?").get(p, bf.BF_WS_POLICY_DOC_ID) as { c: number }).c).toBe(0);
    expect(bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "note", actor: A1 }, db)).toMatchObject({ ok: true });
    expect(bf.optInBrownfieldWorkspaceScope({ projectId: p, migrationNote: "again", actor: A1 }, db)).toMatchObject({ ok: false, code: "already_opted_in" });
  });
});
