// @version 1.0.0
/**
 * ADR-0179 slice 1 - the structured target scope of the promoting
 * opportunity. Migration 0148 schema (additive column, CHECK json_valid,
 * NULL default, no backfill), the GET/PUT target-scope route (PUT is
 * HUMAN-ONLY: agents 403, viewer 403, analyst+ OK; invalid shape 400,
 * never silently dropped), bit-identity for projects without a scope,
 * and degradation: a hand-written invalid column never blocks generation.
 * Real route handlers + scratch SQLite; migration test on :memory:.
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-target-scope.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { runAsPrincipal } = await import("../../app/web-next/lib/mcp/principal-context.ts");
const { isHumanOnly } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const scopeRoute = await import("../../app/web-next/app/api/opportunities/[id]/target-scope/route.ts");
const gen = await import("../../app/web-next/lib/business-case-generator.ts");
const { normalizeTargetScopeInput, parseTargetScopeJson, TargetScopeValidationError, TARGET_SCOPE_REGIONS } =
  await import("../../app/web-next/lib/target-scope.ts");

const NOW = new Date().toISOString();
const ANALYST = "scope-analyst";
const VIEWER = "scope-viewer";
let cookie = "";
let viewerCookie = "";
const json = JSON.stringify;

async function login(userId: string, pw: string) {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: json({ userId, password: pw }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
function makeOpp(track: "greenfield" | "brownfield"): string {
  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json, market_size_krw_m, growth_rate) VALUES (?,?,?,?,?,?,?,?,?)",
    [oppId, "opp " + oppId.slice(-5), "scope", "selected", ANALYST, NOW, json({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), 80000, 0.06]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), oppId, track, "r", "alt", ANALYST, NOW]);
  for (const gate of track === "greenfield" ? ["screening", "pre_fs"] : ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "t", ANALYST, NOW]);
  }
  if (track === "greenfield") {
    db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at, business_case_lines_json) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), oppId, "s", "a", "r", ANALYST, NOW, NOW, null]);
  } else {
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), oppId, "T", "shortlisted", 1, NOW, NOW]);
  }
  return oppId;
}
const promote = (oppId: string): string => promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "t" }).project.id;
const putScope = (id: string, body: unknown, headers: Record<string, string> = { cookie }) =>
  nextRequest(`/api/opportunities/${id}/target-scope`, { method: "PUT", headers, body: json(body) });
const getScope = (id: string, headers: Record<string, string> = { cookie }) =>
  nextRequest(`/api/opportunities/${id}/target-scope`, { method: "GET", headers });
const VALID = { regions: ["kr", "eu"], segments: ["Stage V", "construction"], unit_basis: "units_year" };

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-scope-analyst-12", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-scope-viewer-123", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await login(ANALYST, "pw-scope-analyst-12");
  viewerCookie = await login(VIEWER, "pw-scope-viewer-123");
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// -- migration 0148 ------------------------------------------------------------------------------
describe("migration 0148 target_scope_json", () => {
  const DIR = join(PROJECT_ROOT, "db", "migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const TARGET = files.find((f) => f.startsWith("0148_"))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");
  const runSql = (d: Database, sql: string) => { for (const s of splitSqlStatements(sql)) d.run(s); };
  function through(last: string): Database {
    const d = new Database(":memory:");
    d.run("PRAGMA foreign_keys = ON");
    d.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) { if (f > last) break; runSql(d, readFileSync(join(DIR, f), "utf-8")); }
    return d;
  }

  test("additive nullable column with a json_valid CHECK, applied on top of 0147; no backfill", () => {
    expect(SQL).toContain("@reversible: true");
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    const d = through("0147_zzz");
    const colsBefore = (d.query("PRAGMA table_info(opportunity)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(colsBefore).not.toContain("target_scope_json");
    d.transaction(() => runSql(d, SQL))();
    const cols = (d.query("PRAGMA table_info(opportunity)").all() as Array<{ name: string; dflt_value: string | null; notnull: number }>).map((c) => c.name);
    const col = (d.query("PRAGMA table_info(opportunity)").all() as Array<{ name: string; dflt_value: string | null; notnull: number }>).find((c) => c.name === "target_scope_json")!;
    expect(cols.filter((c) => c === "target_scope_json").length).toBe(1);
    expect(col.dflt_value).toBeNull(); // NULL default
    expect(col.notnull).toBe(0);
    d.run("INSERT INTO opportunity (id, name, created_by, created_at) VALUES ('o1','opp','u',?)", [NOW]);
    expect(d.query("SELECT target_scope_json AS v FROM opportunity WHERE id = 'o1'").get()).toEqual({ v: null });
    d.run("UPDATE opportunity SET target_scope_json = '{\"regions\":[\"kr\"]}' WHERE id = 'o1'");
    expect(() => d.run("UPDATE opportunity SET target_scope_json = 'not json' WHERE id = 'o1'")).toThrow(); // CHECK json_valid
  });
});

// -- the route ------------------------------------------------------------------------------------
describe("target-scope route", () => {
  test("parse/normalize unit behavior: dedupe, trim, worldwide exclusivity, invalid shapes", () => {
    expect(normalizeTargetScopeInput({ ...VALID, set_by: "x", set_at: "y" })).toEqual(VALID); // stamps ignored, server-set
    // regions are NOT trimmed (enum members must match exactly); segments are
    expect(normalizeTargetScopeInput({ regions: ["kr", "eu"], segments: [" a ", "a", ""], unit_basis: "units_year" })).toEqual({
      regions: ["kr", "eu"], segments: ["a"], unit_basis: "units_year",
    });
    expect(() => normalizeTargetScopeInput({ regions: ["kr", " kr "], segments: [], unit_basis: "units_year" })).toThrow();
    expect(() => normalizeTargetScopeInput({ regions: ["worldwide", "kr"], segments: [], unit_basis: "units_year" })).toThrow(TargetScopeValidationError);
    expect(() => normalizeTargetScopeInput({ regions: ["mars"], segments: [], unit_basis: "units_year" })).toThrow();
    expect(() => normalizeTargetScopeInput({ regions: [], segments: [], unit_basis: "units_year" })).toThrow(); // regions required
    expect(() => normalizeTargetScopeInput({ regions: ["kr"], segments: [], unit_basis: "bogus" })).toThrow();
    expect(() => normalizeTargetScopeInput({ regions: ["kr"], segments: "not array", unit_basis: "units_year" })).toThrow();
    expect(() => normalizeTargetScopeInput({ regions: ["kr"], segments: ["x".repeat(101)], unit_basis: "units_year" })).toThrow();
    expect(() => normalizeTargetScopeInput(null)).toThrow();
    expect(parseTargetScopeJson(null)).toBeNull();
    expect(parseTargetScopeJson("")).toBeNull();
    expect(() => parseTargetScopeJson("null")).toThrow(); // JSON null is not an object
    expect(parseTargetScopeJson(json({ ...VALID, set_by: "u", set_at: NOW }))).toEqual({ ...VALID, set_by: "u", set_at: NOW });
    expect(() => parseTargetScopeJson("{\"regions\":[\"worldwide\",\"kr\"],\"segments\":[],\"unit_basis\":\"units_year\"}")).toThrow(TargetScopeValidationError);
    expect(TARGET_SCOPE_REGIONS).toContain("worldwide");
  });

  test("GET before a person sets anything: scope null (not an error)", async () => {
    const opp = makeOpp("greenfield");
    const res = await getScope(opp);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { scope: null } });
  });

  test("agents (delegated principal) are 403 human_only and the route is registered human-only", async () => {
    const opp = makeOpp("greenfield");
    const principal = { userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" };
    const res = await runAsPrincipal(principal, () =>
      scopeRoute.PUT(new Request("http://x/t", { method: "PUT", body: json(VALID) }), { params: Promise.resolve({ id: opp }) }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "human_only" } });
    expect(isHumanOnly("PUT", `/api/opportunities/${opp}/target-scope`, VALID)).toBe(true);
    expect(isHumanOnly("GET", `/api/opportunities/${opp}/target-scope`, null)).toBe(false); // GET stays readable
    expect((db.query("SELECT target_scope_json AS v FROM opportunity WHERE id = ?").get(opp) as { v: string | null }).v).toBeNull();
  });

  test("viewer PUT is 403; analyst PUT stores the scope, stamps set_by/set_at server-side, audits", async () => {
    const opp = makeOpp("greenfield");
    expect((await putScope(opp, VALID, { cookie: viewerCookie })).status).toBe(403);
    const res = await putScope(opp, VALID);
    expect(res.status).toBe(200);
    const stored = JSON.parse((db.query("SELECT target_scope_json AS v FROM opportunity WHERE id = ?").get(opp) as { v: string }).v);
    expect(stored).toMatchObject(VALID);
    expect(stored.set_by).toBe(ANALYST);
    expect(stored.set_at).toBeTruthy();
    expect(await getScope(opp).then((r) => r.json())).toMatchObject({ data: { scope: stored } });
    expect((db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'opportunity_target_scope.write' AND target LIKE ?").get(`${opp}#%`) as { n: number }).n).toBe(1);
    // a second PUT overwrites (last write wins) and does not duplicate audit chaos
    await putScope(opp, { regions: ["worldwide"], segments: [], unit_basis: "krw_m_year" });
    expect(await getScope(opp).then((r) => r.json())).toMatchObject({ data: { scope: { regions: ["worldwide"] } } });
  });

  test("invalid shapes are 400 invalid_request, the column untouched (never silently dropped)", async () => {
    const opp = makeOpp("greenfield");
    await putScope(opp, VALID);
    for (const body of [{}, { regions: ["mars"], segments: [], unit_basis: "units_year" }, { regions: ["kr", "worldwide"], segments: [], unit_basis: "units_year" }, "nonsense", null]) {
      const res = await putScope(opp, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    expect(await getScope(opp).then((r) => r.json())).toMatchObject({ data: { scope: VALID } });
  });

  test("unknown opportunity: 404 on GET and PUT", async () => {
    expect((await getScope("01NOPE00000000000000000000")).status).toBe(404);
    expect((await putScope("01NOPE00000000000000000000", VALID)).status).toBe(404);
  });
});

// -- bit-identity / never blocks -----------------------------------------------------------------
describe("generation inputs", () => {
  test("bit-identity: a project whose opportunity has no scope produces targetScope null and identical base inputs", () => {
    const opp = makeOpp("greenfield");
    const pid = promote(opp);
    const base = gen.caseInputsBaseForProject(pid);
    expect(base.targetScope).toBeNull();
    // every other field identical to a second read (no hidden state leaked from the column)
    expect(gen.caseInputsBaseForProject(pid)).toEqual(base);
    // and identical to a sibling project that also has no scope
    const opp2 = makeOpp("greenfield");
    const pid2 = promote(opp2);
    expect({ ...gen.caseInputsBaseForProject(pid2), projectId: base.projectId }).toEqual(base);
  });

  test("a person-set scope passes through untouched; the rest of the base inputs is unchanged", async () => {
    const opp = makeOpp("greenfield");
    const pid = promote(opp);
    const before = gen.caseInputsBaseForProject(pid);
    await putScope(opp, VALID);
    const after = gen.caseInputsBaseForProject(pid);
    expect(after.targetScope).toMatchObject(VALID);
    expect(after.targetScope!.set_by).toBe(ANALYST);
    const { targetScope: _drop, ...beforeRest } = before;
    const { targetScope: _drop2, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
  });

  test("a hand-written invalid column never blocks generation: degrades to targetScope null", () => {
    const opp = makeOpp("greenfield");
    const pid = promote(opp);
    // 'not json' is rejected by the CHECK constraint (asserted above); a
    // hand-written row CAN still hold valid JSON of the wrong shape, and
    // generation must survive it rather than throw.
    db.run("UPDATE opportunity SET target_scope_json = '{\"x\":1}' WHERE id = ?", [opp]);
    expect(gen.caseInputsBaseForProject(pid).targetScope).toBeNull();
    // slice 1 touches only the input base, so "generation is never blocked"
    // is proven at that seam: the full caseInputs read (growth model
    // resolution included) succeeds on the corrupted row.
    expect(gen.caseInputsForProject(pid).targetScope).toBeNull();
  });
});
