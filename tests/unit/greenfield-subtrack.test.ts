// @version 1.0.0
/**
 * ADR-0160 addendum (migration 0136) — greenfield sub-track routing vars,
 * S9 selection, site_required human-only route, capex tranches, S10 track
 * validation, against the REAL route handlers and a scratch SQLite:
 *  (a) migration 0136 applies and rolls back cleanly on a temp DB;
 *  (b) routing resolver: project.sub_track ('none' for null) / site_required
 *      (live AND reviewed only); procedure predicates evaluate per the matrix;
 *  (c) S9 selection matrix x cut-off/opt-in x site_required; unknown value warns;
 *  (d) na-reason validation; brownfield unaffected;
 *  (e) greenfield-scope + capex-tranches human-only (bearer/agent 403, wiring);
 *  (f) S10 validation: greenfield refuses M&A inputs, brownfield unchanged;
 *  (g) in-flight greenfield counts (read-only).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { load as parseYaml } from "js-yaml";

const TEST_DB_PATH = "db/data/test-greenfield-subtrack.sqlite";
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
const { resolveRoutingVars, evaluateAppliesWhen } = await import("../../db/lib/applies-when.ts");
const { parsePredicate } = await import("../../db/lib/predicate.ts");
const gf = await import("../../app/web-next/lib/greenfield-subtrack.ts");
const { subTrackChecklistIds, ddCompletionSummary } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
const { SUB_TRACK_DD_CHECKLISTS, scopedSubTrackDdChecklists } = await import("../../app/web-next/lib/library.ts");

const NOW = new Date().toISOString();
const OLD = "2026-09-01T00:00:00.000Z";
/** Fixed post-cut-off creation stamp (GF_SUBTRACK_PREDICATE_DATE) — never wall-clock dependent. */
const NEW = "2026-10-20T00:00:00.000Z";
const A1 = "gf_analyst1";
const A2 = "gf_analyst2";
const AGENT = [...AGENT_KEYS][0];
let c1 = "";
let c2 = "";
let agentCookie = "";
let bearer = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const post = (path: string, body: unknown, cookie = c1) => nextRequest(path, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const put = (path: string, body: unknown, cookie = c1) => nextRequest(path, { method: "PUT", headers: { cookie }, body: JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as Record<string, any>;

function seedProject(track: "greenfield" | "brownfield", subTrack: string | null, opts: { old?: boolean } = {}): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `gf ${ulid()}`, "테스트", "selected", A1, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [
    ulid(), opp, track, subTrack, "test", A1, NOW,
  ]);
  if (track === "greenfield") {
    db.run(
      `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      [ulid(), opp, "직접 진출", "대안", "test", A1, NOW, NOW],
    );
    db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows: [{ id: "g", capability: "c", resolution: "hire" }], updatedAt: NOW }), opp]);
  }
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id) VALUES (?,?,?,?)", [id, `GF-${id.slice(-8)}`, NEW, opp]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, A1, "member", "root", NOW, "author"]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, A2, "member", "root", NOW, "review"]);
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), id, "t", "h", A1, NOW]);
  if (opts.old) {
    db.run("UPDATE md_project SET created_at = ? WHERE id = ?", [OLD, id]);
    db.run("UPDATE project_policy_pin SET pinned_at = ? WHERE project_id = ?", [OLD, id]);
    const n = (db.query("SELECT COUNT(*) c FROM project_policy_pin WHERE project_id = ?").get(id) as { c: number }).c;
    if (n === 0) db.run("INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by) VALUES (?,?,?,?,?,?)", [ulid(), id, "shared-greenfield-dd", "1.0.0", OLD, "t"]);
  }
  return id;
}

/** Confirm site_required directly (single-person confirmation, effective immediately — 2026-10-12). */
function setSite(projectId: string, value: boolean) {
  const a = gf.confirmSiteRequired({ projectId, value, rationale: "현장 확인", actor: A1 }, db);
  if (!a.ok) throw new Error(a.message);
}

beforeAll(async () => {
  for (const [id, pw] of [[A1, "pw-gf-analyst-1"], [A2, "pw-gf-analyst-2"], [AGENT, "pw-agent-1234567"]] as const) {
    await createUser(db, { userId: id, role: "analyst", password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  c1 = await loginCookie(A1, "pw-gf-analyst-1");
  c2 = await loginCookie(A2, "pw-gf-analyst-2");
  agentCookie = await loginCookie(AGENT, "pw-agent-1234567");
  bearer = issueApiToken(db, { userId: A1, label: "agent", scopes: ["read", "write"], now: NOW }).token;
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("(a) migration 0136", () => {
  const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const file = files.find((f) => f.startsWith("0136_"))!;
  const sql = readFileSync(join(DIR, file), "utf-8");
  function fresh(): Database {
    const m = new Database(":memory:");
    m.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) m.run(readFileSync(join(DIR, f), "utf-8"));
    return m;
  }

  test("applies: two seeds (no data default), table, indexes, checks", () => {
    expect(sql).toContain("@reversible: true");
    const m = fresh();
    const seeds = m.query("SELECT var_key, value_type, source_kind, requires_evidence_ref, created_at FROM evidence_var WHERE var_key IN ('project.sub_track','project.site_required') ORDER BY var_key").all();
    expect(seeds).toEqual([
      { var_key: "project.site_required", value_type: "boolean", source_kind: "asserted", requires_evidence_ref: 0, created_at: "2026-10-12T00:00:00Z" }, // 0136 seeds 1; 0138 clears it (user decision 2026-10-12)
      { var_key: "project.sub_track", value_type: "string", source_kind: "column", requires_evidence_ref: 0, created_at: "2026-10-12T00:00:00Z" },
    ]);
    expect((m.query("SELECT COUNT(*) c FROM dimension_input").get() as { c: number }).c).toBe(0);
    const idx = (m.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='capex_tranche'").all() as { name: string }[]).map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(["idx_capex_tranche_project", "idx_capex_tranche_live_no"]));
    m.run("INSERT INTO md_project (id, project_no, created_at) VALUES ('p1','P-1','2026-01-01')");
    const ins = (id: string, no: number, extra: Partial<Record<string, unknown>> = {}) =>
      m.run("INSERT INTO capex_tranche (id, project_id, tranche_no, amount, currency, release_condition, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
        id, "p1", no, (extra.amount as number) ?? 100, (extra.currency as string) ?? "KRW", (extra.cond as string) ?? "인허가 완료", (extra.status as string) ?? "planned", "u", NOW,
      ]);
    ins("t1", 1);
    expect(() => ins("t2", 1)).toThrow(); // live uniqueness
    m.run("UPDATE capex_tranche SET retired_at = ? WHERE id = 't1'", [NOW]);
    ins("t2", 1); // retired frees the slot
    expect(() => ins("t3", 2, { amount: 0 })).toThrow();
    expect(() => ins("t4", 3, { status: "spent" })).toThrow();
    expect(() => ins("t5", 4, { currency: "krw" })).toThrow();
    expect(() => ins("t6", 5, { cond: "  " })).toThrow();
  });

  test("rolls back cleanly with the header's manual rollback SQL", () => {
    const m = fresh();
    const before = fresh();
    // rollback = header statements, in order
    m.run("DROP INDEX idx_capex_tranche_live_no");
    m.run("DROP INDEX idx_capex_tranche_project");
    m.run("DROP TABLE capex_tranche");
    m.run("DELETE FROM evidence_var WHERE var_key IN ('project.sub_track','project.site_required')");
    expect(m.query("SELECT name FROM sqlite_master WHERE name LIKE '%capex_tranche%'").all()).toEqual([]);
    expect((m.query("SELECT COUNT(*) c FROM evidence_var").get() as { c: number }).c).toBe(
      (before.query("SELECT COUNT(*) c FROM evidence_var").get() as { c: number }).c - 2,
    );
    // re-apply after rollback works (idempotent shape)
    m.run(sql);
    expect((m.query("SELECT COUNT(*) c FROM evidence_var WHERE var_key LIKE 'project.s%'").get() as { c: number }).c).toBe(2);
  });
});

describe("(b) routing resolver + greenfield-dd step predicates", () => {
  const yaml = parseYaml(readFileSync("procedures/_shared/greenfield-dd/schema.yaml", "utf-8")) as { steps: { id: number; applies_when?: unknown }[] };
  const applies = (projectId: string) => {
    const lookup = resolveRoutingVars(projectId, db);
    return yaml.steps
      .filter((s) => (s.applies_when ? evaluateAppliesWhen({ procedure: "greenfield-dd", step: s.id }, parsePredicate(s.applies_when), lookup).applies : true))
      .map((s) => s.id)
      .sort((a, b) => a - b);
  };

  test("null sub-track resolves to 'none' and keeps v1.0.0 steps (1-5 only)", () => {
    const p = seedProject("greenfield", null);
    expect(resolveRoutingVars(p, db)("project.sub_track")).toEqual({ status: "present", value: "none" });
    expect(applies(p)).toEqual([1, 2, 3, 4, 5]);
  });
  test("no current route: UNASSESSED, every step applies (fail-closed)", () => {
    const p = seedProject("greenfield", null);
    db.run("UPDATE route_decision SET is_current = 0 WHERE opportunity_id = (SELECT source_opportunity_id FROM md_project WHERE id = ?)", [p]);
    expect(resolveRoutingVars(p, db)("project.sub_track")).toBeUndefined();
    expect(applies(p)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  test("existing_business_rbd: unconfirmed site -> site steps apply; confirmed false -> skipped at once", () => {
    const p = seedProject("greenfield", "existing_business_rbd");
    expect(applies(p)).toEqual([1, 3, 4, 5, 6, 7]);
    const a = gf.confirmSiteRequired({ projectId: p, value: false, rationale: "부지 없음", actor: A1 }, db);
    expect(a.ok).toBe(true);
    // Single-person confirmation (user decision 2026-10-12): effective immediately.
    expect(resolveRoutingVars(p, db)("project.site_required")).toEqual({ status: "present", value: false });
    expect(applies(p)).toEqual([4, 5, 6, 7]);
  });
  test("intra_venture: no default (site steps apply until a human confirms); reviewed false skips them", () => {
    const p = seedProject("greenfield", "intra_venture");
    expect(applies(p)).toEqual([1, 3, 4, 5, 6, 7, 8]);
    setSite(p, false);
    expect(applies(p)).toEqual([4, 5, 6, 7, 8]);
    setSite(p, true);
    expect(applies(p)).toEqual([1, 3, 4, 5, 6, 7, 8]);
  });
  test("unknown (brownfield) value on a greenfield route -> site default, same as null", () => {
    const p = seedProject("greenfield", "m_and_a");
    expect(applies(p)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("(b2) YAML documented intent vs greenfield-subtrack.ts (code is authoritative)", () => {
  const raw = readFileSync("procedures/_shared/greenfield-dd/schema.yaml", "utf-8");
  const yaml = parseYaml(raw) as { steps: { id: number; applies_when?: unknown }[] };
  const yamlApplies = (projectId: string) => {
    const lookup = resolveRoutingVars(projectId, db);
    return yaml.steps
      .filter((s) => (s.applies_when ? evaluateAppliesWhen({ procedure: "greenfield-dd", step: s.id }, parsePredicate(s.applies_when), lookup).applies : true))
      .map((s) => s.id)
      .sort((a, b) => a - b);
  };
  const codeApplies = (projectId: string) => {
    const sel = gf.greenfieldSelection(projectId, db)!;
    return yaml.steps.map((s) => s.id).filter((id) => !sel.excluded_steps.includes(id)).sort((a, b) => a - b);
  };

  test("header marks the predicates as not runtime-evaluated", () => {
    expect(raw).toContain("NOT RUNTIME-EVALUATED");
    expect(raw).toContain("greenfield-subtrack.ts is authoritative");
  });
  for (const sub of [null, "existing_business_rbd", "intra_venture", "m_and_a"]) {
    for (const site of [undefined, true, false] as const) {
      // A plain greenfield (null sub-track) cannot be confirmed site_required=false (risk review 2026-10-12).
      if (sub === null && site === false) continue;
      test(`active cut-off: sub_track=${sub} site_required=${site ?? "unset"}`, () => {
        const p = seedProject("greenfield", sub);
        if (site !== undefined) setSite(p, site);
        expect(codeApplies(p)).toEqual(yamlApplies(p));
      });
    }
  }
  test("documented divergences: grandfathered cut-off and no current route are code-decided", () => {
    const old = seedProject("greenfield", "existing_business_rbd", { old: true });
    expect(gf.greenfieldSelection(old, db)!.excluded_steps).toEqual([6, 7, 8]); // v1.0.0 steps 1-5
    expect(raw).toContain("GF_SUBTRACK_PREDICATE_DATE");
    expect(yamlApplies(old)).toEqual([1, 3, 4, 5, 6, 7]); // YAML ignores the cut-off by design
    const none = seedProject("greenfield", null);
    db.run("UPDATE route_decision SET is_current = 0 WHERE opportunity_id = (SELECT source_opportunity_id FROM md_project WHERE id = ?)", [none]);
    expect(gf.greenfieldSelection(none, db)).toBeNull(); // code: no route -> no greenfield selection
    expect(raw).toContain("no current route");
  });
});

describe("(c) S9 selection", () => {
  test("null greenfield: no extras, unchanged completion inputs", () => {
    const p = seedProject("greenfield", null);
    expect(subTrackChecklistIds(p)).toEqual([]);
    const sel = gf.greenfieldSelection(p, db)!;
    expect(sel.sub_track_class).toBe("none");
    expect(sel.na_reason_checklists).toEqual([]);
  });
  test("existing_business_rbd after cut-off: rbd-technology; intra_venture: + entity-formation (ef-01/03/07)", () => {
    const r = seedProject("greenfield", "existing_business_rbd");
    expect(subTrackChecklistIds(r)).toEqual(["chk-rbd-technology-checklist"]);
    expect(gf.greenfieldSelection(r, db)!.warnings.length).toBe(1); // no site default
    const v = seedProject("greenfield", "intra_venture");
    expect(subTrackChecklistIds(v)).toEqual(["chk-rbd-technology-checklist", "chk-entity-formation-checklist"]);
    expect(gf.scopedChecklistItems("chk-entity-formation-checklist")!.map((i) => i.id)).toEqual(["ef-01", "ef-03", "ef-07"]);
    const sel = gf.greenfieldSelection(v, db)!;
    expect(sel.site).toMatchObject({ site_required: null, basis: "unconfirmed", site_steps_apply: true });
    expect(sel.warnings.length).toBe(1);
    expect(sel.excluded_steps).toEqual([2]);
    expect(sel.na_reason_checklists).not.toContain("chk-technical-dd-checklist");
    setSite(v, false);
    const confirmed = gf.greenfieldSelection(v, db)!;
    expect(confirmed.site).toMatchObject({ site_required: false, basis: "confirmed", site_steps_apply: false });
    expect(confirmed.excluded_steps).toEqual([1, 2, 3]);
    expect(confirmed.na_reason_checklists).toContain("chk-technical-dd-checklist");
    expect(ddCompletionSummary(v).unassessed).toBeGreaterThan(0);
  });
  test("grandfathered project keeps 1.0.0 selection until a recorded opt-in", () => {
    const p = seedProject("greenfield", "existing_business_rbd", { old: true });
    expect(subTrackChecklistIds(p)).toEqual([]);
    expect(gf.greenfieldSelection(p, db)!.selection_active).toBe(false);
    expect(gf.optInSubTrackSelection({ projectId: p, migrationNote: "  ", actor: A1 }, db).ok).toBe(false);
    const o = gf.optInSubTrackSelection({ projectId: p, migrationNote: "R&BD 트랙 판정 기준 적용 — 위원회 합의", actor: A1 }, db);
    expect(o.ok).toBe(true);
    expect(subTrackChecklistIds(p)).toEqual(["chk-rbd-technology-checklist"]);
    expect((db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'policy_pin_migrated' AND target LIKE ?").get(`${p}:%migration_note=%`) as { c: number }).c).toBe(1);
    expect(gf.optInSubTrackSelection({ projectId: p, migrationNote: "again", actor: A1 }, db)).toMatchObject({ ok: false, code: "already_opted_in" });
  });
  test("unknown sub-track value warns, never blocks", () => {
    const p = seedProject("greenfield", "partnership");
    const sel = gf.greenfieldSelection(p, db)!;
    expect(sel.sub_track_class).toBe("unknown");
    expect(sel.extra_checklists).toEqual([]);
    expect(sel.warnings.length).toBe(1);
  });
  test("brownfield regression: same extras as SUB_TRACK_DD_CHECKLISTS, no greenfield scope", () => {
    for (const st of ["m_and_a", "jv", "partnership", "minority_investment", "rbd", "strategic_investment"]) {
      const p = seedProject("brownfield", st);
      // DEC-20261013-03: in-scope (by date) non-baseline brownfield projects get the scoped extras.
      expect(subTrackChecklistIds(p)).toEqual(st === "m_and_a" ? SUB_TRACK_DD_CHECKLISTS[st] ?? [] : scopedSubTrackDdChecklists(st));
      expect(gf.greenfieldSelection(p, db)).toBeNull();
    }
    const old = seedProject("brownfield", "m_and_a", { old: true });
    expect(subTrackChecklistIds(old)).toEqual([]); // WAVE_F grandfathering unchanged
  });
});

describe("(d) na reason", () => {
  // ADR-0160 site-rule behaviour without the addendum (b) workspace overlay
  // (covered by greenfield-workspace-scope.test.ts).
  beforeAll(() => gf.setWorkspaceOverlayForTest(null));
  afterAll(() => gf.setWorkspaceOverlayForTest());
  test("greenfield ruled checklist: na without note -> 400; with note -> 200", async () => {
    const p = seedProject("greenfield", "intra_venture");
    setSite(p, false);
    const path = `/api/projects/${p}/dd-checklist/state`;
    const r1 = await put(path, { checklist_id: "chk-technical-dd-checklist", item_id: "tdd-01", status: "na" });
    expect(r1.status).toBe(400);
    expect((await json(r1)).error.code).toBe("na_reason_required");
    const r2 = await put(path, { checklist_id: "chk-technical-dd-checklist", item_id: "tdd-01", status: "na", note: "부지 없음 (세부 트랙 규칙)" });
    expect(r2.status).toBe(200);
  });
  test("site-excluded greenfield: non-site item of the technical checklist needs no reason", async () => {
    const p = seedProject("greenfield", "intra_venture");
    setSite(p, false);
    const path = `/api/projects/${p}/dd-checklist/state`;
    expect((await put(path, { checklist_id: "chk-technical-dd-checklist", item_id: "tdd-03", status: "na" })).status).toBe(200);
    expect(gf.naRequiresReason(p, "chk-technical-dd-checklist", "tdd-02", db)).toBe(true);
    expect(gf.naRequiresReason(p, "chk-technical-dd-checklist", "tdd-05", db)).toBe(false);
    expect(gf.naRequiresReason(p, "chk-rbd-technology-checklist", undefined, db)).toBe(true);
  });
  test("brownfield: na without note still accepted (unchanged)", async () => {
    const p = seedProject("brownfield", "m_and_a");
    const r = await put(`/api/projects/${p}/dd-checklist/state`, { checklist_id: "chk-technical-dd-checklist", item_id: "tdd-01", status: "na" });
    expect(r.status).toBe(200);
  });
});

describe("(e) human-only routes", () => {
  test("wiring: HUMAN_ONLY_ROUTES + coverage exclusions", () => {
    expect(isHumanOnly("POST", "/api/projects/X/greenfield-scope", {})).toBe(true);
    expect(isHumanOnly("POST", "/api/projects/X/capex-tranches", {})).toBe(true);
    const ex = readFileSync("scripts/co-newbiz/mcp-coverage.exclusions.yaml", "utf-8");
    expect(ex).toContain('route: "POST /api/projects/{}/greenfield-scope"');
    expect(ex).toContain('route: "POST /api/projects/{}/capex-tranches"');
  });
  test("bearer and agent session get 403 human_only", async () => {
    const p = seedProject("greenfield", "existing_business_rbd");
    for (const path of [`/api/projects/${p}/greenfield-scope`, `/api/projects/${p}/capex-tranches`]) {
      const b = await nextRequest(path, { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ action: "create" }) });
      expect(b.status).toBe(403);
      expect((await json(b)).error.code).toBe("human_only");
      const a = await post(path, { action: "create" }, agentCookie);
      expect(a.status).toBe(403);
    }
  });
  test("single-person confirmation {site_required, rationale} drives the scope at once; re-confirm supersedes", async () => {
    const p = seedProject("greenfield", "existing_business_rbd");
    const path = `/api/projects/${p}/greenfield-scope`;
    expect((await post(path, { site_required: false })).status).toBe(400); // rationale required
    expect((await post(path, { site_required: false, rationale: "   " })).status).toBe(400);
    expect((await post(path, { site_required: "no", rationale: "x" })).status).toBe(400);
    // evidence_ref is no longer collected; a client that still sends it is not rejected (ignored).
    const c = await post(path, { site_required: false, rationale: "기존 공장 내 R&BD", evidence_ref: "doc:memo-1" });
    expect(c.status).toBe(201);
    const body = (await json(c)).data;
    expect(body.greenfield_scope.site).toMatchObject({ site_required: false, basis: "confirmed", site_steps_apply: false, pending_assertion: null });
    const row = db.query("SELECT asserted_by, reviewed_by, evidence_ref, rationale FROM dimension_input WHERE id = ?").get(body.assertion_id) as Record<string, string>;
    expect(row).toEqual({ asserted_by: A1, reviewed_by: A1, evidence_ref: "", rationale: "기존 공장 내 R&BD" });
    const audit = db.query("SELECT target FROM audit_log WHERE action = 'dimension_input_single_person_confirmation' AND target LIKE ?").all(`${p}:%`) as { target: string }[];
    expect(audit.length).toBe(1);
    expect(audit[0].target).toContain("single_person_confirmation");
    expect(audit[0].target).toContain("기존 공장 내 R&BD");
    const g = await nextRequest(path, { headers: { cookie: c1 } });
    expect((await json(g)).data.greenfield_scope.excluded_steps).toEqual([1, 2, 3, 8]);
    // Legacy action name still accepted; another person re-confirms -> supersedes, effective at once.
    const c2r = await post(path, { action: "confirm_site_required", site_required: true, rationale: "증설 부지 필요" }, c2);
    expect(c2r.status).toBe(201);
    expect((await json(c2r)).data.greenfield_scope.site).toMatchObject({ site_required: true, basis: "confirmed", site_steps_apply: true });
    expect((db.query("SELECT COUNT(*) c FROM dimension_input WHERE project_id = ? AND var_key = 'project.site_required' AND superseded_by IS NULL").get(p) as { c: number }).c).toBe(1);
    // The removed review action is no longer routed.
    expect((await post(path, { action: "review_site_required", assertion_id: body.assertion_id })).status).toBe(400);
  });
  test("release approval: creator cannot approve a request made by someone else", async () => {
    const p = seedProject("greenfield", null);
    const path = `/api/projects/${p}/capex-tranches`;
    const t = (await json(await post(path, { action: "create", tranche_no: 1, amount: 10, release_condition: "x" }))).data.tranche; // creator A1
    expect((await json(await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "r" }, c2))).data.release_pending).toBe(true); // A2 requests
    const r = await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "r" }); // A1 (creator) tries to approve
    expect(r.status).toBe(409);
    expect((await json(r)).error.code).toBe("second_person_required");
    expect((await post(path, { action: "set_status", tranche_id: t.id, status: "withheld", reason: "hold" })).status).toBe(200);
    const after = await json(await nextRequest(path, { headers: { cookie: c1 } }));
    expect(after.data.tranches[0].pending_release).toBeNull(); // request voided by the status change
  });
  test("create: duplicate check runs inside the transaction and a UNIQUE race maps to tranche_exists", async () => {
    const { createCapexTranche } = await import("../../app/web-next/lib/capex-tranches.ts");
    const p = seedProject("greenfield", null);
    const input = { projectId: p, trancheNo: 1, amount: 10, releaseCondition: "x", actor: A1 };
    expect(createCapexTranche(input, db).ok).toBe(true);
    expect(createCapexTranche(input, db)).toMatchObject({ ok: false, code: "tranche_exists" });
    // simulate a concurrent writer: the in-transaction SELECT misses, the partial UNIQUE index fires
    const blind = new Proxy(db, {
      get(t, k, r) {
        if (k === "query") return (sql: string) => (sql.includes("FROM capex_tranche WHERE project_id = ? AND tranche_no") ? { get: () => null } : t.query(sql));
        if (k === "transaction") return t.transaction.bind(t);
        const v = Reflect.get(t, k, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as typeof db;
    expect(createCapexTranche(input, blind)).toMatchObject({ ok: false, code: "tranche_exists" });
  });
  test("capex tranche CRUD + transitions; brownfield refused", async () => {
    const p = seedProject("greenfield", null);
    const path = `/api/projects/${p}/capex-tranches`;
    const c = await post(path, { action: "create", tranche_no: 1, amount: 5000, release_condition: "공장 인허가 취득" });
    expect(c.status).toBe(201);
    const t = (await json(c)).data.tranche;
    expect(t).toMatchObject({ status: "planned", currency: "KRW", source_stage: "S10" });
    expect((await post(path, { action: "create", tranche_no: 1, amount: 1, release_condition: "x" })).status).toBe(409);
    expect((await post(path, { action: "update", tranche_id: t.id, amount: 6000 })).status).toBe(200);
    expect((await post(path, { action: "set_status", tranche_id: t.id, status: "released" })).status).toBe(400); // reason
    // two-person release: A1 (creator) requests -> pending; A1 again stays pending; A2 approves
    const rq = await json(await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "인허가 완료 확인" }));
    expect(rq.data.release_pending).toBe(true);
    expect(rq.data.tranche).toMatchObject({ status: "planned", pending_release: { requested_by: A1 } });
    expect((await json(await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "again" }))).data.release_pending).toBe(true);
    const listPending = await json(await nextRequest(path, { headers: { cookie: c1 } }));
    expect(listPending.data.tranches[0].pending_release.requested_by).toBe(A1);
    const rel = await json(await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "인허가 승인" }, c2));
    expect(rel.data.release_pending).toBe(false);
    expect(rel.data.tranche).toMatchObject({ status: "released", pending_release: null });
    expect((db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'capex_tranche.released' AND target LIKE ?").get(`${p}:${t.id}:requested_by=${A1}`) as { c: number }).c).toBe(1);
    expect((await post(path, { action: "set_status", tranche_id: t.id, status: "planned", reason: "x" })).status).toBe(409);
    expect((await post(path, { action: "retire", tranche_id: t.id, reason: "x" })).status).toBe(409);
    const list = await json(await nextRequest(path, { headers: { cookie: c1 } }));
    expect(list.data.tranches[0].amount).toBe(6000);
    const b = seedProject("brownfield", "m_and_a");
    const rb = await post(`/api/projects/${b}/capex-tranches`, { action: "create", tranche_no: 1, amount: 1, release_condition: "x" });
    expect(rb.status).toBe(409);
  });
});

describe("(f) S10 validation", () => {
  const base = { action: "hypothesize", rationale: "근거", tax_structure_note: "t" };
  test("greenfield refuses M&A-only inputs, accepts vehicle and JV stake", async () => {
    const p = seedProject("greenfield", "intra_venture");
    const path = `/api/projects/${p}/deal-structure`;
    for (const extra of [{ asset_or_stock: "stock" }, { instrument_mix: "primary" }, { vehicle: "spc", stake_type: "majority" }]) {
      const r = await post(path, { ...base, ...extra });
      expect(r.status).toBe(400);
      expect((await json(r)).error.code).toBe("greenfield_field_not_applicable");
    }
    expect((await post(path, { ...base, vehicle: "internal_venture_spinoff" })).status).toBe(201);
    expect((await post(path, { ...base, vehicle: "jv", stake_type: "joint_control" })).status).toBe(201);
  });
  test("brownfield: M&A inputs accepted exactly as before", async () => {
    const p = seedProject("brownfield", "m_and_a");
    const r = await post(`/api/projects/${p}/deal-structure`, { ...base, asset_or_stock: "stock", instrument_mix: "primary", stake_type: "majority", vehicle: "spc" });
    expect(r.status).toBe(201);
    expect((await json(r)).data).toMatchObject({ asset_or_stock: "stock", instrument_mix: "primary", stake_type: "majority", vehicle: "spc" });
  });
});

describe("(g) in-flight greenfield counts", () => {
  test("counts only, grandfathered and opted-in tallied", () => {
    const c = gf.inFlightGreenfieldCounts(db);
    expect(c.total).toBeGreaterThan(0);
    expect(Object.values(c.by_sub_track).reduce((a, b) => a + b, 0)).toBe(c.total);
    expect(c.grandfathered).toBeGreaterThanOrEqual(1);
    expect(c.opted_in).toBeGreaterThanOrEqual(1);
  });
});

describe("(f) single-person confirmation is scoped to project.site_required only", () => {
  test("the repository refuses the single-person path for any other var; review() still refuses self-review", async () => {
    const repo = await import("../../db/repositories/dimension-input.repository.ts");
    expect(repo.SINGLE_PERSON_CONFIRMATION_VARS).toEqual(["project.site_required"]);
    const p = seedProject("greenfield", "existing_business_rbd");
    const runId = (db.query("SELECT id FROM run WHERE project_id = ?").get(p) as { id: string }).id;
    const other = db.query("SELECT var_key, value_type FROM evidence_var WHERE source_kind = 'asserted' AND var_key != 'project.site_required' LIMIT 1").get() as { var_key: string; value_type: string };
    expect(other).toBeTruthy();
    const value = other.value_type === "number" ? { kind: "num" as const, value: 1 } : other.value_type === "boolean" ? { kind: "bool" as const, value: true } : { kind: "text" as const, value: "x" };
    expect(() =>
      repo.assertWithSinglePersonConfirmation({ project_id: p, run_id: runId, var_key: other.var_key, value, evidence_ref: "doc:x", asserted_by: A1, rationale: "r" }, db),
    ).toThrow(/not eligible for single-person confirmation/);
    const row = repo.assert({ project_id: p, run_id: runId, var_key: other.var_key, value, evidence_ref: "doc:x", asserted_by: A1, rationale: "r" }, db);
    expect(row.reviewed_by).toBeNull();
    expect(() => repo.review({ input_id: row.id, reviewed_by: A1 }, db)).toThrow(/must differ from asserted_by/);
  });
});

describe("(h) security review fixes (2026-10-12)", () => {
  const C3 = "gf_analyst3";
  let c3 = "";
  beforeAll(async () => {
    await createUser(db, { userId: C3, role: "analyst", password: "pw-gf-analyst-3", createdBy: "test", now: NOW });
    approveUser(db, { userId: C3, approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [C3]);
    c3 = await loginCookie(C3, "pw-gf-analyst-3");
  });

  test("capex attack: A creates+requests, C edits the amount then approves -> refused", async () => {
    const p = seedProject("greenfield", null);
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [p, C3, "member", "root", NOW, "review"]);
    const path = `/api/projects/${p}/capex-tranches`;
    const t = (await json(await post(path, { action: "create", tranche_no: 1, amount: 10, release_condition: "x" }))).data.tranche;
    expect((await json(await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "조건 충족" }))).data.release_pending).toBe(true);
    const upd = await post(path, { action: "update", tranche_id: t.id, amount: 999999 }, c3);
    expect(upd.status).toBe(409);
    expect((await json(upd)).error.code).toBe("release_pending");
    const ap = await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "ok" }, c3);
    // the edit was refused, so the approval by C proceeds against the unchanged amount
    expect(ap.status).toBe(200);
    expect((await json(ap)).data.tranche).toMatchObject({ status: "released", amount: 10 });
  });

  test("capex: an editor since the request can never approve (defence in depth)", async () => {
    const { createCapexTranche, setCapexTrancheStatus } = await import("../../app/web-next/lib/capex-tranches.ts");
    const p = seedProject("greenfield", null);
    const t = createCapexTranche({ projectId: p, trancheNo: 1, amount: 10, releaseCondition: "x", actor: A1, now: "2026-10-12T00:00:00.000Z" }, db);
    if (!t.ok) throw new Error(t.message);
    expect(setCapexTrancheStatus({ projectId: p, trancheId: t.tranche.id, status: "released", reason: "r", actor: A1, now: "2026-10-12T00:00:01.000Z" }, db)).toMatchObject({ ok: true, release_pending: true });
    // an edit that slipped in after the request (e.g. a race before the guard) — recorded as C's update
    db.run("UPDATE capex_tranche SET amount = 5000, updated_by = ?, updated_at = ? WHERE id = ?", [C3, "2026-10-12T00:00:02.000Z", t.tranche.id]);
    db.run("INSERT INTO audit_log (id, actor_user_id, action, target, created_at) VALUES (?,?,?,?,?)", [ulid(), C3, "capex_tranche.update", `${p}:${t.tranche.id}|{}`, "2026-10-12T00:00:02.000Z"]);
    expect(setCapexTrancheStatus({ projectId: p, trancheId: t.tranche.id, status: "released", reason: "ok", actor: C3, now: "2026-10-12T00:00:03.000Z" }, db)).toMatchObject({
      ok: false,
      code: "second_person_required",
    });
    expect(setCapexTrancheStatus({ projectId: p, trancheId: t.tranche.id, status: "released", reason: "ok", actor: A2, now: "2026-10-12T00:00:04.000Z" }, db)).toMatchObject({
      ok: true,
      release_pending: false,
    });
  });

  test("capex audit: update records before/after, release_requested records the reason; lengths bounded", async () => {
    const p = seedProject("greenfield", null);
    const path = `/api/projects/${p}/capex-tranches`;
    const t = (await json(await post(path, { action: "create", tranche_no: 1, amount: 10, release_condition: "인허가" }))).data.tranche;
    expect((await post(path, { action: "update", tranche_id: t.id, amount: 20, currency: "USD", release_condition: "준공" })).status).toBe(200);
    const u = db.query("SELECT target FROM audit_log WHERE action = 'capex_tranche.update' AND target LIKE ?").get(`${p}:${t.id}|%`) as { target: string };
    expect(JSON.parse(u.target.slice(u.target.indexOf("|") + 1))).toEqual({
      before: { amount: 10, currency: "KRW", release_condition: "인허가" },
      after: { amount: 20, currency: "USD", release_condition: "준공" },
    });
    await post(path, { action: "set_status", tranche_id: t.id, status: "released", reason: "준공 확인서 수령" });
    const rq = db.query("SELECT target FROM audit_log WHERE action = 'capex_tranche.release_requested' AND target LIKE ?").get(`${p}:${t.id}|%`) as { target: string };
    expect(JSON.parse(rq.target.slice(rq.target.indexOf("|") + 1))).toEqual({ reason: "준공 확인서 수령" });
    expect((await json(await nextRequest(path, { headers: { cookie: c1 } }))).data.tranches[0].pending_release.requested_by).toBe(A1);
    const long = "x".repeat(2001);
    expect((await post(path, { action: "create", tranche_no: 2, amount: 1, release_condition: long })).status).toBe(400);
    expect((await post(path, { action: "set_status", tranche_id: t.id, status: "withheld", reason: long })).status).toBe(400);
  });

  test("custom DD item: human-only, validated, proposer audited, reviewer must differ", async () => {
    const p = seedProject("greenfield", null);
    const path = `/api/projects/${p}/dd-checklist/custom`;
    expect(isHumanOnly("POST", path, {})).toBe(true);
    const body = { domain: "commercial", item_label: "고객 계약 확인", rationale: "r", source_url: "https://example.com/a" };
    expect((await nextRequest(path, { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) })).status).toBe(403);
    expect((await post(path, body, agentCookie)).status).toBe(403);
    expect((await post(path, { ...body, source_url: "javascript:alert(1)" })).status).toBe(400);
    expect((await post(path, { ...body, item_label: "x".repeat(201) })).status).toBe(400);
    expect((await post(path, { ...body, rationale: "x".repeat(2001) })).status).toBe(400);
    expect((await post(path, { ...body, source_url: `https://e.com/${"x".repeat(2000)}` })).status).toBe(400);
    const created = await post(path, body);
    expect(created.status).toBe(201);
    const itemId = (await json(created)).data.id as string;
    expect((db.query("SELECT actor_user_id a FROM audit_log WHERE action = 'dd_custom_item.create' AND target = ?").get(`${p}:${itemId}`) as { a: string }).a).toBe(A1);
    const review = `/api/projects/${p}/dd-checklist/tailor/${itemId}/review`;
    const self = await put(review, { decision: "approved" });
    expect(self.status).toBe(409);
    expect((await json(self)).error.code).toBe("second_person_required");
    expect((await put(review, { decision: "approved" }, c2)).status).toBe(200);
    expect((db.query("SELECT actor_user_id a FROM audit_log WHERE action = 'dd_custom_item.review' AND target = ?").get(`${p}:${itemId}:approved`) as { a: string }).a).toBe(A2);
    const ex = readFileSync(join(import.meta.dirname, "..", "..", "scripts", "co-newbiz", "mcp-coverage.exclusions.yaml"), "utf8");
    expect(ex).toContain('route: "POST /api/projects/{}/dd-checklist/custom"');
    const forA = (await json(await nextRequest(`/api/projects/${p}/dd`, { headers: { cookie: c1 } }))).data;
    const forB = (await json(await nextRequest(`/api/projects/${p}/dd`, { headers: { cookie: c2 } }))).data;
    const pick = (d: any) => d.domains.flatMap((x: any) => x.custom).find((c: any) => c.id === itemId);
    const nameA = (db.query("SELECT display_name FROM app_user WHERE user_id = ?").get(A1) as { display_name: string | null }).display_name?.trim() || A1;
    expect(pick(forA)).toMatchObject({ proposed_by_user: nameA, is_proposer: true });
    expect(pick(forB)).toMatchObject({ proposed_by_user: nameA, is_proposer: false });
  });

  test("plain greenfield (no sub-track): site_required=false is rejected, true allowed", async () => {
    const p = seedProject("greenfield", null);
    expect(gf.confirmSiteRequired({ projectId: p, value: false, rationale: "r", actor: A1 }, db)).toMatchObject({
      ok: false,
      code: "invalid_request",
      message: "세부 트랙이 없는 신규 사업은 부지 불필요로 확인할 수 없습니다",
    });
    const res = await post(`/api/projects/${p}/greenfield-scope`, { site_required: false, rationale: "r" });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("invalid_request");
    expect(gf.confirmSiteRequired({ projectId: p, value: true, rationale: "r", actor: A1 }, db).ok).toBe(true);
    const sub = seedProject("greenfield", "intra_venture");
    expect(gf.confirmSiteRequired({ projectId: sub, value: false, rationale: "r", actor: A1 }, db).ok).toBe(true);
  });

  test("workspace opt-in: a failing second pin write rolls back the sub-track pin", () => {
    const p = seedProject("greenfield", "intra_venture", { old: true });
    expect(gf.hasSubTrackOptIn(p, db)).toBe(false);
    const failing = new Proxy(db, {
      get(t, k) {
        if (k === "run") {
          return (sql: string, params?: unknown[]) => {
            if (sql.includes("INSERT INTO project_policy_pin") && Array.isArray(params) && params[2] === gf.GF_WS_POLICY_DOC_ID) throw new Error("disk full");
            return t.run(sql, params as never);
          };
        }
        const v = Reflect.get(t, k, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as typeof db;
    expect(() => gf.optInWorkspaceScope({ projectId: p, migrationNote: "note", actor: A1 }, failing)).toThrow(/disk full/);
    expect(gf.hasSubTrackOptIn(p, db)).toBe(false);
    expect((db.query("SELECT COUNT(*) c FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = ?").get(p, gf.GF_WS_POLICY_DOC_ID) as { c: number }).c).toBe(0);
    const ok = gf.optInWorkspaceScope({ projectId: p, migrationNote: "note", actor: A1 }, db);
    expect(ok).toMatchObject({ ok: true });
    expect(gf.hasSubTrackOptIn(p, db)).toBe(true);
    expect(gf.optInWorkspaceScope({ projectId: p, migrationNote: "again", actor: A1 }, db)).toMatchObject({ ok: false, code: "already_opted_in" });
    expect(gf.optInWorkspaceScope({ projectId: p, migrationNote: "x".repeat(2001), actor: A1 }, db)).toMatchObject({ ok: false, code: "invalid_request" });
  });
});
