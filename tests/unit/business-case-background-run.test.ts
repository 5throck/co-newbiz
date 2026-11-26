// @version 1.0.0
// S8 business-case generation runs in the BACKGROUND (202 + poll) on the process_run/activity_run model:
//   - POST answers 202 {runId} immediately, even while the chain is still busy (stubbed blocking generator)
//   - a run already in progress answers 409 already_running with its runId (also for regenerate:true)
//   - GET .../generate returns the latest run (null when none) with per-activity progress, so a reloaded
//     page can resume; the real chain exposes waiting/running/done activities while it runs
//   - a failure inside the run is recorded on the run (not an HTTP error) and does not block a retry
//   - an orphaned 'running' run (previous server process) is failed by the stale sweep
//   - alreadyRun / regenerate semantics are unchanged
import { test, expect, beforeAll, afterAll, describe, afterEach } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case-background-run.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { businessCaseGenerationIdle, setBusinessCaseRunTestHooks, S8_GENERATION_STAGE } = await import(
  "../../app/web-next/lib/business-case-run.ts"
);
const { finishProcessRun } = await import("../../app/web-next/lib/agent-orchestrator.ts");

const NOW = new Date().toISOString();
const ANALYST = "bgrun-analyst";
const VIEWER = "bgrun-viewer";
const OUTSIDER = "bgrun-outsider";
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const GEN = () => `/api/projects/${projectId}/business-case/generate`;
function post(body: unknown = {}, cookie = analystCookie) {
  return req(GEN(), { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
}
async function latest(cookie = analystCookie) {
  const res = await req(GEN(), { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()).data as { run: RunView | null }).run;
}
interface RunView {
  runId: string;
  status: string;
  error: string | null;
  failed_activity: string | null;
  activities: Array<{ activityId: string; status: string; started_at: string | null; error: string | null }>;
  progress: { total: number; done: number; running: number; failed: number };
}
function clearRuns() {
  db.run("DELETE FROM agent_run WHERE process_run_id IN (SELECT id FROM process_run WHERE stage = ?)", [
    S8_GENERATION_STAGE,
  ]);
  db.run("DELETE FROM activity_run WHERE process_run_id IN (SELECT id FROM process_run WHERE stage = ?)", [
    S8_GENERATION_STAGE,
  ]);
  db.run("DELETE FROM process_run WHERE stage = ?", [S8_GENERATION_STAGE]);
}

beforeAll(async () => {
  await createUser(db, {
    userId: ANALYST,
    role: "analyst",
    password: "pw-bgrun-analyst-1",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-bgrun-viewer-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  await createUser(db, {
    userId: OUTSIDER,
    role: "analyst",
    password: "pw-bgrun-outsider-1",
    createdBy: "test",
    now: NOW,
  });
  approveUser(db, { userId: OUTSIDER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-bgrun-analyst-1");
  viewerCookie = await loginCookie(VIEWER, "pw-bgrun-viewer-1");
  outsiderCookie = await loginCookie(OUTSIDER, "pw-bgrun-outsider-1");

  const oppId = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    oppId,
    "S8 background run",
    "test industry",
    "selected",
    ANALYST,
    NOW,
  ]);
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
    [ulid(), oppId, "greenfield", "test route", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, "direct entry", "M&A considered", "test", ANALYST, NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [
    JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }),
    oppId,
  ]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW],
    );
  }
  projectId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "S8 bg-run test" }).project.id;
});

afterEach(async () => {
  setBusinessCaseRunTestHooks({});
  await businessCaseGenerationIdle();
  clearRuns();
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("S8 background generation (202 + poll)", () => {
  test("POST answers 202 immediately while the generator is still busy; 409 for a second start", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: { opts: { processRunId: string; yieldBetweenActivities?: boolean } | null } = { opts: null };
    setBusinessCaseRunTestHooks({
      generate: async (_pid, opts) => {
        seen.opts = opts;
        await gate; // the "slow" generator — the request must not wait for it
        finishProcessRun(opts.processRunId, "done");
      },
    });

    const t0 = Date.now();
    const res = await post();
    expect(res.status).toBe(202);
    expect(Date.now() - t0).toBeLessThan(2000);
    const data = (await res.json()).data as { runId: string; status: string };
    expect(data.status).toBe("running");

    // The run row exists and is in progress; the latest lookup finds it.
    const run = await latest();
    expect(run?.runId).toBe(data.runId);
    expect(run?.status).toBe("running");

    // A second press — plain or regenerate — is refused with the in-flight run's id.
    for (const body of [{}, { regenerate: true }]) {
      const again = await post(body);
      expect(again.status).toBe(409);
      const err = (await again.json()).error as { code: string; details: { runId: string } };
      expect(err.code).toBe("already_running");
      expect(err.details.runId).toBe(data.runId);
    }
    expect(
      (db.query("SELECT COUNT(*) AS c FROM process_run WHERE stage = ?").get(S8_GENERATION_STAGE) as { c: number }).c,
    ).toBe(1);

    release();
    await businessCaseGenerationIdle();
    expect(seen.opts?.processRunId).toBe(data.runId);
    expect(seen.opts?.yieldBetweenActivities).toBe(true);
    expect((await latest())?.status).toBe("done");
  });

  test("latest lookup: null without runs; deny-by-default (outsider 404, viewer 403 on start)", async () => {
    expect(await latest()).toBeNull();
    // Non-member: 404 on the latest lookup, like every business-case route.
    const outsider = await req(GEN(), { headers: { cookie: outsiderCookie } });
    expect(outsider.status).toBe(404);
    // Viewer role cannot start (403 precedes visibility, like every analyst+ route).
    expect((await post({}, viewerCookie)).status).toBe(403);
  });

  test("a failure inside the run is recorded on the run and does not block a retry", async () => {
    setBusinessCaseRunTestHooks({
      generate: async () => {
        throw new Error("boom: brownfield project has no shortlisted target");
      },
    });
    const res = await post();
    expect(res.status).toBe(202);
    const { runId } = (await res.json()).data as { runId: string };
    await businessCaseGenerationIdle();

    const run = await latest();
    expect(run?.runId).toBe(runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("boom");

    const status = await req(`${GEN()}/${runId}`, { headers: { cookie: analystCookie } });
    expect(status.status).toBe(200);
    expect(((await status.json()).data as RunView).error).toContain("boom");

    // A FAILED run does not trigger the already-run guard or the running guard.
    setBusinessCaseRunTestHooks({ generate: async (_p, o) => finishProcessRun(o.processRunId, "done") });
    expect((await post()).status).toBe(202);
  });

  test("real chain: progress is observable mid-run (waiting/running/done), ends done with 12/12", async () => {
    const res = await post();
    expect(res.status).toBe(202);
    const { runId } = (await res.json()).data as { runId: string };

    const seenRunning: Array<{ total: number; done: number; statuses: Set<string> }> = [];
    for (let i = 0; i < 400; i++) {
      const run = await latest();
      if (run?.status !== "running") break;
      seenRunning.push({
        total: run.progress.total,
        done: run.progress.done,
        statuses: new Set(run.activities.map((a) => a.status)),
      });
      await new Promise((r) => setTimeout(r, 0));
    }
    await businessCaseGenerationIdle();

    // While the run was in progress the status route answered with the planned list (not just finished rows).
    expect(seenRunning.some((s) => s.total === 12)).toBe(true);
    expect(seenRunning.some((s) => s.statuses.has("waiting") || s.statuses.has("running"))).toBe(true);

    const final = await latest();
    expect(final?.runId).toBe(runId);
    expect(final?.status).toBe("done");
    expect(final?.progress).toEqual({ total: 12, done: 12, running: 0, failed: 0 });
    expect(final?.activities.every((a) => a.status === "done" && a.started_at)).toBe(true);
    expect(final?.activities[0]?.activityId).toBe("base:market_forward:growth_projection");
  });

  test("a failed activity is named on the run; the chain stops and later steps read as skipped", async () => {
    const { setBusinessCaseExecutorFactory } = await import("../../app/web-next/lib/business-case-generator.ts");
    const { defaultExecutor } = await import("../../app/web-next/lib/business-case-generator.ts");
    process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "llm";
    let calls = 0;
    setBusinessCaseExecutorFactory(() => {
      const inner = defaultExecutor();
      return async (step, ctx) => {
        calls++;
        if (calls === 3) throw new Error("model call timed out");
        return inner(step, ctx);
      };
    });
    try {
      expect((await post()).status).toBe(202);
      await businessCaseGenerationIdle();
      const run = await latest();
      expect(run?.status).toBe("failed");
      expect(run?.failed_activity).toBe("base:market_forward:distributional_valuation");
      expect(run?.error).toContain("model call timed out");
      const failed = run?.activities.find((a) => a.status === "failed");
      expect(failed?.activityId).toBe(run?.failed_activity ?? "");
      expect(failed?.error).toContain("model call timed out");
      expect(run?.progress.done).toBe(2);
      expect(run?.progress.failed).toBe(1);
      expect(run?.activities.filter((a) => a.status === "skipped").length).toBe(9);
    } finally {
      setBusinessCaseExecutorFactory(null);
      process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";
    }
  });

  test("an orphaned 'running' run (previous server process) is failed by the sweep, unblocking the project", async () => {
    const orphanId = ulid();
    const old = "2000-01-01T00:00:00.000Z";
    db.run(
      `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [orphanId, "project", projectId, projectId, "test", S8_GENERATION_STAGE, "running", "web", ANALYST, old],
    );
    db.run(
      "INSERT INTO activity_run (id, process_run_id, activity_id, status, source, started_at) VALUES (?,?,?,?,?,?)",
      [ulid(), orphanId, "base:market_forward:growth_projection", "running", "web", old],
    );
    db.run(
      "INSERT INTO agent_run (id, process_run_id, activity_id, agent_key, status, source, started_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), orphanId, "base:market_forward:growth_projection", "financial-analyst", "running", "agent", old],
    );

    const run = await latest();
    expect(run?.runId).toBe(orphanId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("timeout_or_crash");
    expect(run?.failed_activity).toBe("base:market_forward:growth_projection");
    expect(run?.activities[0]?.status).toBe("failed");

    // Not "running forever": a new generation can start.
    setBusinessCaseRunTestHooks({ generate: async (_p, o) => finishProcessRun(o.processRunId, "done") });
    expect((await post()).status).toBe(202);
  });

  test("alreadyRun / regenerate semantics are unchanged", async () => {
    setBusinessCaseRunTestHooks({ generate: async (_p, o) => finishProcessRun(o.processRunId, "done") });
    const first = await post();
    expect(first.status).toBe(202);
    const { runId } = (await first.json()).data as { runId: string };
    await businessCaseGenerationIdle();

    const second = await post();
    expect(second.status).toBe(200);
    expect((await second.json()).data).toEqual({ runId, alreadyRun: true });

    const regenerate = await post({ regenerate: true });
    expect(regenerate.status).toBe(202);
    expect(((await regenerate.json()).data as { runId: string }).runId).not.toBe(runId);
  });
});
