import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

// ADR-0152 (Wave F PR F-1) — typed, precondition-enforced closure.
const TEST_DB_PATH = "db/data/test-closure.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { closeEntity, ClosureError, getClosurePreconditions } = await import(
  "../../db/repositories/closure.repository.ts"
);
import type { ClosureErrorCode } from "../../db/repositories/closure.repository.ts";
const { closeProject, ProjectLifecycleError } = await import("../../db/repositories/project.repository.ts");
const { maybeReopenStaleS12, advancePipeline } = await import("../../app/web-next/lib/pipeline.ts");
const { AGENT_KEYS } = await import("../../app/web-next/lib/agent-registry.generated.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = new Date().toISOString();
const OLD = "2026-09-01T00:00:00.000Z"; // before migration 0123 / ADR-0151
const HUMAN = "human-closer";
const AGENT = "brownfield-agent";
let industryId = "";
let companyId = "";
let leadCookie = "";
let agentCookie = "";

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

function newProject(withRun = true): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `PRJ-${id.slice(-6)}`, NOW]);
  if (withRun) newRun("project", id, "running", "S9");
  return id;
}
function newOpp(): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [
    id,
    `opp-${id.slice(-5)}`,
    "assessed",
    "test",
    NOW,
  ]);
  newRun("opportunity", id, "running", "S2");
  return id;
}
function newRun(entityType: string, entityId: string, status: string, stage: string): string {
  const id = ulid();
  db.run(
    "INSERT INTO pipeline_run (id, entity_type, entity_id, industry_id, initiating_company_id, status, current_stage, started_by, started_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, entityType, entityId, industryId, companyId, status, stage, "test", NOW, NOW],
  );
  return id;
}
function gate(
  entityType: string,
  entityId: string,
  g: string,
  decision: string,
  opts: { by?: string; at?: string; learning?: string | null } = {},
): string {
  const id = ulid();
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at, learning_capture) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, entityType, entityId, g, decision, "r", opts.by ?? HUMAN, opts.at ?? NOW, opts.learning ?? null],
  );
  return id;
}
function transition(
  projectId: string,
  decision: string,
  cols: { handoff?: string; divest?: string; learning?: string; at?: string } = {},
): string {
  const runId = ulid();
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    runId,
    projectId,
    "t",
    "h",
    "test",
    NOW,
  ]);
  const id = ulid();
  db.run(
    `INSERT INTO venture_transition_decision (id, run_id, project_id, review_cycle, decision, decided_by, decided_at, rationale, learning_capture, core_handoff, divest_plan, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      runId,
      projectId,
      "2026-Q4",
      decision,
      "venture-portfolio-ic",
      cols.at ?? NOW,
      "rationale",
      cols.learning ?? null,
      cols.handoff ?? null,
      cols.divest ?? null,
      NOW,
    ],
  );
  return id;
}
const close = (
  over: Partial<Parameters<typeof closeEntity>[0]> & {
    entityId: string;
    closureType: Parameters<typeof closeEntity>[0]["closureType"];
  },
) =>
  closeEntity({
    entityType: "project",
    closureReason: "closing reason that is long enough",
    learningCapture: "a lesson",
    closedBy: HUMAN,
    agentIds: AGENT_KEYS,
    db,
    ...over,
  });
const runStatus = (entityType: string, entityId: string) =>
  (
    db
      .query("SELECT status FROM pipeline_run WHERE entity_type = ? AND entity_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(entityType, entityId) as { status: string }
  ).status;
function expectClosureError(fn: () => unknown, code: ClosureErrorCode, missing?: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ClosureError);
    expect((e as InstanceType<typeof ClosureError>).code).toBe(code);
    if (missing) expect((e as InstanceType<typeof ClosureError>).missing).toContain(missing);
    return;
  }
  throw new Error(`expected ClosureError(${code})`);
}

beforeAll(async () => {
  industryId = ulid();
  companyId = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    industryId,
    "99999",
    "테스트 산업",
    "Test Ind",
    NOW,
  ]);
  db.run("INSERT INTO md_company (id, name_ko, name_en, created_at) VALUES (?,?,?,?)", [
    companyId,
    "테스트 계열사",
    "Test Co",
    NOW,
  ]);
  for (const u of ["lead-cl", AGENT]) {
    await createUser(db, { userId: u, role: "analyst", password: `pw-${u}-12345`, createdBy: "test", now: NOW });
    approveUser(db, { userId: u, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  leadCookie = await loginCookie("lead-cl", "pw-lead-cl-12345");
  agentCookie = await loginCookie(AGENT, `pw-${AGENT}-12345`);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("migrations 0122/0123", () => {
  test("pipeline_run accepts killed and withdrawn; closure_record allows one active row per entity", () => {
    const p = newProject();
    db.run("UPDATE pipeline_run SET status = 'withdrawn' WHERE entity_id = ?", [p]);
    db.run("UPDATE pipeline_run SET status = 'killed' WHERE entity_id = ?", [p]);
    expect(() => db.run("UPDATE pipeline_run SET status = 'bogus' WHERE entity_id = ?", [p])).toThrow();
    const ins = () =>
      db.run(
        "INSERT INTO closure_record (id, entity_type, entity_id, closure_type, basis_table, closure_reason, closed_by, closed_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), "project", p, "withdrawn", "none", "x", HUMAN, NOW],
      );
    ins();
    expect(ins).toThrow();
    db.run("UPDATE closure_record SET reopened_at = ? WHERE entity_id = ?", [NOW, p]);
    ins(); // allowed after reopen
  });
});

describe("killed_at_gate", () => {
  test("allowed with a human KILL carrying learning; run -> killed", () => {
    const p = newProject();
    gate("project", p, "dd", "kill", { learning: "supplier risk underestimated" });
    const r = close({ entityId: p, closureType: "killed_at_gate", learningCapture: undefined });
    expect(r.basis_table).toBe("gate_decision");
    expect(r.learning_capture).toBe("supplier risk underestimated");
    expect(runStatus("project", p)).toBe("killed");
    const row = db.query("SELECT status, closure_type FROM md_project WHERE id = ?").get(p) as {
      status: string;
      closure_type: string;
    };
    expect(row).toEqual({ status: "closed", closure_type: "killed_at_gate" });
  });
  test("refused without a kill decision, naming the missing record", () => {
    const p = newProject();
    gate("project", p, "dd", "go");
    expectClosureError(
      () => close({ entityId: p, closureType: "killed_at_gate" }),
      "precondition_failed",
      "gate_decision(kill)",
    );
  });
  test("refused when the KILL has no learning capture (post-0123) and when an agent recorded it", () => {
    const a = newProject();
    gate("project", a, "dd", "kill", { learning: null });
    expectClosureError(
      () => close({ entityId: a, closureType: "killed_at_gate" }),
      "precondition_failed",
      "gate_decision.learning_capture",
    );
    const b = newProject();
    gate("project", b, "dd", "kill", { learning: "x", by: AGENT });
    expectClosureError(
      () => close({ entityId: b, closureType: "killed_at_gate" }),
      "precondition_failed",
      "gate_decision.decided_by",
    );
  });
  test("a later GO on the same gate supersedes the KILL", () => {
    const p = newProject();
    gate("project", p, "dd", "kill", { learning: "x", at: "2026-10-09T00:00:00.000Z" });
    gate("project", p, "dd", "go", { at: "2026-10-10T00:00:00.000Z" });
    expectClosureError(
      () => close({ entityId: p, closureType: "killed_at_gate" }),
      "precondition_failed",
      "gate_decision(kill)",
    );
  });
  test("grandfathered: a pre-0123 KILL without learning still closes", () => {
    const p = newProject();
    gate("project", p, "dd", "kill", { learning: null, at: OLD });
    const r = close({ entityId: p, closureType: "killed_at_gate", learningCapture: undefined });
    expect(r.learning_capture).toBeNull();
    expect(runStatus("project", p)).toBe("killed");
  });
});

describe("withdrawn", () => {
  test("allowed with a >=20 char reason and learning; run -> withdrawn", () => {
    const p = newProject();
    close({ entityId: p, closureType: "withdrawn" });
    expect(runStatus("project", p)).toBe("withdrawn");
  });
  test("refused: short reason, missing learning, pending HOLD awaiting committee", () => {
    const p = newProject();
    expectClosureError(
      () => close({ entityId: p, closureType: "withdrawn", closureReason: "too short" }),
      "invalid_input",
    );
    expectClosureError(() => close({ entityId: p, closureType: "withdrawn", learningCapture: "" }), "invalid_input");
    gate("project", p, "dd", "hold", { at: "2026-10-09T00:00:00.000Z" });
    const pr = ulid();
    db.run(
      "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [pr, "project", p, p, "v", "S9", "done", "web", "t", NOW],
    );
    db.run(
      "INSERT INTO gate_evaluation (id, process_run_id, gate, criteria_json, recommendation, evaluated_by, created_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), pr, "dd", "{}", "go", "t", "2026-10-11T00:00:00.000Z"],
    );
    expectClosureError(
      () => close({ entityId: p, closureType: "withdrawn" }),
      "precondition_failed",
      "gate_decision(hold)",
    );
  });
});

describe("graduated_to_core / divested / killed_with_learning", () => {
  test("graduated_to_core: allowed with core_handoff (run completed); refused without it or on the wrong decision", () => {
    const p = newProject();
    transition(p, "graduate_to_core", { handoff: "handoff plan" });
    close({ entityId: p, closureType: "graduated_to_core" });
    expect(runStatus("project", p)).toBe("completed");
    const q = newProject();
    transition(q, "graduate_to_core");
    expectClosureError(
      () => close({ entityId: q, closureType: "graduated_to_core" }),
      "precondition_failed",
      "venture_transition_decision.core_handoff",
    );
    const w = newProject();
    transition(w, "reduce_or_divest", { divest: "plan" });
    expectClosureError(
      () => close({ entityId: w, closureType: "graduated_to_core" }),
      "precondition_failed",
      "venture_transition_decision(graduate_to_core)",
    );
  });
  test("graduated_to_core: a pre-ADR-0151 rationale-only row is grandfathered", () => {
    const p = newProject();
    transition(p, "graduate_to_core", { at: OLD });
    close({ entityId: p, closureType: "graduated_to_core", learningCapture: undefined });
    expect(runStatus("project", p)).toBe("completed");
  });
  test("divested: allowed with divest_plan; refused without", () => {
    const p = newProject();
    transition(p, "reduce_or_divest", { divest: "sell in 2027" });
    close({ entityId: p, closureType: "divested" });
    expect(runStatus("project", p)).toBe("completed");
    const q = newProject();
    transition(q, "reduce_or_divest");
    expectClosureError(
      () => close({ entityId: q, closureType: "divested" }),
      "precondition_failed",
      "venture_transition_decision.divest_plan",
    );
  });
  test("killed_with_learning: allowed with learning on the transition (run killed); refused without", () => {
    const p = newProject();
    transition(p, "kill_with_learning_captured", { learning: "market never formed" });
    const r = close({ entityId: p, closureType: "killed_with_learning", learningCapture: undefined });
    expect(r.learning_capture).toBe("market never formed");
    expect(runStatus("project", p)).toBe("killed");
    const q = newProject();
    transition(q, "kill_with_learning_captured");
    expectClosureError(
      () => close({ entityId: q, closureType: "killed_with_learning" }),
      "precondition_failed",
      "venture_transition_decision.learning_capture",
    );
  });
});

describe("opportunity closure (dropped / withdrawn / killed_at_gate)", () => {
  test("dropped: allowed at S1-S3 with reason + learning; opportunity status dropped, run withdrawn", () => {
    const o = newOpp();
    closeEntity({
      entityType: "opportunity",
      entityId: o,
      closureType: "dropped",
      closureReason: "no demand signal",
      learningCapture: "lesson",
      closedBy: HUMAN,
      agentIds: AGENT_KEYS,
      db,
    });
    const row = db.query("SELECT status, decided_by FROM opportunity WHERE id = ?").get(o) as {
      status: string;
      decided_by: string;
    };
    expect(row).toEqual({ status: "dropped", decided_by: HUMAN });
    expect(runStatus("opportunity", o)).toBe("withdrawn");
  });
  test("dropped: refused once a gate decision exists, without learning, and for projects", () => {
    const o = newOpp();
    gate("opportunity", o, "screening", "go");
    expectClosureError(
      () =>
        closeEntity({
          entityType: "opportunity",
          entityId: o,
          closureType: "dropped",
          closureReason: "r",
          learningCapture: "l",
          closedBy: HUMAN,
          db,
        }),
      "precondition_failed",
      "gate_decision(none)",
    );
    const o2 = newOpp();
    expectClosureError(
      () =>
        closeEntity({
          entityType: "opportunity",
          entityId: o2,
          closureType: "dropped",
          closureReason: "r",
          closedBy: HUMAN,
          db,
        }),
      "invalid_input",
    );
    expectClosureError(() => close({ entityId: newProject(), closureType: "dropped" }), "invalid_type_for_entity");
  });
  test("killed_at_gate on an opportunity; a promoted opportunity must close via its project", () => {
    const o = newOpp();
    gate("opportunity", o, "screening", "kill", { learning: "screen failed" });
    closeEntity({
      entityType: "opportunity",
      entityId: o,
      closureType: "killed_at_gate",
      closureReason: "killed at screening",
      closedBy: HUMAN,
      agentIds: AGENT_KEYS,
      db,
    });
    expect(runStatus("opportunity", o)).toBe("killed");
    const o2 = newOpp();
    const p = newProject();
    db.run("UPDATE opportunity SET project_id = ? WHERE id = ?", [p, o2]);
    expectClosureError(
      () =>
        closeEntity({
          entityType: "opportunity",
          entityId: o2,
          closureType: "withdrawn",
          closureReason: "withdrawing a promoted deal",
          learningCapture: "l",
          closedBy: HUMAN,
          db,
        }),
      "invalid_state",
    );
  });
});

describe("guards", () => {
  test("already_closed on a second close, and for a legacy (untyped) closed project", () => {
    const p = newProject();
    close({ entityId: p, closureType: "withdrawn" });
    expectClosureError(() => close({ entityId: p, closureType: "withdrawn" }), "already_closed");
    const legacy = newProject();
    db.run("UPDATE md_project SET status = 'closed', closed_at = ?, closure_reason = 'old' WHERE id = ?", [
      OLD,
      legacy,
    ]);
    expect(
      (db.query("SELECT closure_type FROM md_project WHERE id = ?").get(legacy) as { closure_type: string | null })
        .closure_type,
    ).toBeNull();
    expectClosureError(() => close({ entityId: legacy, closureType: "withdrawn" }), "already_closed");
  });
  test("agent identities cannot close (repository)", () => {
    const p = newProject();
    expectClosureError(() => close({ entityId: p, closureType: "withdrawn", closedBy: AGENT }), "agent_forbidden");
    expect((db.query("SELECT status FROM md_project WHERE id = ?").get(p) as { status: string }).status).toBe("open");
  });
  test("closeProject wrapper: closureType required; archive requires a prior close", () => {
    const p = newProject();
    expect(() => closeProject(p, { closureReason: "r", closedBy: HUMAN })).toThrow(ProjectLifecycleError);
    expect(() => closeProject(p, { status: "archived", closureReason: "r", closedBy: HUMAN })).toThrow(
      ProjectLifecycleError,
    );
    closeProject(p, {
      closureType: "withdrawn",
      closureReason: "wrapper close long enough",
      learningCapture: "l",
      closedBy: HUMAN,
    });
    const archived = closeProject(p, { status: "archived", closureReason: "retain", closedBy: HUMAN });
    expect(archived.status).toBe("archived");
    expect(archived.closure_type).toBe("withdrawn");
  });
  test("preconditions map covers exactly the entity's valid types", () => {
    const p = newProject();
    gate("project", p, "dd", "kill", { learning: "x" });
    const pre = getClosurePreconditions("project", p, { agentIds: AGENT_KEYS, db });
    expect(Object.keys(pre).sort()).toEqual([
      "divested",
      "graduated_to_core",
      "killed_at_gate",
      "killed_with_learning",
      "withdrawn",
    ]);
    expect(pre.killed_at_gate.satisfied).toBe(true);
    expect(pre.graduated_to_core.satisfied).toBe(false);
    expect(Object.keys(getClosurePreconditions("opportunity", newOpp(), { db })).sort()).toEqual([
      "dropped",
      "killed_at_gate",
      "withdrawn",
    ]);
  });
});

describe("S12 stale flip", () => {
  test("an open project's completed S12 run reopens when the S12 predicate is incomplete", () => {
    const p = newProject(false);
    const runId = newRun("project", p, "completed", "S12");
    const run = db.query("SELECT * FROM pipeline_run WHERE id = ?").get(runId) as Parameters<
      typeof maybeReopenStaleS12
    >[0];
    const out = maybeReopenStaleS12(run, () => ({ currentStage: "S12" }));
    expect(out.status).toBe("running");
    expect(out.current_stage).toBe("S12");
  });
  test("a closed project is never reopened by staleness; a still-complete run is untouched", async () => {
    const p = newProject(false);
    const runId = newRun("project", p, "completed", "S12");
    const run = db.query("SELECT * FROM pipeline_run WHERE id = ?").get(runId) as Parameters<
      typeof maybeReopenStaleS12
    >[0];
    expect(maybeReopenStaleS12(run, () => ({ currentStage: null })).status).toBe("completed");
    db.run("UPDATE md_project SET status = 'closed' WHERE id = ?", [p]);
    expect(maybeReopenStaleS12(run, () => ({ currentStage: "S12" })).status).toBe("completed");
    expect((await advancePipeline(runId)).run.status).toBe("completed");
  });
});

describe("HTTP routes", () => {
  let pid = "";
  beforeAll(() => {
    pid = newProject();
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [pid, "lead-cl", "lead", "test", NOW, "test"],
    );
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [pid, AGENT, "lead", "test", NOW, "test"],
    );
  });
  const post = (cookie: string, body: unknown) =>
    nextRequest(`/api/projects/${pid}/close`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });

  test("gate KILL without learning_capture returns 422; with it, 201 and persisted (project + opportunity)", async () => {
    const noLearn = await nextRequest(`/api/projects/${pid}/gate-decisions`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ gate: "dd", decision: "kill", rationale: "r" }),
    });
    expect(noLearn.status).toBe(422);
    const ok = await nextRequest(`/api/projects/${pid}/gate-decisions`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ gate: "dd", decision: "kill", rationale: "r", learning_capture: "lesson" }),
    });
    expect(ok.status).toBe(201);
    expect(
      (
        db.query("SELECT learning_capture FROM gate_decision WHERE entity_id = ? AND decision = 'kill'").get(pid) as {
          learning_capture: string;
        }
      ).learning_capture,
    ).toBe("lesson");
    const o = newOpp();
    const oppNo = await nextRequest(`/api/opportunities/${o}/gate-decisions`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ gate: "screening", decision: "kill", rationale: "r" }),
    });
    expect(oppNo.status).toBe(422);
    const oppOk = await nextRequest(`/api/opportunities/${o}/gate-decisions`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ gate: "screening", decision: "kill", rationale: "r", learning_capture: "l" }),
    });
    expect(oppOk.status).toBe(201);
  });

  test("GET preconditions lists every type; POST close with a missing basis returns 409 naming the record", async () => {
    const pre = await nextRequest(`/api/projects/${pid}/close/preconditions`, { headers: { cookie: leadCookie } });
    expect(pre.status).toBe(200);
    const data = ((await pre.json()) as { data: Record<string, { satisfied: boolean }> }).data;
    expect(data.killed_at_gate.satisfied).toBe(true);
    expect(data.graduated_to_core.satisfied).toBe(false);
    const res = await post(leadCookie, { closureType: "graduated_to_core", closureReason: "graduating" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "venture_transition_decision(graduate_to_core)",
    );
  });

  test("an agent identity is rejected with 403 even as project lead", async () => {
    const res = await post(agentCookie, { closureType: "killed_at_gate", closureReason: "agent attempt" });
    expect(res.status).toBe(403);
    expect((db.query("SELECT status FROM md_project WHERE id = ?").get(pid) as { status: string }).status).toBe("open");
  });

  test("validation: unknown type 400; lead-only 403 for non-members; success records closure", async () => {
    expect((await post(leadCookie, { closureType: "bogus", closureReason: "r" })).status).toBe(400);
    const ok = await post(leadCookie, { closureType: "killed_at_gate", closureReason: "killed at dd by committee" });
    expect(ok.status).toBe(200);
    expect(runStatus("project", pid)).toBe("killed");
    expect((await post(leadCookie, { closureType: "killed_at_gate", closureReason: "again" })).status).toBe(409);
  });

  test("opportunity close route + bare dropped PUT refused", async () => {
    const o = newOpp();
    const put = await nextRequest(`/api/opportunities/${o}`, {
      method: "PUT",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ status: "dropped" }),
    });
    expect(put.status).toBe(409);
    const res = await nextRequest(`/api/opportunities/${o}/close`, {
      method: "POST",
      headers: { cookie: leadCookie },
      body: JSON.stringify({ closureType: "dropped", closureReason: "no demand", learningCapture: "lesson" }),
    });
    expect(res.status).toBe(200);
    expect((db.query("SELECT status FROM opportunity WHERE id = ?").get(o) as { status: string }).status).toBe(
      "dropped",
    );
    const agent = await nextRequest(`/api/opportunities/${newOpp()}/close`, {
      method: "POST",
      headers: { cookie: agentCookie },
      body: JSON.stringify({ closureType: "dropped", closureReason: "r", learningCapture: "l" }),
    });
    expect(agent.status).toBe(403);
  });
});
