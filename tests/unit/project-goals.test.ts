// @version 1.0.0
/**
 * Project-level business goals (ADR-0159, design 2026-10-11-s8-project-
 * business-goals) against the REAL route handlers and a scratch SQLite:
 *  (a) migration 0135: table + both indexes, active-uniqueness, rollback SQL;
 *  (b) route auth matrix: viewer 403, outsider/admin 404, bearer + agent
 *      403 human_only, CSRF, anonymous 401;
 *  (c) validation and error codes; append-only supersede / retire + audit;
 *  (d) resolution order project > affiliate > group (incl. null scope) with
 *      the structured shadowed list; per-case evaluation;
 *  (e) adoption acknowledgement (goals_ack) matrix and meta_json record;
 *  (f) human-only wiring (HUMAN_ONLY_ROUTES + coverage exclusion);
 *  (g) no leak to admin.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = "db/data/test-project-goals.sqlite";
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
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");
const { isHumanOnly, HUMAN_ONLY_ROUTES } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const { listBusinessCases } = await import("../../app/web-next/lib/business-case.ts");
const { listProjectGoals } = await import("../../app/web-next/lib/project-goals.ts");
const { resolveProjectTargets, evaluateTargetsForCase, evaluateTargets, listBusinessTargets } = await import("../../app/web-next/lib/business-targets.ts");

const NOW = new Date().toISOString();
const ANALYST = "analyst1";
const VIEWER = "viewer1";
const OUTSIDER = "outsider1";
const ADMIN = "admin1";
const AGENT = [...AGENT_KEYS][0];
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let adminCookie = "";
let agentCookie = "";
let bearer = "";
let projectId = "";
let projectNoGoalsId = "";
const G1 = ulid();
const M1 = ulid();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const goalsPath = (id = projectId) => `/api/projects/${id}/business-goals`;
function post(body: unknown, cookie = analystCookie, id = projectId) {
  return req(goalsPath(id), { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
}
const get = (cookie = analystCookie, query = "", id = projectId) => req(goalsPath(id) + query, { headers: { cookie } });
async function dataOf<T = Record<string, any>>(res: Response): Promise<T> {
  return (await res.json()).data as T;
}
const auditCount = (action: string) => (db.query("SELECT COUNT(*) c FROM audit_log WHERE action = ?").get(action) as { c: number }).c;

function seedProject(name: string, creator: string): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, name, "테스트 산업", "selected", creator, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), opp, "greenfield", "test route", creator, NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), opp, "직접 진출", "M&A 대안 검토", "test", creator, NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), opp]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", opp, gate, "go", "test", creator, NOW]);
  }
  return promoteOpportunity(opp, { promotedBy: creator, needToKnowBasis: "project goals test" }).project.id;
}

function seedCase(id: string, scenario: string, opts: { npv?: number; irr?: number; revenue?: number } = {}) {
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
    [id, projectId, "greenfield_cost", `Case ${scenario}`, 5, ANALYST, NOW, "{}"],
  );
  db.run(
    "INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [`${id}-r`, id, "revenue", "매출", opts.revenue ?? 10000, 1, 0, ANALYST, NOW],
  );
  if (opts.npv !== undefined) {
    db.run(
      "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), projectId, id, scenario, "p50", opts.npv, opts.irr ?? null, "seed=1", NOW],
    );
  }
}

beforeAll(async () => {
  for (const [id, role, pw] of [
    [ANALYST, "analyst", "pw-analyst-12345"],
    [VIEWER, "viewer", "pw-viewer-12345"],
    [OUTSIDER, "analyst", "pw-outsider-12345"],
    [ADMIN, "admin", "pw-admin-12345"],
    [AGENT, "analyst", "pw-agent-1234567"],
  ] as const) {
    await createUser(db, { userId: id, role, password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-analyst-12345");
  viewerCookie = await loginCookie(VIEWER, "pw-viewer-12345");
  outsiderCookie = await loginCookie(OUTSIDER, "pw-outsider-12345");
  adminCookie = await loginCookie(ADMIN, "pw-admin-12345");
  agentCookie = await loginCookie(AGENT, "pw-agent-1234567");
  bearer = issueApiToken(db, { userId: ANALYST, label: "agent", scopes: ["read", "write"], now: NOW }).token;

  projectId = seedProject("목표 테스트 기회", ANALYST);
  projectNoGoalsId = seedProject("목표 없음 기회", ANALYST);
  // the viewer sees the project (read), but cannot write goals
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, VIEWER, "member", "root", NOW, "goals test"],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("(a) migration 0135", () => {
  const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  function fresh(): Database {
    const m = new Database(":memory:");
    m.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) m.run(readFileSync(join(DIR, f), "utf-8"));
    return m;
  }
  const insert = (m: Database, id: string, metric: string, label: string | null, extra = "") =>
    m.run(
      `INSERT INTO project_business_goal (id, project_id, metric_key, label, direction, target_value, rationale, created_by, created_at ${extra ? ", " + extra.split("=")[0] : ""})
       VALUES (?,?,?,?,?,?,?,?,? ${extra ? ", " + extra.split("=")[1] : ""})`,
      [id, "p1", metric, label, "gte", 1, "근거", "u", NOW],
    );

  test("applies after 0134, creates the table and both indexes, with the reversible header", () => {
    expect(files.some((f) => f.startsWith("0135_project_business_goal"))).toBe(true);
    const sql = readFileSync(join(DIR, files.find((f) => f.startsWith("0135_"))!), "utf-8");
    expect(sql).toContain("@reversible: true");
    expect(sql).toContain("DROP TABLE project_business_goal");
    const m = fresh();
    m.run("INSERT INTO md_project (id, project_no, created_at) VALUES ('p1','P-1','2026-01-01')");
    const idx = (m.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='project_business_goal'").all() as Array<{ name: string }>).map((r) => r.name);
    expect(idx).toContain("idx_pbg_project");
    expect(idx).toContain("idx_pbg_project_metric_active");
  });

  test("active uniqueness per (project, metric, label); superseded/retired rows free the slot; rationale and direction are checked", () => {
    const m = fresh();
    m.run("INSERT INTO md_project (id, project_no, created_at) VALUES ('p1','P-1','2026-01-01')");
    insert(m, "g1", "npv", null);
    expect(() => insert(m, "g2", "npv", null)).toThrow(/UNIQUE/);
    insert(m, "g3", "custom", "R&D");
    insert(m, "g4", "custom", "다른 지표");
    expect(() => insert(m, "g5", "custom", "R&D")).toThrow(/UNIQUE/);
    m.run("UPDATE project_business_goal SET superseded_at = ? WHERE id = 'g1'", [NOW]);
    insert(m, "g6", "npv", null);
    expect(() => m.run("INSERT INTO project_business_goal (id, project_id, metric_key, direction, target_value, rationale, created_by, created_at) VALUES ('x','p1','irr','gte',1,'   ','u','t')")).toThrow();
    expect(() => m.run("INSERT INTO project_business_goal (id, project_id, metric_key, direction, target_value, rationale, created_by, created_at) VALUES ('y','p1','irr','up',1,'r','u','t')")).toThrow();
  });

  test("the rollback SQL in the header drops only the new objects", () => {
    const m = fresh();
    const before = (m.query("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get() as { c: number }).c;
    m.run("DROP INDEX idx_pbg_project_metric_active; DROP INDEX idx_pbg_project; DROP TABLE project_business_goal;");
    const after = (m.query("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get() as { c: number }).c;
    expect(after).toBe(before - 1);
    expect(m.query("SELECT name FROM sqlite_master WHERE name LIKE '%pbg%' OR name='project_business_goal'").all()).toEqual([]);
  });
});

describe("(a2) migration_pending when 0135 is not applied", () => {
  test("GET business-goals and target-check return 503 migration_pending instead of an empty 500", async () => {
    db.run("ALTER TABLE project_business_goal RENAME TO project_business_goal_hold");
    try {
      for (const path of [`/api/projects/${projectId}/business-goals`, `/api/projects/${projectId}/target-check`]) {
        const res = await req(path, { headers: { cookie: analystCookie } });
        expect(res.status, path).toBe(503);
        const body = await res.json();
        expect(body.error).toEqual({ code: "migration_pending", message: "Restart the server to apply pending migrations" });
      }
    } finally {
      db.run("ALTER TABLE project_business_goal_hold RENAME TO project_business_goal");
    }
  });
});

describe("(b) route auth matrix", () => {
  const body = { action: "create", metric_key: "npv", target_value: 50000, rationale: "r" };

  test("anonymous 401; viewer 403 role_required; outsider and admin 404; viewer and analyst can read", async () => {
    expect((await req(goalsPath(), { method: "POST", body: JSON.stringify(body) })).status).toBe(401);
    const v = await post(body, viewerCookie);
    expect(v.status).toBe(403);
    expect((await v.json()).error.code).toBe("role_required");
    expect((await post(body, outsiderCookie)).status).toBe(404);
    expect((await post(body, adminCookie)).status).toBe(404);
    expect((await get(viewerCookie)).status).toBe(200);
    expect((await get(outsiderCookie)).status).toBe(404);
    expect((await get(adminCookie)).status).toBe(404);
    expect(listProjectGoals(projectId, { includeHistory: true }).length).toBe(0);
  });

  test("bearer token and agent-keyed callers get 403 human_only; nothing is written", async () => {
    const viaBearer = await req(goalsPath(), { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
    expect(viaBearer.status).toBe(403);
    expect((await viaBearer.json()).error.code).toBe("human_only");
    const viaAgent = await post(body, agentCookie);
    expect(viaAgent.status).toBe(403);
    expect((await viaAgent.json()).error.code).toBe("human_only");
    expect(listProjectGoals(projectId, { includeHistory: true }).length).toBe(0);
  });

  test("CSRF: a cookie mutation without a matching token is rejected", async () => {
    const res = await req(goalsPath(), {
      method: "POST",
      headers: { cookie: `${analystCookie}; co_newbiz_csrf=aaa`, "x-csrf-token": "bbb" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("csrf_token_mismatch");
  });
});

describe("(c) validation, append-only history, audit", () => {
  test("invalid_request cases", async () => {
    const bads: Array<Record<string, unknown>> = [
      { action: "nope" },
      {},
      { action: "create", metric_key: "unknown_metric", target_value: 1, rationale: "r" },
      { action: "create", metric_key: "npv", target_value: 1, rationale: "  " },
      { action: "create", metric_key: "npv", target_value: -5, rationale: "r" },
      { action: "create", metric_key: "npv", target_value: "abc", rationale: "r" },
      { action: "create", metric_key: "npv", target_value: "", rationale: "r" },
      { action: "create", metric_key: "npv", target_value: null, rationale: "r" },
      { action: "create", metric_key: "npv", direction: "up", target_value: 1, rationale: "r" },
      { action: "create", metric_key: "custom", target_value: 1, rationale: "r" },
      { action: "supersede", target_value: 1, rationale: "r" },
      { action: "retire", goal_id: "x" },
      { action: "create", metric_key: "npv", target_value: 1, rationale: "r".repeat(2001) },
    ];
    for (const b of bads) {
      const res = await post(b);
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_request");
    }
    expect(listProjectGoals(projectId, { includeHistory: true }).length).toBe(0);
  });

  test("create takes the preset default direction; duplicate -> 409 goal_exists; custom needs a label", async () => {
    const npv = await post({ action: "create", metric_key: "npv", target_value: 50000, rationale: "회수 기준", source_note: "IC 가이드" });
    expect(npv.status).toBe(201);
    const goal = (await dataOf(npv)).goal;
    expect(goal).toMatchObject({ metric_key: "npv", direction: "gte", target_value: 50000, rationale: "회수 기준", source_note: "IC 가이드", created_by: ANALYST });
    const period = await post({ action: "create", metric_key: "period", target_value: 5, rationale: "r" });
    expect((await dataOf(period)).goal.direction).toBe("lte");
    const dup = await post({ action: "create", metric_key: "npv", target_value: 1, rationale: "r" });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("goal_exists");
    const custom = await post({ action: "create", metric_key: "custom", label: "R&D 비중", direction: "lte", target_value: 0.15, rationale: "r" });
    expect(custom.status).toBe(201);
    expect((await dataOf(custom)).goal.label).toBe("R&D 비중");
    expect(auditCount("project_goal.create")).toBe(3);
  });

  test("supersede is append-only: old row values untouched, new version linked; retire stamps and frees the slot", async () => {
    const [npv] = listProjectGoals(projectId).filter((g) => g.metric_key === "npv");
    const before = db.query("SELECT * FROM project_business_goal WHERE id = ?").get(npv.id) as Record<string, unknown>;
    const res = await post({ action: "supersede", goal_id: npv.id, target_value: 70000, rationale: "상향" });
    expect(res.status).toBe(201);
    const d = await dataOf(res);
    expect(d.superseded_id).toBe(npv.id);
    expect(d.goal).toMatchObject({ target_value: 70000, direction: "gte", supersedes_id: npv.id, rationale: "상향", source_note: "IC 가이드" });
    const after = db.query("SELECT * FROM project_business_goal WHERE id = ?").get(npv.id) as Record<string, unknown>;
    expect({ ...after, superseded_at: null, superseded_by: null }).toEqual({ ...before, superseded_at: null, superseded_by: null });
    expect(after.superseded_at).toBeTruthy();
    expect(after.superseded_by).toBe(d.goal.id);
    // superseding the old version again -> goal_not_active
    const again = await post({ action: "supersede", goal_id: npv.id, target_value: 1, rationale: "r" });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("goal_not_active");

    // history
    const hist = await dataOf<{ goals: Array<{ id: string }> }>(await get(analystCookie, "?history=1"));
    expect(hist.goals.map((g) => g.id)).toContain(npv.id);
    const cur = await dataOf<{ goals: Array<{ id: string }> }>(await get());
    expect(cur.goals.map((g) => g.id)).not.toContain(npv.id);

    const period = listProjectGoals(projectId).find((g) => g.metric_key === "period")!;
    const bad = await post({ action: "retire", goal_id: period.id, reason: " " });
    expect(bad.status).toBe(400);
    const retire = await post({ action: "retire", goal_id: period.id, reason: "범위 변경" });
    expect(retire.status).toBe(200);
    const row = db.query("SELECT retired_at, retired_by, retire_reason, target_value FROM project_business_goal WHERE id = ?").get(period.id) as Record<string, unknown>;
    expect(row).toMatchObject({ retired_by: ANALYST, retire_reason: "범위 변경", target_value: 5 });
    expect(row.retired_at).toBeTruthy();
    expect((await post({ action: "retire", goal_id: period.id, reason: "again" })).status).toBe(409);
    expect((await post({ action: "supersede", goal_id: period.id, target_value: 4, rationale: "r" })).status).toBe(409);
    expect((await post({ action: "supersede", goal_id: "no-such", target_value: 4, rationale: "r" })).status).toBe(404);
    // a retired metric can be created again
    expect((await post({ action: "create", metric_key: "period", target_value: 6, rationale: "재설정" })).status).toBe(201);
    expect(auditCount("project_goal.supersede")).toBe(1);
    expect(auditCount("project_goal.retire")).toBe(1);
    expect(auditCount("project_goal.create")).toBe(4);
    // a goal of another project is not addressable
    expect((await post({ action: "retire", goal_id: npv.id, reason: "x" }, analystCookie, projectNoGoalsId)).status).toBe(404);
  });
});

describe("(d) resolution order and per-case evaluation", () => {
  beforeAll(() => {
    db.run("INSERT INTO company_group (id, name, created_by, created_at) VALUES (?,?,?,?)", [G1, "테스트그룹", "test", NOW]);
    // single group, no company link -> group-common standards apply (member null)
    const std = (metric: string, dir: string, value: number, member: string | null) =>
      db.run("INSERT INTO md_business_target (id, group_id, member_id, metric_key, label, direction, target_value, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [ulid(), G1, member, metric, null, dir, value, "admin1", NOW]);
    db.run("INSERT INTO company_group_member (id, group_id, company_name, role, created_at) VALUES (?,?,?,?,?)", [M1, G1, "테스트중공업", "affiliate", NOW]);
    std("npv", "gte", 30000, null); // shadowed by the project goal (70000)
    std("irr", "gte", 0.1, null); // standard only
    std("operating_margin", "gte", 0.07, null);
  });

  test("project > group per metric; standards-only metrics stay; source labels and shadowed list", async () => {
    const { scope, resolved } = resolveProjectTargets(projectId);
    expect(scope?.groupId).toBe(G1);
    const byKey = Object.fromEntries(resolved.map((t) => [t.row.metric_key, t]));
    expect(byKey.npv.source).toBe("project");
    expect(byKey.npv.row.target_value).toBe(70000);
    expect(byKey.npv.shadowed).toHaveLength(1);
    expect(byKey.npv.shadowed[0].source).toBe("group");
    expect(byKey.npv.shadowed[0].row.target_value).toBe(30000);
    expect(byKey.irr.source).toBe("group");
    expect(byKey.irr.shadowed).toEqual([]);
    expect(byKey.period.source).toBe("project");
    expect(byKey.period.shadowed).toEqual([]);

    const tc = await dataOf(await req(`/api/projects/${projectId}/target-check`, { headers: { cookie: analystCookie } }));
    expect(tc.resolvable).toBe(true);
    expect(tc.goal_count_by_source).toEqual({ project: 3, affiliate: 0, group: 2 });
    const npv = tc.entries.find((e: any) => e.metric_key === "npv");
    expect(npv).toMatchObject({ source: "project", shadowed: [{ source: "group", target_value: 30000 }], rationale: "상향", set_by: ANALYST });
    expect(npv.shadowed_note).toContain("그룹 공통 기준");
    expect(npv.overridden_note).toBe(npv.shadowed_note);
    expect(npv.source_name).toBeTruthy();
    // admin never reaches deal content here either
    expect((await req(`/api/projects/${projectId}/target-check`, { headers: { cookie: adminCookie } })).status).toBe(404);
  });

  test("an affiliate standard sits between: project shadows affiliate then group", () => {
    const aff = ulid();
    db.run("INSERT INTO md_business_target (id, group_id, member_id, metric_key, label, direction, target_value, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [aff, G1, M1, "operating_margin", null, "gte", 0.08, "admin1", NOW]);
    const opp = ulid();
    // link project -> member M1 via company name
    const C1 = ulid();
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [C1, "테스트중공업", NOW]);
    db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [C1, projectId]);
    const m = resolveProjectTargets(projectId).resolved.find((t) => t.row.metric_key === "operating_margin")!;
    expect(m.source).toBe("affiliate");
    expect(m.shadowed.map((s) => s.source)).toEqual(["group"]);
    expect(m.overridden?.target_value).toBe(0.07); // legacy alias kept
    db.run(
      "INSERT INTO project_business_goal (id, project_id, metric_key, direction, target_value, rationale, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [opp, projectId, "operating_margin", "gte", 0.12, "프로젝트 기준", ANALYST, NOW],
    );
    const p = resolveProjectTargets(projectId).resolved.find((t) => t.row.metric_key === "operating_margin")!;
    expect(p.source).toBe("project");
    expect(p.shadowed.map((s) => [s.source, s.row.target_value])).toEqual([["affiliate", 0.08], ["group", 0.07]]);
    const entry = evaluateTargets([p], resolveProjectTargets(projectId).scope, null)[0];
    expect(entry.shadowed).toEqual([{ source: "affiliate", target_value: 0.08 }, { source: "group", target_value: 0.07 }]);
    expect(entry.shadowed_note).toContain("계열사 기준");
    // restore state for later tests
    db.run("DELETE FROM project_business_goal WHERE id = ?", [opp]);
    db.run("UPDATE md_project SET company_id = NULL WHERE id = ?", [projectId]);
    db.run("DELETE FROM md_business_target WHERE id = ?", [aff]);
  });

  test("evaluateTargetsForCase evaluates every scenario case: met / missed / indeterminate / manual", () => {
    seedCase("m-base", "base", { npv: 40000, irr: 0.12, revenue: 10000 });
    seedCase("m-up", "upside", { npv: 90000, irr: 0.2, revenue: 10000 });
    seedCase("m-nosim", "downside", { revenue: 10000 }); // no simulation run
    const { cases } = listBusinessCases(projectId);
    const { resolved } = resolveProjectTargets(projectId);
    const statusOf = (caseId: string) => {
      const entries = evaluateTargetsForCase(resolved, cases.find((c) => c.id === caseId)!);
      return Object.fromEntries(entries.map((e) => [e.label.startsWith("NPV") ? "npv" : e.label.startsWith("IRR") ? "irr" : e.metric_key, e.status]));
    };
    const base = statusOf("m-base");
    const up = statusOf("m-up");
    const nosim = statusOf("m-nosim");
    expect(base.npv).toBe("missed"); // 40000 < project goal 70000
    expect(up.npv).toBe("met");
    expect(base.irr).toBe("met"); // 0.12 >= group 0.10
    expect(nosim.npv).toBe("indeterminate"); // no p50 simulation -> not a miss
    expect(nosim.irr).toBe("indeterminate");
    expect(base.period).toBe("met"); // horizon 5 <= period goal 6
    expect(base.custom).toBe("manual"); // custom metric: manual check
  });
});

describe("(e) null scope and adoption acknowledgement", () => {
  const adopt = (id: string, body: unknown, cookie = analystCookie) =>
    req(`/api/projects/${id}/business-case/adopt`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
  const adoptMeta = (id: string) => {
    const r = db.query("SELECT meta_json FROM process_run WHERE project_id = ? AND stage = 's8_case_adopt' ORDER BY started_at DESC, id DESC LIMIT 1").get(id) as { meta_json: string } | null;
    return r ? JSON.parse(r.meta_json) : null;
  };
  function seedModel(project: string, id: string) {
    db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)", [id, project, "greenfield_cost", "N", 5, ANALYST, NOW, "{}"]);
    db.run("INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [ulid(), project, id, "base", "p50", 90000, 0.2, "seed=1", NOW]);
  }

  test("a second group breaks the single-group fallback: scope is null, yet project goals still apply", async () => {
    db.run("INSERT INTO company_group (id, name, created_by, created_at) VALUES (?,?,?,?)", [ulid(), "두번째그룹", "test", NOW]);
    expect(resolveProjectTargets(projectNoGoalsId)).toEqual({ scope: null, resolved: [] });
    const empty = await dataOf(await req(`/api/projects/${projectNoGoalsId}/target-check`, { headers: { cookie: analystCookie } }));
    expect(empty).toMatchObject({ resolvable: false, reason: "scope_unresolved", entries: [], goal_count_by_source: { project: 0, affiliate: 0, group: 0 } });

    const created = await post({ action: "create", metric_key: "npv", target_value: 10000, rationale: "스코프 없는 목표" }, analystCookie, projectNoGoalsId);
    expect(created.status).toBe(201);
    const r = resolveProjectTargets(projectNoGoalsId);
    expect(r.scope).toBeNull();
    expect(r.resolved.map((t) => t.source)).toEqual(["project"]);
    const tc = await dataOf(await req(`/api/projects/${projectNoGoalsId}/target-check`, { headers: { cookie: analystCookie } }));
    expect(tc.scope).toBeNull();
    expect(tc.resolvable).toBe(false);
    expect(tc.entries).toHaveLength(1);
    expect(tc.goal_count_by_source).toEqual({ project: 1, affiliate: 0, group: 0 });
    const list = await dataOf(await get(analystCookie, "", projectNoGoalsId));
    expect(list.standards_resolvable).toBe(false);
    expect(list.resolved[0]).toMatchObject({ metric_key: "npv", source: "project", shadowed: [] });
    expect(list.presets.length).toBeGreaterThan(0);
    // retire again so the no-goals state below is real
    const goal = list.goals[0];
    expect((await post({ action: "retire", goal_id: goal.id, reason: "테스트" }, analystCookie, projectNoGoalsId)).status).toBe(200);
  });

  test("no goals + no ack -> 409 goals_ack_required, nothing written; ack stores goals_ack in meta_json", async () => {
    seedModel(projectNoGoalsId, "n-1");
    expect(resolveProjectTargets(projectNoGoalsId).resolved).toEqual([]);
    for (const body of [{ model_id: "n-1" }, { model_id: "n-1", goals_ack: { acknowledged: false } }, { model_id: "n-1", goals_ack: "yes" }]) {
      const res = await adopt(projectNoGoalsId, body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await res.json()).error.code).toBe("goals_ack_required");
    }
    expect(adoptMeta(projectNoGoalsId)).toBeNull();
    // validation order: an unknown model is still 404, not 409
    expect((await adopt(projectNoGoalsId, { model_id: "no-such", goals_ack: { acknowledged: true, note: "test: 목표 비교 없이 진행" } })).status).toBe(404);
    const ok = await adopt(projectNoGoalsId, { model_id: "n-1", goals_ack: { acknowledged: true, note: "목표 없이 진행" } });
    expect(ok.status).toBe(201);
    const meta = adoptMeta(projectNoGoalsId);
    expect(meta.model_id).toBe("n-1");
    expect(meta.goals_ack).toMatchObject({ acknowledged: true, note: "목표 없이 진행", goal_count: 0 });
    expect(meta.goals_ack.at).toBeTruthy();
  });

  test("with goals, no ack is needed; meta_json records goal_count and the attainment summary", async () => {
    await post({ action: "create", metric_key: "npv", target_value: 10000, rationale: "r" }, analystCookie, projectNoGoalsId);
    const c2 = await post({ action: "create", metric_key: "custom", label: "수동", direction: "gte", target_value: 1, rationale: "r" }, analystCookie, projectNoGoalsId);
    expect(c2.status).toBe(201);
    seedModel(projectNoGoalsId, "n-2");
    // A recommended scenario needs a p05 row (recommendedFromDb); without it NPV is now
    // indeterminate (the first-p50 fallback was removed) and an ack would be required.
    db.run("INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [ulid(), projectNoGoalsId, "n-2", "base", "p05", 50000, 0.1, "seed=1", NOW]);
    const res = await adopt(projectNoGoalsId, { model_id: "n-2" });
    expect(res.status).toBe(201);
    const meta = adoptMeta(projectNoGoalsId);
    expect(meta.goal_count).toBe(2);
    expect(meta.attainment).toEqual({ met: 1, missed: 0, indeterminate: 0, manual: 1 });
    expect(meta.goals_ack).toBeUndefined();
  });

  test("goals exist but none evaluable (indeterminate/manual) -> goals_ack_required; note is mandatory", async () => {
    const proj = projectNoGoalsId;
    // retire the goals created by the previous test, then keep only a custom (manual) goal
    const list = await dataOf(await get(analystCookie, "", proj));
    for (const g of list.goals) await post({ action: "retire", goal_id: g.id, reason: "정리" }, analystCookie, proj);
    await post({ action: "create", metric_key: "custom", label: "수동2", direction: "gte", target_value: 1, rationale: "r" }, analystCookie, proj);
    seedModel(proj, "n-3");
    const noAck = await adopt(proj, { model_id: "n-3" });
    expect(noAck.status).toBe(409);
    expect((await noAck.json()).error.code).toBe("goals_ack_required");
    for (const ack of [{ acknowledged: true }, { acknowledged: true, note: "   " }]) {
      const r = await adopt(proj, { model_id: "n-3", goals_ack: ack });
      expect(r.status).toBe(400);
      expect((await r.json()).error.code).toBe("goals_ack_note_required");
    }
    expect(adoptMeta(proj)?.model_id).not.toBe("n-3");
    const ok = await adopt(proj, { model_id: "n-3", goals_ack: { acknowledged: true, note: "수동 목표만 있음" } });
    expect(ok.status).toBe(201);
    expect(adoptMeta(proj).goals_ack).toMatchObject({ acknowledged: true, note: "수동 목표만 있음", goal_count: 1 });
  });

  test("project with only standards (no project goal) needs no ack either", async () => {
    // the main project resolves group standards (no ack path) — covered by the legacy adopt tests;
    // here: viewer/outsider keep their existing refusals before the ack is considered
    expect((await adopt(projectId, { model_id: "m-base" }, viewerCookie)).status).toBe(403);
    expect((await adopt(projectId, { model_id: "m-base" }, outsiderCookie)).status).toBe(404);
  });
});

describe("(f) human-only wiring and (g) no leak", () => {
  test("HUMAN_ONLY_ROUTES lists the POST; isHumanOnly is method- and path-exact", () => {
    expect(isHumanOnly("POST", "/api/projects/x/business-goals", {})).toBe(true);
    expect(isHumanOnly("GET", "/api/projects/x/business-goals", null)).toBe(false);
    expect(HUMAN_ONLY_ROUTES.some((r) => r.method === "POST" && r.pattern === "/api/projects/:id/business-goals")).toBe(true);
  });

  test("the coverage exclusion exists and matches the human-only route", () => {
    const yaml = readFileSync(join(import.meta.dirname, "..", "..", "scripts", "co-newbiz", "mcp-coverage.exclusions.yaml"), "utf-8");
    expect(yaml).toContain("id: project-business-goals");
    expect(yaml).toContain('route: "POST /api/projects/{}/business-goals"');
  });

  test("admin sees no project goals anywhere: the standards list is closed to admin and excludes them (ADR-0191)", async () => {
    const res = await req("/api/our-company/groups/any/business-targets", { headers: { cookie: adminCookie } });
    expect(res.status).toBe(403);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("스코프 없는 목표");
    expect(text).not.toContain("project_id");
    expect(JSON.stringify(listBusinessTargets())).not.toContain("스코프 없는 목표");
    expect((await post({ action: "create", metric_key: "irr", target_value: 0.1, rationale: "r" }, adminCookie)).status).toBe(404);
  });
});
