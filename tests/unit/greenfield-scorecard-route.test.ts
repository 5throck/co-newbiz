// @version 1.0.0
/**
 * ADR-0161 Row 2 — POST /api/projects/:id/post-management/scorecard (human-only
 * greenfield S12 cycle) and the effective venture_class on the post-management
 * GET, against the REAL route handlers and a scratch SQLite.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-greenfield-scorecard-route.sqlite";
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
const gx = await import("../../app/web-next/lib/greenfield-execution.ts");

const NOW = new Date().toISOString();
const A1 = "gs_analyst1";
const AGENT = [...AGENT_KEYS][0];
let c1 = "";
let agentCookie = "";
let bearer = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const path = (p: string) => `/api/projects/${p}/post-management/scorecard`;
const post = (p: string, body: unknown, cookie = c1) => nextRequest(path(p), { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as Record<string, any>;

function seedProject(track: "greenfield" | "brownfield" | null, subTrack: string | null, withRun = true): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `gs ${ulid()}`, "테스트", "selected", A1, NOW]);
  if (track) {
    db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), opp, track, subTrack, "test", A1, NOW]);
  }
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, track, origin) VALUES (?,?,?,?,?,?)", [id, `GS-${id.slice(-8)}`, NOW, opp, track, null]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, A1, "lead", "root", NOW, "author"]);
  if (withRun) db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), id, "t", "h", A1, NOW]);
  return id;
}
const m = (k: string, extra: Record<string, unknown> = {}) => ({ measure_key: k, value: 80, target_value: 100, status: "deviation", evidence_ref: "doc:gs-1", ...extra });

beforeAll(async () => {
  for (const [id, pw] of [[A1, "pw-gs-analyst-1"], [AGENT, "pw-agent-1234567"]] as const) {
    await createUser(db, { userId: id, role: "analyst", password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  c1 = await loginCookie(A1, "pw-gs-analyst-1");
  agentCookie = await loginCookie(AGENT, "pw-agent-1234567");
  bearer = issueApiToken(db, { userId: A1, label: "agent", scopes: ["read", "write"], now: NOW }).token;
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("POST post-management/scorecard — human-only, greenfield-only", () => {
  test("wiring: HUMAN_ONLY_ROUTES + coverage exclusions", () => {
    expect(isHumanOnly("POST", "/api/projects/X/post-management/scorecard", {})).toBe(true);
    expect(isHumanOnly("GET", "/api/projects/X/post-management", {})).toBe(false);
    expect(readFileSync("scripts/co-newbiz/mcp-coverage.exclusions.yaml", "utf-8")).toContain('route: "POST /api/projects/{}/post-management/scorecard"');
  });
  test("bearer and agent session get 403 human_only", async () => {
    const p = seedProject("greenfield", null);
    const body = { review_cycle: "2026-Q4", measures: [m("utilisation_pct")] };
    const b = await nextRequest(path(p), { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
    expect(b.status).toBe(403);
    expect((await json(b)).error.code).toBe("human_only");
    const a = await post(p, body, agentCookie);
    expect(a.status).toBe(403);
    expect((await json(a)).error.code).toBe("human_only");
    expect((db.query("SELECT COUNT(*) n FROM venture_scorecard WHERE project_id = ?").get(p) as { n: number }).n).toBe(0);
  });
  test("brownfield 409 not_applicable_track; unresolved 409 needs_classification", async () => {
    const r = await post(seedProject("brownfield", "m_and_a"), { review_cycle: "2026-Q4", measures: [m("utilisation_pct")] });
    expect(r.status).toBe(409);
    expect((await json(r)).error.code).toBe("not_applicable_track");
    const u = await post(seedProject(null, null), { review_cycle: "2026-Q4", measures: [m("utilisation_pct")] });
    expect(u.status).toBe(409);
    expect((await json(u)).error.code).toBe("needs_classification");
  });
  test("validation: cycle, keys, finite numbers, status, evidence, note length, duplicates", async () => {
    const p = seedProject("greenfield", null);
    const bad = async (body: unknown) => {
      const r = await post(p, body);
      expect(r.status).toBe(400);
      expect((await json(r)).error.code).toBe("invalid_request");
    };
    await bad({ review_cycle: "2026-Q5", measures: [m("utilisation_pct")] });
    await bad({ review_cycle: "2026-Q4", measures: [] });
    await bad({ review_cycle: "2026-Q4", measures: [m("made_up_key")] });
    await bad({ review_cycle: "2026-Q4", measures: [m("utilisation_pct", { value: "80" })] });
    await bad({ review_cycle: "2026-Q4", measures: [m("utilisation_pct", { value: Number.POSITIVE_INFINITY })] }); // serialises to null -> status needs insufficient_evidence
    await bad({ review_cycle: "2026-Q4", measures: [m("utilisation_pct", { target_value: null })] });
    await bad({ review_cycle: "2026-Q4", measures: [m("utilisation_pct", { status: "pass" })] });
    await bad({ review_cycle: "2026-Q4", measures: [m("utilisation_pct", { evidence_ref: "free text" })] });
    await bad({ review_cycle: "2026-Q4", measures: [m("utilisation_pct"), m("utilisation_pct")] });
    await bad({ review_cycle: "2026-Q4", measures: [m("x".repeat(121))] });
    await bad({ review_cycle: "2026-Q4", venture_class: "passive", note: "n", measures: [m("utilisation_pct")] });
    await bad({ review_cycle: "2026-Q4", venture_class: "enabling", note: "x".repeat(2001), measures: [m("utilisation_pct")] });
    expect((db.query("SELECT COUNT(*) n FROM venture_scorecard WHERE project_id = ?").get(p) as { n: number }).n).toBe(0);
    // insufficient_evidence admits a missing value/target; goal:<metric> is a documented reference key.
    const ok = await post(p, { review_cycle: "2026-Q4", measures: [m("utilisation_pct", { value: null, target_value: null, status: "insufficient_evidence" }), m("goal:revenue")] });
    expect(ok.status).toBe(201);
  });
  test("override without a note is refused; default per sub-track prefilled; run required; cycle immutable", async () => {
    const rbd = seedProject("greenfield", "existing_business_rbd");
    const noNote = await post(rbd, { review_cycle: "2026-Q3", venture_class: "driving", measures: [m("revenue_vs_case")] });
    expect(noNote.status).toBe(400);
    const r = await post(rbd, { review_cycle: "2026-Q3", measures: [m("revenue_vs_case")] });
    expect(r.status).toBe(201);
    const d = (await json(r)).data;
    expect(d.venture_class).toMatchObject({ default: "enabling", effective: "enabling", overridden: false, override: null });
    expect(d.measures).toBe(1);
    const dup = await post(rbd, { review_cycle: "2026-Q3", measures: [m("revenue_vs_case")] });
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.code).toBe("cycle_exists");
    const iv = seedProject("greenfield", "intra_venture");
    expect((await json(await post(iv, { review_cycle: "2026-Q3", measures: [m("headcount_vs_plan")] }))).data.venture_class.default).toBe("emergent");
    const noRun = await post(seedProject("greenfield", null, false), { review_cycle: "2026-Q3", measures: [m("headcount_vs_plan")] });
    expect(noRun.status).toBe(409);
    expect((await json(noRun)).error.code).toBe("run_required");
  });
  test("override audited with before/after/note; every cycle audited; GET returns effective class and latest values", async () => {
    const p = seedProject("greenfield", null);
    await post(p, { review_cycle: "2026-Q3", measures: [m("utilisation_pct")] });
    // Same measure on the same run is refused (migration 0024 UNIQUE excludes review_cycle) until a newer run exists.
    const blocked = await post(p, { review_cycle: "2026-Q4", measures: [m("utilisation_pct")] });
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).error.code).toBe("run_required");
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), p, "t2", "h2", A1, new Date(Date.now() + 1000).toISOString()]);
    const r = await post(p, { review_cycle: "2026-Q4", venture_class: "enabling", note: "기존 사업 설비를 공유하므로 enabling으로 분류", measures: [m("utilisation_pct", { value: 92.5 }), m("revenue_vs_case", { value: 1.25, target_value: 1 })] });
    expect(r.status).toBe(201);
    const ov = db.query("SELECT actor_user_id, target FROM audit_log WHERE action = 'venture_scorecard.venture_class_override' AND target LIKE ?").all(`${p}:%`) as Array<{ actor_user_id: string; target: string }>;
    expect(ov.length).toBe(1);
    expect(ov[0].actor_user_id).toBe(A1);
    expect(ov[0].target).toContain('"before":"driving"');
    expect(ov[0].target).toContain('"after":["enabling"]');
    expect(ov[0].target).toContain("기존 사업 설비를 공유");
    const cycles = db.query("SELECT target FROM audit_log WHERE action = ? AND target LIKE ?").all(gx.GREENFIELD_CYCLE_ACTION, `${p}:%`) as unknown[];
    expect(cycles.length).toBe(2);
    const g = (await json(await nextRequest(`/api/projects/${p}/post-management`, { headers: { cookie: c1 } }))).data.greenfield_ramp_up;
    expect(g.review_cycle).toBe("2026-Q4");
    expect(g.default_venture_class).toBe("driving");
    expect(g.venture_class).toMatchObject({ default: "driving", effective: "enabling", overridden: true });
    expect(g.venture_class.override).toMatchObject({ review_cycle: "2026-Q4", before: "driving", after: "enabling", by: A1, note: "기존 사업 설비를 공유하므로 enabling으로 분류" });
    expect(g.measures.find((x: { measure_key: string }) => x.measure_key === "utilisation_pct")).toMatchObject({ actual_value: "92.5", target_value: "100", section: "strategic", venture_class: "enabling" });
    expect(g.gate_blocking).toBe(false);
  });
  test("MNPI project: non-insider refused", async () => {
    const p = seedProject("greenfield", null);
    db.run("INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)", [p, "restricted", 1, A1, NOW]);
    const r = await post(p, { review_cycle: "2026-Q4", measures: [m("utilisation_pct")] });
    expect(r.status).toBe(403);
    expect((await json(r)).error.code).toBe("insider_required");
  });
});
