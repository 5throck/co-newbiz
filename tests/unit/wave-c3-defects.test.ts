/**
 * Wave C-3 (pilot-009 re-run defects D-2, D-3, D-4, D-5, D-6, D-7).
 *  - D-4: GO on a gate is refused (409) until its stage prerequisites are
 *    complete; HOLD/KILL stay allowed; existing rows are grandfathered.
 *  - D-2: an offline/synthesized sizing is graded C, and the stored grade is
 *    what the API returns.
 *  - D-3: industry_id on opportunity create/update (validated against md_industry).
 *  - D-6: manual competitive-structure input lands where the S1 predicate reads.
 *  - D-5: a known-target deal pre-fills S6 but S1–S4 still gate it.
 *  - D-7: offline synthesis uses industry-agnostic segments.
 * The LLM is never configured and no external call is made.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wave-c3-defects.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_QUEUE_NO_SPAWN = "1";
for (const k of ["CO_NEWBIZ_LLM_PROVIDER", "CO_NEWBIZ_LLM_API_KEY", "CO_NEWBIZ_LLM_MODEL", "TAVILY_API_KEY", "ECOS_API_KEY", "KRX_API_KEY", "DART_API_KEY", "CO_NEWBIZ_DART_API_KEY"]) process.env[k] = "";
process.env.WEB_SEARCH_DDG_ENABLED = "false";
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { deriveDataConfidence } = await import("../../db/lib/data-confidence.ts");
const { evaluateProcess, gateGoPrerequisiteGaps } = await import("../../app/web-next/lib/process-flow.ts");
const { runSizingPipeline } = await import("../../app/web-next/lib/market-sizing-pipeline.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

resetDb();
const demo = seedS1ToS12Demo(TEST_DB_PATH, { humanDecisions: false });
const db = getDb(TEST_DB_PATH);
const NOW = new Date().toISOString();
let cookie = "";

beforeAll(async () => {
  await createUser(db, { userId: "c3-analyst", role: "analyst", password: "pw-c3-analyst-123", createdBy: "test", now: NOW });
  approveUser(db, { userId: "c3-analyst", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "c3-analyst", password: "pw-c3-analyst-123" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const call = (path: string, method: string, body?: unknown) =>
  nextRequest(path, { method, headers: { cookie }, body: body === undefined ? undefined : JSON.stringify(body) });

function bareOpportunity(): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [id, `bare-${id.slice(-5)}`, "identified", "test", NOW]);
  return id;
}
function bareProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `C3-${id.slice(-6)}`, NOW]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, "c3-analyst", "lead", "test", NOW, "c3"]);
  return id;
}
const oppGate = (id: string, body: Record<string, unknown>) => call(`/api/opportunities/${id}/gate-decisions`, "POST", { rationale: "r", ...body });
const projGate = (id: string, body: Record<string, unknown>) => call(`/api/projects/${id}/gate-decisions`, "POST", { rationale: "r", ...body });

describe("D-4 gate GO requires stage prerequisites", () => {
  test("the S1–S12 demo satisfies every prerequisite", () => {
    for (const g of ["screening", "pre_fs", "target_screening"] as const) expect(gateGoPrerequisiteGaps({ type: "opportunity", id: demo.opportunityId }, g)).toEqual([]);
    for (const g of ["fs", "dd", "entity_ic", "group_ic"] as const) expect(gateGoPrerequisiteGaps({ type: "project", id: demo.projectId }, g)).toEqual([]);
  });

  test.each(["screening", "pre_fs", "target_screening"])("opportunity gate %s: GO refused (409) with the missing prerequisites named", async (gate) => {
    const id = bareOpportunity();
    const res = await oppGate(id, { gate, decision: "go" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("gate_prerequisites_incomplete");
    expect(body.error.message).toMatch(gate === "screening" ? /S1/ : gate === "pre_fs" ? /S4/ : /S7/);
    expect(db.query("SELECT COUNT(*) c FROM gate_decision WHERE entity_id = ?").get(id)).toEqual({ c: 0 });
  });

  test.each(["fs", "dd", "entity_ic", "group_ic"])("project gate %s: GO refused (409)", async (gate) => {
    const id = bareProject();
    const res = await projGate(id, { gate, decision: "go" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("gate_prerequisites_incomplete");
  });

  test("HOLD and KILL stay allowed anytime; KILL still needs learning capture", async () => {
    const id = bareOpportunity();
    expect((await oppGate(id, { gate: "screening", decision: "hold", missing_artifacts: ["S1"] })).status).toBe(201);
    expect((await oppGate(id, { gate: "screening", decision: "kill" })).status).toBe(422);
    expect((await oppGate(id, { gate: "screening", decision: "kill", learning_capture: "no demand" })).status).toBe(201);
    const pid = bareProject();
    expect((await projGate(pid, { gate: "fs", decision: "hold", missing_artifacts: ["Business Case"] })).status).toBe(201);
  });

  test("GO is allowed once the prerequisites are complete (every gate)", async () => {
    for (const gate of ["screening", "pre_fs", "target_screening"]) {
      expect((await oppGate(demo.opportunityId, { gate, decision: "go" })).status).toBe(201);
    }
    for (const gate of ["fs", "dd", "entity_ic", "group_ic"]) {
      const member = db.query("SELECT 1 FROM project_member WHERE project_id = ? AND user_id = 'c3-analyst'").get(demo.projectId);
      if (!member) db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [demo.projectId, "c3-analyst", "lead", "test", NOW, "c3"]);
      // R2-E: IC GO over open gaps carries the exception rationale (server-enforced).
      const gap = gate === "entity_ic" || gate === "group_ic" ? { gap_rationale: "c3: gaps accepted with this rationale" } : {};
      expect((await projGate(demo.projectId, { gate, decision: "go", ...gap })).status).toBe(201);
    }
  });

  test("an old premature GO row is grandfathered: still read and evaluated; only new writes are checked", async () => {
    const id = bareOpportunity();
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", id, "screening", "go", "legacy", "old", "2026-01-01T00:00:00.000Z"]);
    expect(evaluateProcess({ type: "opportunity", id }).gateStatus.screening).toBe("go");
    const list = await call(`/api/opportunities/${id}/gate-decisions`, "GET");
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: { latest: Array<{ gate: string; decision: string }> } }).data.latest).toEqual([expect.objectContaining({ gate: "screening", decision: "go" })]);
    expect((await oppGate(id, { gate: "pre_fs", decision: "go" })).status).toBe(409);
  });
});

describe("D-2 data-confidence grade", () => {
  test("synthesized sizing is capped at C; an LLM estimate is B; frozen research is A", () => {
    const ind = ulid();
    db.run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [ind, "c3-ind", "c3-ind", NOW]);
    expect(deriveDataConfidence(db, ind, "frozen-research").grade).toBe("A");
    expect(deriveDataConfidence(db, ind, "llm-estimate").grade).toBe("B");
    expect(deriveDataConfidence(db, ind, "llm-estimate", { synthesized: true }).grade).toBe("C");
    expect(deriveDataConfidence(db, ind, "frozen-research", { synthesized: true }).grade).toBe("C");
  });

  test("an offline pipeline run stores C, the API returns the same stored grade, and D-7 segments are industry-agnostic", async () => {
    const ind = ulid();
    db.run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [ind, "온라인 리테일(테스트)", "online retail test", NOW]);
    const aid = ulid();
    db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", [aid, ind, "in_progress", "test", NOW]);
    await runSizingPipeline(db, aid);
    const stored = db.query("SELECT data_confidence_grade g, payload FROM market_sizing_version WHERE analysis_id = ?").get(aid) as { g: string; payload: string };
    expect(stored.g).toBe("C");
    const matrix = (JSON.parse(stored.payload) as { matrix: { synthesized?: boolean; segments?: Array<{ code: string }> } }).matrix;
    expect(matrix.synthesized).toBe(true);
    const codes = (matrix.segments ?? []).map((s) => s.code);
    expect(codes.length).toBeGreaterThanOrEqual(2);
    expect(codes).not.toContain("construction");
    expect(codes).not.toContain("mining");
    const api = (await (await call(`/api/market-overview/analyses/${aid}`, "GET")).json()) as { data: { versions: Array<{ data_confidence_grade: string | null }> } };
    expect(api.data.versions[0].data_confidence_grade).toBe(stored.g);
  }, 60000);
});

describe("D-3 link a hand-registered opportunity to an industry", () => {
  test("create and update accept industry_id; unknown ids are rejected; the S1 predicate then finds the matrix", async () => {
    const created = await call("/api/opportunities", "POST", { name: "hand-registered", industry_id: "does-not-exist" });
    expect(created.status).toBe(400);
    const ok = await call("/api/opportunities", "POST", { name: "hand-registered" });
    const id = ((await ok.json()) as { data: { id: string } }).data.id;
    expect(db.query("SELECT industry_id FROM opportunity WHERE id = ?").get(id)).toEqual({ industry_id: null });
    expect((await call(`/api/opportunities/${id}`, "PUT", { industry_id: "nope" })).status).toBe(400);
    const demoIndustry = (db.query("SELECT industry_id FROM opportunity WHERE id = ?").get(demo.opportunityId) as { industry_id: string }).industry_id;
    expect((await call(`/api/opportunities/${id}`, "PUT", { industry_id: demoIndustry })).status).toBe(200);
    expect(db.query("SELECT industry_id FROM opportunity WHERE id = ?").get(id)).toEqual({ industry_id: demoIndustry });
    const list = (await (await call("/api/opportunities", "GET")).json()) as { data: Array<{ id: string; industry_id: string | null }> };
    expect(list.data.find((o) => o.id === id)?.industry_id).toBe(demoIndustry);
    // The S1 predicate keys on this column: the matrix/chain of the linked industry no longer reads as missing.
    const s1 = evaluateProcess({ type: "opportunity", id }).requiredArtifacts;
    expect(s1).not.toContain("가치사슬 구조");
  });
});

describe("D-6 S1 competitive structure input", () => {
  test("a manual entry is stored where the S1 predicate reads it", async () => {
    const ind = ulid();
    db.run("INSERT INTO md_industry (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [ind, "c3-comp-ind", "c3-comp-ind", NOW]);
    const aid = ulid();
    db.run("INSERT INTO market_sizing_analysis (id, industry_id, status, created_by, created_at) VALUES (?,?,?,?,?)", [aid, ind, "in_progress", "test", NOW]);
    await runSizingPipeline(db, aid);
    const before = JSON.parse((db.query("SELECT payload FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1").get(aid) as { payload: string }).payload) as { matrix: { competitive?: unknown } };
    expect(before.matrix.competitive).toBeUndefined(); // offline: nothing derived

    expect((await call(`/api/market-overview/analyses/${aid}/competitive`, "PUT", { structure: "" , players: [] })).status).toBe(400);
    const res = await call(`/api/market-overview/analyses/${aid}/competitive`, "PUT", {
      structure: "상위 4개사 합계 46% — 과점 경쟁",
      players: [{ name: "Naver", share_pct: 18 }, { name: "Coupang", share_pct: 13 }],
    });
    expect(res.status).toBe(201);
    const latest = db.query("SELECT payload, data_confidence_grade g, version_no FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1").get(aid) as { payload: string; g: string; version_no: number };
    const matrix = (JSON.parse(latest.payload) as { matrix: { competitive: { structure: string; players: Array<{ name: string }> } } }).matrix;
    expect(matrix.competitive.players.map((p) => p.name)).toEqual(["Naver", "Coupang"]);
    expect(latest.version_no).toBe(2);
    expect(latest.g).toBe("C"); // still a synthesized matrix: entering a structure does not upgrade the grade

    // The S1 predicate: link an opportunity to this industry; "경쟁 구조" is no longer missing.
    const o = ulid();
    db.run("INSERT INTO opportunity (id, name, status, created_by, created_at, industry_id) VALUES (?,?,?,?,?,?)", [o, "comp-opp", "identified", "test", NOW, ind]);
    expect(evaluateProcess({ type: "opportunity", id: o }).requiredArtifacts).not.toContain("경쟁 구조");
  }, 60000);
});

describe("D-5 known-target entry", () => {
  test("the named target is pre-filled into S6, but S1–S4 still gate the deal", async () => {
    const res = await call("/api/opportunities", "POST", { name: "Emart eBay Korea", known_target: { company_name: "이베이코리아" } });
    expect(res.status).toBe(201);
    const { id, known_target_id } = ((await res.json()) as { data: { id: string; known_target_id: string } }).data;
    expect(known_target_id).toBeTruthy();
    const t = db.query("SELECT company_name, universe_note FROM brownfield_target WHERE opportunity_id = ?").all(id) as Array<{ company_name: string; universe_note: string }>;
    expect(t).toHaveLength(1);
    expect(t[0].company_name).toBe("이베이코리아");
    expect(t[0].universe_note.startsWith("[알려진 대상]")).toBe(true);
    const ev = evaluateProcess({ type: "opportunity", id });
    expect(ev.currentStage).toBe("S1"); // nothing skipped
    expect(ev.completedStages).toEqual([]);
    expect((await oppGate(id, { gate: "target_screening", decision: "go" })).status).toBe(409);
    expect((await call("/api/opportunities", "POST", { name: "x", known_target: { company_name: " " } })).status).toBe(400);
  });
});
