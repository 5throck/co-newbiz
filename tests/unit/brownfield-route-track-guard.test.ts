// @version 1.0.0
/**
 * T-20261022-038 — the brownfield S6/S7 opportunity-carrier write surfaces and
 * the greenfield S5 investment-simulation run must not trust the client's
 * TrackGate (server-side mirror of T-20261022-007): an opportunity whose
 * CURRENT route decision names the OTHER track gets 409 not_applicable_track
 * with NOTHING stored; no route decision yet stays writable (legacy drafting
 * precedes the S4 record). S9 capability-dd (project-carrier) refuses a
 * greenfield/unresolvable resolveTrack carrier on PUT with 409 and stays open
 * on GET (read-only evidence).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-brownfield-route-track-guard.sqlite";
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
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

const NOW = "2026-10-22T09:00:00Z";
const ANALYST = "bf-track-analyst";
let cookie = "";

const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

const postEvalCriterion = (oppId: string) =>
  nextRequest(`/api/brownfield/${oppId}/eval-criteria`, { method: "POST", headers: { cookie }, body: JSON.stringify({ category: "financial", label: "가드 테스트 항목", description: "T-038" }) });
const postTarget = (oppId: string) =>
  nextRequest(`/api/brownfield/${oppId}/targets`, { method: "POST", headers: { cookie }, body: JSON.stringify({ company_name: "가드테스트 대상" }) });
const postTargetProposal = (oppId: string) =>
  nextRequest(`/api/brownfield/${oppId}/target-proposals`, { method: "POST", headers: { cookie }, body: JSON.stringify({ company_name: "가드테스트 제안", discovery_source: "manual" }) });
const postUniverseDraft = (oppId: string) =>
  nextRequest(`/api/brownfield/${oppId}/universe-criteria-draft`, { method: "POST", headers: { cookie }, body: JSON.stringify({}) });
const postSimulation = (oppId: string) =>
  nextRequest(`/api/greenfield/${oppId}/investment-simulation`, { method: "POST", headers: { cookie }, body: JSON.stringify({ envelope_krw_m: 500, draws: 100 }) });

const criteriaCount = (oppId: string) => (db.query("SELECT COUNT(*) n FROM brownfield_eval_criterion WHERE opportunity_id = ?").get(oppId) as { n: number }).n;
const targetsCount = (oppId: string) => (db.query("SELECT COUNT(*) n FROM brownfield_target WHERE opportunity_id = ?").get(oppId) as { n: number }).n;
const runsCount = (oppId: string) => (db.query("SELECT COUNT(*) n FROM investment_simulation_run WHERE opportunity_id = ?").get(oppId) as { n: number }).n;
const draftAuditsOf = (oppId: string) => (db.query("SELECT COUNT(*) n FROM audit_log WHERE action = 'universe_criteria.draft' AND target = ?").get(oppId) as { n: number }).n;

/** Opportunity carrier with an optional CURRENT route decision (the T-007 seedOpp shape). */
function seedOpp(track: "greenfield" | "brownfield" | null): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [id, `bf-track ${id.slice(-6)}`, "산업", "selected", ANALYST, NOW]);
  if (track) {
    db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), id, track, "test", ANALYST, NOW]);
  }
  return id;
}

/** Project carrier with an optional route decision + md_project.track, and one S3
 *  gap-register row so capability-dd PUT has a valid row_id to answer. */
function seedProject(track: "greenfield" | "brownfield" | null): { projectId: string; oppId: string } {
  const opp = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at, capability_gap_json) VALUES (?,?,?,?,?,?,?)",
    [opp, `bf-track proj ${opp.slice(-6)}`, "산업", "selected", ANALYST, NOW, JSON.stringify({ rows: [{ id: "cap-1", capability: "생산 공정 운영", source: "manual" }] })],
  );
  if (track) {
    db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), opp, track, "test", ANALYST, NOW]);
  }
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, track, origin) VALUES (?,?,?,?,?,?)", [id, `BF-${id.slice(-8)}`, NOW, opp, track, null]);
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [id, ANALYST, "lead", "root", NOW, "test"]);
  return { projectId: id, oppId: opp };
}

/** A saved S5 plan (one manual capex line) so the simulation has something to run. */
function seedS5Plan(oppId: string): void {
  const lines = [{ line: "설비 투자", category: "capex", amount: 1200, amountUnit: "krw_m", amountUnitConfirmed: true, amountKrwM: 1200 }];
  db.run(
    "INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, business_case_lines_json, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), oppId, null, null, JSON.stringify(lines), null, ANALYST, NOW, NOW],
  );
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-bf-track-1234", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: "pw-bf-track-1234" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("brownfield opportunity-carrier routes — greenfield carriers are refused server-side", () => {
  test("eval-criteria POST: greenfield decision -> 409 not_applicable_track, nothing stored", async () => {
    const opp = seedOpp("greenfield");
    const res = await postEvalCriterion(opp);
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("not_applicable_track");
    expect(criteriaCount(opp)).toBe(0);
  });

  test("eval-criteria POST: no route decision yet -> unchanged 201, criterion stored", async () => {
    const opp = seedOpp(null);
    const res = await postEvalCriterion(opp);
    expect(res.status).toBe(201);
    expect(criteriaCount(opp)).toBe(1);
  });

  test("targets POST: greenfield decision -> 409 not_applicable_track, nothing stored", async () => {
    const opp = seedOpp("greenfield");
    const res = await postTarget(opp);
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("not_applicable_track");
    expect(targetsCount(opp)).toBe(0);
  });

  test("targets POST: no route decision yet -> unchanged 201, candidate stored", async () => {
    const opp = seedOpp(null);
    const res = await postTarget(opp);
    expect(res.status).toBe(201);
    expect(targetsCount(opp)).toBe(1);
  });

  test("target-proposals POST: greenfield decision -> 409 not_applicable_track, nothing stored", async () => {
    const opp = seedOpp("greenfield");
    const res = await postTargetProposal(opp);
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("not_applicable_track");
    expect(targetsCount(opp)).toBe(0);
  });

  test("target-proposals POST: no route decision yet -> unchanged 201, candidate stored", async () => {
    const opp = seedOpp(null);
    const res = await postTargetProposal(opp);
    expect(res.status).toBe(201);
    expect(targetsCount(opp)).toBe(1);
  });

  test("universe-criteria-draft POST: greenfield decision -> 409 before any draft audit", async () => {
    const opp = seedOpp("greenfield");
    const res = await postUniverseDraft(opp);
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("not_applicable_track");
    expect(draftAuditsOf(opp)).toBe(0);
  });

  test("universe-criteria-draft POST: no route decision yet -> unchanged 200 (no grounding, nothing drafted)", async () => {
    const opp = seedOpp(null);
    const res = await postUniverseDraft(opp);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { source: string } }).data.source).toBe("synthesis");
    expect(draftAuditsOf(opp)).toBe(0);
  });
});

describe("POST /api/greenfield/[oppId]/investment-simulation — brownfield carriers are refused server-side", () => {
  test("brownfield decision -> 409 not_applicable_track, no run stored", async () => {
    const opp = seedOpp("brownfield");
    seedS5Plan(opp);
    const res = await postSimulation(opp);
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("not_applicable_track");
    expect(runsCount(opp)).toBe(0);
  });

  test("no route decision yet (legacy drafting) -> unchanged: run executes and stores", async () => {
    const opp = seedOpp(null);
    seedS5Plan(opp);
    const res = await postSimulation(opp);
    expect(res.status).toBe(201);
    expect(runsCount(opp)).toBe(1);
  });
});

describe("PUT /api/projects/[id]/capability-dd — brownfield-only via resolveTrack", () => {
  const putVerdict = (projectId: string) =>
    nextRequest(`/api/projects/${projectId}/capability-dd`, { method: "PUT", headers: { cookie }, body: JSON.stringify({ row_id: "cap-1", coverage: "resolved", note: "대상이 보유" }) });
  const verdictsJson = (oppId: string) =>
    (db.query("SELECT capability_dd_verdicts_json AS j FROM opportunity WHERE id = ?").get(oppId) as { j: string | null }).j;

  test("greenfield-classified project -> 409 not_applicable_track with nothing stored; GET stays open", async () => {
    const { projectId, oppId } = seedProject("greenfield");
    const res = await putVerdict(projectId);
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("not_applicable_track");
    expect(verdictsJson(oppId)).toBeNull();
    // Read-only evidence stays reachable — the guard is PUT-only.
    const getRes = await nextRequest(`/api/projects/${projectId}/capability-dd`, { headers: { cookie } });
    expect(getRes.status).toBe(200);
  });

  test("unresolved track (no signal) -> 409 not_applicable_track", async () => {
    const { projectId } = seedProject(null);
    const res = await putVerdict(projectId);
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("not_applicable_track");
  });

  test("brownfield project -> unchanged: verdict recorded, pending drops to 0", async () => {
    const { projectId, oppId } = seedProject("brownfield");
    const res = await putVerdict(projectId);
    expect(res.status).toBe(201);
    expect(verdictsJson(oppId)).toContain("cap-1");
    const getRes = await nextRequest(`/api/projects/${projectId}/capability-dd`, { headers: { cookie } });
    expect(((await getRes.json()) as { data: { pending: number } }).data.pending).toBe(0);
  });
});

describe("post-promotion Short List freeze (T-20261022-039)", () => {
  /** Simulate promotion: a real md_project row (opportunity.project_id is an FK). */
  function promote(oppId: string): string {
    const pid = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at, source_opportunity_id, track, origin) VALUES (?,?,?,?,?,?)", [pid, `BF-${pid.slice(-8)}`, NOW, oppId, "brownfield", null]);
    db.run("UPDATE opportunity SET project_id = ? WHERE id = ?", [pid, oppId]);
    return pid;
  }

  test("targets POST on a promoted carrier -> 409 already_promoted, nothing stored", async () => {
    const opp = seedOpp("brownfield");
    promote(opp);
    const res = await postTarget(opp);
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("already_promoted");
    expect(targetsCount(opp)).toBe(0);
  });

  test("shortlist POST on a promoted carrier -> 409 already_promoted", async () => {
    const opp = seedOpp("brownfield");
    const created = await postTarget(opp);
    expect(created.status).toBe(201);
    const targetId = ((await created.json()) as { data: { id: string } }).data.id;
    promote(opp);
    const res = await nextRequest(`/api/brownfield/${opp}/targets/${targetId}/shortlist`, { method: "POST", headers: { cookie }, body: JSON.stringify({}) });
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("already_promoted");
  });

  test("unpromoted carrier still reaches the normal shortlist conditions (guard placement)", async () => {
    // The promotion guard must sit before the eval computation but must not
    // itself block the pre-promotion path — without eval items the route's own
    // eval_pending branch fires, never already_promoted.
    const opp = seedOpp("brownfield");
    const created = await postTarget(opp);
    expect(created.status).toBe(201);
    const targetId = ((await created.json()) as { data: { id: string } }).data.id;
    const res = await nextRequest(`/api/brownfield/${opp}/targets/${targetId}/shortlist`, { method: "POST", headers: { cookie }, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(await errCode(res)).toBe("eval_pending");
  });
});
