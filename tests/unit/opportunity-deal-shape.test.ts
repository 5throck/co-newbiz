// @version 1.0.0
/**
 * ADR-0194 item A (PR-1): the opportunity-scope S4 deal-shape screen and its use as the data source of kill
 * criterion #9 (deal-shape-chain:no_viable_deal_shape). Real scratch SQLite through the full migration chain and the
 * REAL registry: migration 0188 (apply / rollback / re-apply), repository, REST route (auth, validation, supersede,
 * session-only attribution, audit), the opportunity pre_fs filler semantics (risk-officer A-1, A-2), the enforce
 * guard, and the MCP tools as REST clients.
 */
import { test, expect, beforeAll, afterAll, afterEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-opportunity-deal-shape.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { previewGateSnapshot, clearSnapshotCache, carriedWithoutDataSource, OPPORTUNITY_SCOPE_VARS } = await import("../../app/web-next/lib/gate-snapshot.ts");
const repo = await import("../../db/repositories/opportunity-deal-shape.repository.ts");
const { callTool } = await import("../../mcp/co-newbiz/registry.ts");
const { InProcessRestPort } = await import("../../app/web-next/lib/mcp/in-process-port.ts");
const S = await import("./_gate-integrity-support.ts");

const NOW = "2026-11-07T09:00:00.000Z";
const NO_SHAPE = "deal-shape-chain:no_viable_deal_shape";
const ANALYST = "ds-analyst";
const VIEWER = "ds-viewer";
const ADMIN = "ds-admin";
const cookies: Record<string, string> = {};

async function login(userId: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password: `pw-${userId}-123456` }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  for (const [userId, role] of [[ANALYST, "analyst"], [VIEWER, "viewer"], [ADMIN, "admin"]] as const) {
    await createUser(db, { userId, role, password: `pw-${userId}-123456`, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const u of [ANALYST, VIEWER, ADMIN]) cookies[u] = await login(u);
});
afterEach(() => clearSnapshotCache());
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const newOpp = () => S.insertOpportunity(db, "brownfield", ANALYST);
const post = (oppId: string, body: unknown, as: string | null = ANALYST) =>
  nextRequest(`/api/opportunities/${oppId}/deal-shapes`, { method: "POST", body: JSON.stringify(body), headers: as ? { cookie: cookies[as] } : {} });
const get = (oppId: string, as: string | null = ANALYST) => nextRequest(`/api/opportunities/${oppId}/deal-shapes`, { headers: as ? { cookie: cookies[as] } : {} });
const verdict = (shape: string, viable: boolean, extra: Record<string, unknown> = {}) => ({ shape, intent: "integration", viable, rationale: `reason for ${shape}`, ...extra });
const preview = (oppId: string) => previewGateSnapshot({ entityType: "opportunity", entityId: oppId, gate: "pre_fs", actor: ANALYST, db }, { fresh: true }).snapshot;
const killKeys = (xs: Array<{ key: string }>) => xs.map((x) => x.key);

describe("migration 0188", () => {
  const DIR = join(PROJECT_ROOT, "db", "migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const TARGET = files.find((f) => f.startsWith("0188_"))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");
  const run = (d: Database, sql: string) => { for (const s of splitSqlStatements(sql)) d.run(s); };
  const rollbackStatements = (): string[] => {
    const block = SQL.slice(SQL.indexOf("ROLLBACK-SQL-BEGIN"), SQL.indexOf("ROLLBACK-SQL-END"));
    return block.split("\n").slice(1).map((l) => l.replace(/^--\s*/, "").trim()).filter(Boolean);
  };
  function dbBefore(): Database {
    const d = new Database(":memory:");
    d.run("PRAGMA foreign_keys = ON");
    d.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) {
      if (f >= TARGET) break;
      run(d, readFileSync(join(DIR, f), "utf-8"));
    }
    return d;
  }
  const tables = (d: Database) => (d.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name);

  test("opens with the reversible header, declares ROLLBACK-SQL and is purely additive (ADR-0014)", () => {
    expect(SQL.startsWith("-- @reversible: true")).toBe(true);
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    expect(SQL).toContain("ROLLBACK-SQL-END");
    expect(rollbackStatements()).toEqual(["DROP TABLE opportunity_deal_shape_evaluation;"]);
    const code = SQL.split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(code).not.toMatch(/\bALTER TABLE\b|\bINSERT INTO\b|\bUPDATE \w+ SET\b|\bDROP\b/i); // no backfill, no existing table altered
  });

  test("apply, rollback and re-apply on a scratch DB; FK check clean; existing tables untouched", () => {
    const d = dbBefore();
    const before = tables(d).sort();
    run(d, SQL);
    expect(tables(d)).toContain("opportunity_deal_shape_evaluation");
    expect(tables(d).filter((t) => !before.includes(t))).toEqual(["opportunity_deal_shape_evaluation"]);
    for (const stmt of rollbackStatements()) d.run(stmt.replace(/;$/, ""));
    expect(tables(d).sort()).toEqual(before);
    run(d, SQL); // re-apply
    expect(tables(d)).toContain("opportunity_deal_shape_evaluation");
    expect(d.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("the table enforces the closed vocabularies, the required rationale, one live row per (opportunity, shape) and the opportunity FK", () => {
    const o = newOpp();
    const ins = (over: Record<string, unknown> = {}) => {
      const r = { id: ulid(), opportunity_id: o, shape: "spv", intent: "integration", viable: 1, rationale: "x", evidence_ref: null, evaluated_by: ANALYST, evaluated_at: NOW, superseded_by: null, ...over };
      db.run("INSERT INTO opportunity_deal_shape_evaluation (id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?)", Object.values(r) as never);
    };
    expect(() => ins({ shape: "royalty" })).toThrow();
    expect(() => ins({ intent: "growth" })).toThrow();
    expect(() => ins({ viable: 2 })).toThrow();
    expect(() => ins({ rationale: "   " })).toThrow();
    expect(() => ins({ opportunity_id: "no-such-opportunity" })).toThrow();
    ins();
    expect(() => ins()).toThrow(); // second live row for the same (opportunity, shape)
    expect(() => ins({ shape: "majority_stake" })).not.toThrow();
  });
});

describe("repository", () => {
  test("record then re-record supersedes in one transaction: one live row per shape, history kept, nothing deleted, FK clean", () => {
    const o = newOpp();
    const first = repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: "spv", intent: "integration", viable: true, rationale: " first view ", evaluatedBy: ANALYST, now: "2026-11-07T09:00:00.000Z" });
    expect(first).toMatchObject({ shape: "spv", viable: true, rationale: "first view", evaluated_by: ANALYST, superseded_by: null, evidence_ref: null });
    const second = repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: "spv", intent: "capability_access", viable: false, rationale: "changed", evidenceRef: " S4 screen #2 ", evaluatedBy: ANALYST, now: "2026-11-07T10:00:00.000Z" });
    const { live, history } = repo.listDealShapeEvaluations(db, o);
    expect(live.map((r) => r.id)).toEqual([second.id]);
    expect(live[0]).toMatchObject({ viable: false, intent: "capability_access", evidence_ref: "S4 screen #2" });
    expect(history.map((r) => r.id)).toEqual([first.id]);
    expect(history[0].superseded_by).toBe(second.id);
    expect((db.query("SELECT COUNT(*) AS n FROM opportunity_deal_shape_evaluation WHERE opportunity_id = ?").get(o) as { n: number }).n).toBe(2);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("live rows come back in canonical shape order; another opportunity is untouched", () => {
    const o = newOpp();
    const other = newOpp();
    for (const s of ["minority_stake", "full_acquisition", "spv"]) repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: s, intent: "integration", viable: true, rationale: "r", evaluatedBy: ANALYST, now: NOW });
    repo.recordDealShapeEvaluation(db, { opportunityId: other, shape: "spv", intent: "integration", viable: false, rationale: "r", evaluatedBy: ANALYST, now: NOW });
    expect(repo.listDealShapeEvaluations(db, o).live.map((r) => r.shape)).toEqual(["full_acquisition", "spv", "minority_stake"]);
    expect(repo.listDealShapeEvaluations(db, other).live).toHaveLength(1);
  });

  test("validation refuses a bad vocabulary, a non-boolean viable, a blank or oversized rationale, and an unknown opportunity", () => {
    const o = newOpp();
    const base = { opportunityId: o, shape: "spv", intent: "integration", viable: true, rationale: "r", evaluatedBy: ANALYST, now: NOW };
    const kind = (over: Record<string, unknown>) => { try { repo.recordDealShapeEvaluation(db, { ...base, ...over } as never); return "ok"; } catch (e) { return (e as { kind: string }).kind; } };
    expect(kind({ shape: "royalty" })).toBe("invalid");
    expect(kind({ shape: undefined })).toBe("invalid");
    expect(kind({ intent: "growth" })).toBe("invalid");
    expect(kind({ viable: "yes" })).toBe("invalid");
    expect(kind({ viable: undefined })).toBe("invalid");
    expect(kind({ rationale: "  " })).toBe("invalid");
    expect(kind({ rationale: "x".repeat(repo.RATIONALE_MAX + 1) })).toBe("invalid");
    expect(kind({ evidenceRef: 5 })).toBe("invalid");
    expect(kind({ evaluatedBy: "" })).toBe("invalid");
    expect(kind({ opportunityId: "missing" })).toBe("opportunity_not_found");
    expect(kind({ viable: 0 })).toBe("ok");
    expect(repo.listDealShapeEvaluations(db, o).live).toHaveLength(1);
  });

  test("summarizeLiveDealShapes: null without a live row; counts only live viable rows", () => {
    const o = newOpp();
    expect(repo.summarizeLiveDealShapes(db, o)).toBeNull();
    repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: "spv", intent: "integration", viable: true, rationale: "r", evaluatedBy: ANALYST, now: "2026-11-07T09:00:00.000Z" });
    repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: "joint_venture", intent: "integration", viable: false, rationale: "r", evaluatedBy: ANALYST, now: "2026-11-07T11:00:00.000Z" });
    expect(repo.summarizeLiveDealShapes(db, o)).toEqual({ recorded: 2, viable: 1, latestAt: "2026-11-07T11:00:00.000Z" });
    repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: "spv", intent: "integration", viable: false, rationale: "r2", evaluatedBy: ANALYST, now: "2026-11-07T12:00:00.000Z" });
    expect(repo.summarizeLiveDealShapes(db, o)).toMatchObject({ recorded: 2, viable: 0 });
  });
});

describe("REST /api/opportunities/:id/deal-shapes", () => {
  test("unauthenticated 401; viewer write 403 role_required; admin 403 role_forbidden; viewer may read", async () => {
    const o = newOpp();
    expect((await post(o, verdict("spv", true), null)).status).toBe(401);
    expect((await get(o, null)).status).toBe(401);
    const v = await post(o, verdict("spv", true), VIEWER);
    expect(v.status).toBe(403);
    expect(((await v.json()) as { error: { code: string } }).error.code).toBe("role_required");
    const a = await post(o, verdict("spv", true), ADMIN);
    expect(a.status).toBe(403);
    expect(((await a.json()) as { error: { code: string } }).error.code).toBe("role_forbidden");
    expect((await get(o, VIEWER)).status).toBe(200);
    expect((await get(o, ADMIN)).status).toBe(403);
    expect(repo.listDealShapeEvaluations(db, o).live).toEqual([]); // nothing was written by a refused call
  });

  test("unknown opportunity is 404 (not 403/409) for POST and GET", async () => {
    expect((await post("nope", verdict("spv", true))).status).toBe(404);
    expect((await get("nope")).status).toBe(404);
  });

  test("validation: 400 invalid_request for vocabulary, viable type, missing rationale and a non-object body", async () => {
    const o = newOpp();
    for (const body of [verdict("royalty", true), { ...verdict("spv", true), intent: "growth" }, { ...verdict("spv", true), viable: "yes" }, { shape: "spv", intent: "integration", viable: true }, { ...verdict("spv", true), rationale: "   " }, [], "x", null]) {
      const res = await post(o, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
    }
    expect(repo.listDealShapeEvaluations(db, o).live).toEqual([]);
  });

  test("a post creates a live row (201), evaluated_by is the SESSION user even when the body names someone else, and it is audited", async () => {
    const o = newOpp();
    const res = await post(o, verdict("holdco_route", true, { evaluated_by: "someone-else", evaluatedBy: "x", evaluated_at: "1999-01-01T00:00:00Z", superseded_by: "zzz", evidence_ref: "doc-42" }));
    expect(res.status).toBe(201);
    const row = ((await res.json()) as { data: Record<string, unknown> }).data;
    expect(row).toMatchObject({ opportunity_id: o, shape: "holdco_route", intent: "integration", viable: true, evidence_ref: "doc-42", evaluated_by: ANALYST, superseded_by: null });
    expect(String(row.evaluated_at).startsWith("20")).toBe(true);
    expect(row.evaluated_at).not.toBe("1999-01-01T00:00:00Z");
    const audit = db.query("SELECT actor_user_id, action, target FROM audit_log WHERE action = 'opportunity.deal_shape.record' AND target LIKE ?").all(`${o}:%`) as Array<{ actor_user_id: string; action: string; target: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: ANALYST });
    expect(audit[0].target).toBe(`${o}:holdco_route:${row.id}`);
  });

  test("re-posting a shape supersedes its live row; GET returns live, history, unevaluated shapes, viable_count and the vocabulary", async () => {
    const o = newOpp();
    const empty = ((await (await get(o)).json()) as { data: any }).data;
    expect(empty).toMatchObject({ live: [], history: [], viable_count: null });
    expect(empty.unevaluated_shapes).toEqual(repo.DEAL_SHAPES);
    expect(empty.vocabulary).toEqual({ shapes: repo.DEAL_SHAPES, intents: repo.DEAL_SHAPE_INTENTS });

    const a = ((await (await post(o, verdict("spv", true))).json()) as { data: any }).data;
    await post(o, verdict("full_acquisition", false));
    const b = ((await (await post(o, verdict("spv", false, { rationale: "revised" }))).json()) as { data: any }).data;
    const data = ((await (await get(o)).json()) as { data: any }).data;
    expect(data.live.map((r: any) => r.shape)).toEqual(["full_acquisition", "spv"]);
    expect(data.live.find((r: any) => r.shape === "spv")).toMatchObject({ id: b.id, viable: false, rationale: "revised", superseded_by: null });
    expect(data.history).toHaveLength(1);
    expect(data.history[0]).toMatchObject({ id: a.id, superseded_by: b.id, viable: true });
    expect(data.viable_count).toBe(0);
    expect(data.unevaluated_shapes).toEqual(repo.DEAL_SHAPES.filter((s) => s !== "spv" && s !== "full_acquisition"));
  });
});

describe("kill criterion #9 filler semantics at the opportunity pre_fs gate (risk-officer A-1, A-2)", () => {
  test("no live rows -> dealshape.viable_shapes missing -> #9 unassessed (never passed, never triggered)", () => {
    const o = newOpp();
    const snap = preview(o);
    expect(killKeys(snap.kill.unassessed)).toContain(NO_SHAPE);
    expect(killKeys(snap.kill.triggered)).not.toContain(NO_SHAPE);
    expect(snap.required_acks.map((a) => a.key)).toContain(NO_SHAPE);
  });

  test("A-2: the vocabulary cannot express 'not yet evaluated' - an unevaluated shape is the absence of a row, so an opportunity with only unevaluated shapes stays unassessed", () => {
    const cols = db.query("PRAGMA table_info(opportunity_deal_shape_evaluation)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).not.toContain("status"); // no third state beside viable 0|1
    const o = newOpp();
    expect(repo.summarizeLiveDealShapes(db, o)).toBeNull();
    expect(killKeys(preview(o).kill.unassessed)).toContain(NO_SHAPE);
  });

  test("every recorded shape not viable -> present 0 -> #9 triggered (mark_conditional), not unassessed", () => {
    const o = newOpp();
    repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: "full_acquisition", intent: "integration", viable: false, rationale: "r", evaluatedBy: ANALYST, now: NOW });
    repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: "spv", intent: "integration", viable: false, rationale: "r", evaluatedBy: ANALYST, now: NOW });
    const snap = preview(o);
    expect(killKeys(snap.kill.triggered)).toContain(NO_SHAPE);
    expect(killKeys(snap.kill.unassessed)).not.toContain(NO_SHAPE);
    expect(snap.kill.triggered.find((t) => t.key === NO_SHAPE)).toMatchObject({ action: "mark_conditional" });
  });

  test("at least one viable live row -> clean (neither triggered nor unassessed)", () => {
    const o = newOpp();
    repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: "full_acquisition", intent: "integration", viable: false, rationale: "r", evaluatedBy: ANALYST, now: NOW });
    repo.recordDealShapeEvaluation(db, { opportunityId: o, shape: "minority_stake", intent: "capability_access", viable: true, rationale: "r", evaluatedBy: ANALYST, now: NOW });
    const snap = preview(o);
    expect(killKeys(snap.kill.triggered)).not.toContain(NO_SHAPE);
    expect(killKeys(snap.kill.unassessed)).not.toContain(NO_SHAPE);
  });

  test("a superseded viable row is ignored: superseding it with a non-viable verdict flips #9 from clean to triggered", async () => {
    const o = newOpp();
    expect((await post(o, verdict("spv", true))).status).toBe(201);
    expect(killKeys(preview(o).kill.triggered)).not.toContain(NO_SHAPE);
    expect((await post(o, verdict("spv", false))).status).toBe(201);
    expect(killKeys(preview(o).kill.triggered)).toContain(NO_SHAPE);
  });

  test("a recorded verdict is visible to the GET snapshot at once (input version covers the new table, no 30s stale cache)", async () => {
    const o = newOpp();
    const cached = () => previewGateSnapshot({ entityType: "opportunity", entityId: o, gate: "pre_fs", actor: ANALYST, db }).snapshot;
    expect(killKeys(cached().kill.unassessed)).toContain(NO_SHAPE);
    await post(o, verdict("spv", true));
    expect(killKeys(cached().kill.unassessed)).not.toContain(NO_SHAPE);
  });

  test("rows of another opportunity never count", () => {
    const o = newOpp();
    const other = newOpp();
    repo.recordDealShapeEvaluation(db, { opportunityId: other, shape: "spv", intent: "integration", viable: true, rationale: "r", evaluatedBy: ANALYST, now: NOW });
    expect(killKeys(preview(o).kill.unassessed)).toContain(NO_SHAPE);
  });

  test("A-1 negative: route decisions, route scores and recommendation tables never feed the count (source scan + behaviour)", () => {
    const o = newOpp(); // carries a route_decision (insertOpportunity "brownfield") and still reads unassessed
    expect(killKeys(preview(o).kill.unassessed)).toContain(NO_SHAPE);
    const repoSrc = readFileSync(join(PROJECT_ROOT, "db/repositories/opportunity-deal-shape.repository.ts"), "utf-8");
    const snapSrc = readFileSync(join(PROJECT_ROOT, "app/web-next/lib/gate-snapshot.ts"), "utf-8");
    const body = snapSrc.slice(snapSrc.indexOf("function opportunityVarRows"), snapSrc.indexOf("interface KillOutcome"));
    const sql = (s: string) => [...s.matchAll(/"((?:SELECT|INSERT|UPDATE)[^"]*)"|`((?:SELECT|INSERT|UPDATE)[^`]*)`/g)].map((m) => m[1] ?? m[2]).join("\n");
    for (const src of [sql(repoSrc), sql(body)]) {
      expect(src).not.toMatch(/route_decision|route_decision_score|recommendation|draft|llm|(?<!opportunity_)deal_shape_evaluation\b/i);
    }
    expect(sql(repoSrc)).toContain("opportunity_deal_shape_evaluation");
  });
});

describe("enforce guard (ADR-0194 item A)", () => {
  test("dealshape.viable_shapes is an opportunity-scope variable and carriedWithoutDataSource() is empty against the real registry", () => {
    expect(OPPORTUNITY_SCOPE_VARS).toContain("dealshape.viable_shapes");
    expect(carriedWithoutDataSource()).toEqual([]);
  });
});

describe("MCP tools (ADR-0011: REST client, the calling user's identity)", () => {
  const port = () => new InProcessRestPort({ userId: ANALYST, role: "analyst", scopes: ["read", "write", "propose"], mustChangePassword: false, tokenId: "t", clientId: "c" });

  test("record_deal_shape_evaluation writes through the REST route as the calling user; a spoofed evaluated_by is ignored; get_deal_shape_evaluations reads it back", async () => {
    const o = newOpp();
    const ctx = { port: port(), scopes: ["read", "write", "propose"] };
    const rec = (await callTool("http", ctx, "record_deal_shape_evaluation", { opportunityId: o, body: verdict("co_development", true, { evaluated_by: "attacker" }) })) as any;
    expect(JSON.stringify(rec)).toContain("co_development");
    const back = (await callTool("http", ctx, "get_deal_shape_evaluations", { opportunityId: o })) as any;
    const live = repo.listDealShapeEvaluations(db, o).live;
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ shape: "co_development", evaluated_by: ANALYST });
    expect(JSON.stringify(back)).toContain("co_development");
  });

  test("the record tool needs the write scope; it is a record tool (kind write), not a proposal, and its description binds the agent to user-given verdicts", async () => {
    const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
    const tool = REGISTRY.find((t) => t.name === "record_deal_shape_evaluation")!;
    expect(tool).toMatchObject({ scope: "write", kind: "write" });
    expect(tool.routes).toEqual(["POST /api/opportunities/{opportunityId}/deal-shapes"]);
    expect(tool.description).toMatch(/explicitly given/i);
    expect(tool.description).toMatch(/never infer/i);
    expect(REGISTRY.find((t) => t.name === "get_deal_shape_evaluations")).toMatchObject({ scope: "read", kind: "read" });
    const o = newOpp();
    await expect(callTool("http", { port: port(), scopes: ["read"] }, "record_deal_shape_evaluation", { opportunityId: o, body: verdict("spv", true) })).rejects.toThrow(/write/);
    expect(repo.listDealShapeEvaluations(db, o).live).toEqual([]);
  });
});
