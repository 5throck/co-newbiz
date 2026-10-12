// @version 1.0.0
/**
 * ADR-0161 Row 2 review fixes (risk-officer + security-engineer) that are not
 * covered in greenfield-execution.test.ts:
 *  R6 (S2)  scorecard review_cycle bound (<= current quarter + 1) and strict observed_at;
 *  R7 (S3)  committee minutes / session IDOR: sessionId bound to the path
 *           opportunity, a committee run, and promoted-project visibility; a
 *           s11_execution_baseline run is never addressable (404) and never rewritten;
 *  R10 (B)  policy_migration audit target carries a <=120-char note summary + hash.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-adr0161-review-fixes.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const gx = await import("../../app/web-next/lib/greenfield-execution.ts");

const NOW = new Date().toISOString();
const A1 = "rf_analyst1";
const A2 = "rf_outsider";
let c1 = "";
let c2 = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const post = (path: string, body: unknown, cookie = c1) => nextRequest(path, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const get = (path: string, cookie = c1) => nextRequest(path, { headers: { cookie } });
const json = async (res: Response) => (await res.json()) as Record<string, any>;

function seedOpp(): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, `rf ${ulid()}`, "t", "selected", A1, NOW]);
  return opp;
}
function seedProject(opp: string, track: string | null, members: string[] = [A1]): string {
  if (track) {
    db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), opp, track, null, "t", A1, NOW]);
  }
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, track) VALUES (?,?,?,?,?)", [id, `RF-${id.slice(-8)}`, NOW, opp, track]);
  for (const m of members) {
    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, m, "lead", "root", NOW, "t"]);
  }
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [ulid(), id, "t", "h", A1, NOW]);
  return id;
}
function seedCommitteeSession(opp: string): string {
  const id = ulid();
  db.run(
    `INSERT INTO process_run (id, entity_type, entity_id, spec_version, stage, status, started_by, started_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, "opportunity", opp, "t", "route-steering-committee", "done", A1, NOW, JSON.stringify({ committee_key: "route-steering-committee", decision_mode: "agent_team", synthesized: true })],
  );
  return id;
}

beforeAll(async () => {
  for (const [id, pw] of [[A1, "pw-rf-analyst-1"], [A2, "pw-rf-outsider-1"]] as const) {
    await createUser(db, { userId: id, role: "analyst", password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: id, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  c1 = await loginCookie(A1, "pw-rf-analyst-1");
  c2 = await loginCookie(A2, "pw-rf-outsider-1");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("R6 scorecard cycle and observed_at bounds", () => {
  test("lib validators", () => {
    const now = "2026-10-12T00:00:00.000Z";
    expect(gx.reviewCycleIssue("2026-Q4", now)).toBeNull();
    expect(gx.reviewCycleIssue("2027-Q1", now)).toBeNull(); // current + 1
    expect(gx.reviewCycleIssue("2027-Q2", now)).not.toBeNull();
    expect(gx.reviewCycleIssue("2099-Q4", now)).not.toBeNull();
    expect(gx.reviewCycleIssue("2026-Q5", now)).not.toBeNull();
    expect(gx.observedAtIssue("2026-10-01", now)).toBeNull();
    expect(gx.observedAtIssue("2026-10-01T09:30:00Z", now)).toBeNull();
    expect(gx.observedAtIssue("2026-99-99xyz", now)).not.toBeNull();
    expect(gx.observedAtIssue("2026-02-30", now)).not.toBeNull();
    expect(gx.observedAtIssue("2026-10-20", now)).not.toBeNull(); // future beyond a day
  });
  test("route refuses 2099-Q4 and '2026-99-99xyz' with 400", async () => {
    const p = seedProject(seedOpp(), "greenfield");
    const path = `/api/projects/${p}/post-management/scorecard`;
    const m = { measure_key: "utilisation_pct", value: 50, target_value: 60, status: "deviation", evidence_ref: "doc:ramp-1" };
    const r1 = await post(path, { review_cycle: "2099-Q4", measures: [m] });
    expect(r1.status).toBe(400);
    expect((await json(r1)).error.message).toContain("미래");
    const r2 = await post(path, { review_cycle: "2026-Q3", measures: [{ ...m, observed_at: "2026-99-99xyz" }] });
    expect(r2.status).toBe(400);
    expect((await json(r2)).error.message).toContain("observed_at");
    expect((db.query("SELECT COUNT(*) c FROM venture_scorecard WHERE project_id = ?").get(p) as { c: number }).c).toBe(0);
  });
});

describe("R7 committee session / minutes IDOR", () => {
  test("a s11_execution_baseline run is never addressable as a session (404) and is not rewritten", async () => {
    const opp = seedOpp();
    const p = seedProject(opp, "greenfield");
    const runId = ulid();
    const meta = JSON.stringify({ kind: "confirmation", entries: {}, confirmation: { rationale: "x" } });
    db.run(
      `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, started_by, started_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [runId, "opportunity", opp, p, "t", "s11_execution_baseline", "done", A1, NOW, meta],
    );
    const base = `/api/opportunities/${opp}/committee-sessions/${runId}`;
    expect((await post(`${base}/minutes`, { confirm: true })).status).toBe(404);
    expect((await get(`${base}/minutes`)).status).toBe(404);
    expect((await get(base)).status).toBe(404);
    expect((await post(`${base}/advance`, {})).status).toBe(404);
    expect((await post(`${base}/positions`, { positionMd: "x" })).status).toBe(404);
    expect((db.query("SELECT meta_json FROM process_run WHERE id = ?").get(runId) as { meta_json: string }).meta_json).toBe(meta);
    const { confirmCommitteeMinutes } = await import("../../app/web-next/lib/committee-scorecard.ts");
    expect(() => confirmCommitteeMinutes(db, runId, A1)).toThrow(/not found/);
  });
  test("session bound to another opportunity -> 404; promoted project not visible -> 404; member OK", async () => {
    const opp = seedOpp();
    seedProject(opp, "brownfield", [A1]);
    const sid = seedCommitteeSession(opp);
    const other = seedOpp();
    expect((await post(`/api/opportunities/${other}/committee-sessions/${sid}/minutes`, { confirm: true })).status).toBe(404);
    // A2 is not a member of the promoted project.
    expect((await post(`/api/opportunities/${opp}/committee-sessions/${sid}/minutes`, { confirm: true }, c2)).status).toBe(404);
    expect((await get(`/api/opportunities/${opp}/committee-sessions/${sid}/minutes`, c2)).status).toBe(404);
    const ok = await post(`/api/opportunities/${opp}/committee-sessions/${sid}/minutes`, { confirm: true });
    expect(ok.status).toBe(200);
  });
});

describe("R10 policy_migration audit target", () => {
  test("note stored as <=120-char summary + hash", () => {
    const p = seedProject(seedOpp(), "greenfield");
    const note = "긴 이행 메모 ".repeat(40);
    const r = gx.recordPolicyMigration({ projectId: p, migrationNote: note, completedStages: ["S8"], actor: A1 }, db);
    expect(r.ok).toBe(true);
    const row = db.query("SELECT target FROM audit_log WHERE action = 'policy_migration' AND target LIKE ?").get(`${p}|%`) as { target: string };
    const d = JSON.parse(row.target.slice(p.length + 1));
    expect(d.migration_note.length).toBeLessThanOrEqual(gx.AUDIT_SUMMARY_LEN);
    expect(d.migration_note_hash).toBe(gx.sha16(note.trim()));
    expect(row.target).not.toContain(note.trim());
  });
});
