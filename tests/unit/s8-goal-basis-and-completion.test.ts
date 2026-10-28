// @version 1.0.0
/**
 * Monte Carlo verification follow-ups D4 + D5 (owner decision 2026-10-28):
 *
 *  D4  goal attainment is judged on the case the person ADOPTED (its own scenario p50), falling back
 *      to the base case before any adoption - never the engine-recommended scenario (max p05, usually
 *      upside). /target-check and /s8-lens-summary must therefore agree on the same adopted case.
 *  D5  Green Field S8 completion keys on the ADOPTED case, or the BASE scenario model when none is
 *      adopted - not on "the latest created model" (the downside, whose BEP can legitimately be null).
 *      A project the old rule already completed stays complete.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s8-goal-basis.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
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
const { listBusinessCases, goalJudgedCase } = await import("../../app/web-next/lib/business-case.ts");
const { buildS8LensSummary } = await import("../../app/web-next/lib/s8-lens-summary.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { blocker } = await import("../../app/web-next/lib/process-blocker-keys.ts");

const NOW = "2026-10-28T09:00:00.000Z";
const ANALYST = "goalbasis-analyst";
let cookie = "";

function seedProject(name: string): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, name, "테스트 산업", "selected", ANALYST, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), opp, "greenfield", "test route", ANALYST, NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ulid(), opp, "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), opp]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", opp, gate, "go", "test", ANALYST, NOW]);
  }
  return promoteOpportunity(opp, { promotedBy: ANALYST, needToKnowBasis: "goal basis test" }).project.id;
}

/** One scenario case: p05/p50/p95 rows (BEP on p50 only, as the generator writes). */
function seedCase(projectId: string, scenario: "base" | "upside" | "downside", createdAt: string, opts: { npv: number; p05?: number; bep?: number | null }): string {
  const id = ulid();
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
    [id, projectId, "valuation", `Case ${scenario}`, 5, "business-case-generator", createdAt, "{}"],
  );
  db.run("INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [ulid(), id, "revenue", "매출", 10000, 1, 0, ANALYST, createdAt]);
  for (const [percentile, npv, bep] of [["p05", opts.p05 ?? opts.npv - 1000, null], ["p50", opts.npv, opts.bep ?? null], ["p95", opts.npv + 1000, null]] as const) {
    db.run(
      "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, bep_year, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [ulid(), projectId, id, scenario, percentile, npv, 0.12, bep, "seed=1", createdAt],
    );
  }
  return id;
}

const goal = (projectId: string, metric: string, target: number) =>
  db.run(
    "INSERT INTO project_business_goal (id, project_id, metric_key, direction, target_value, rationale, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), projectId, metric, "gte", target, "근거", ANALYST, NOW],
  );
const adopt = (projectId: string, modelId: string) =>
  nextRequest(`/api/projects/${projectId}/business-case/adopt`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ model_id: modelId }) });
const targetCheck = async (projectId: string) =>
  ((await (await nextRequest(`/api/projects/${projectId}/target-check`, { headers: { cookie } })).json()).data) as {
    judged_case_id: string | null; judged_basis: string | null; entries: Array<{ metric_key: string; status: string; actual: number | null; actual_basis: string }>;
  };

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: "pw-analyst-12345" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("D4: goals are judged on the adopted case's own scenario (base before adoption)", () => {
  test("adopt BASE: /target-check judges the base p50 (not the recommended upside) and agrees with the S8 lens summary", async () => {
    const pid = seedProject("D4 base 채택");
    goal(pid, "npv", 30000); // base 40000 meets it; downside 10000 would miss it
    const base = seedCase(pid, "base", "2026-10-28T09:00:01.000Z", { npv: 40000, p05: 35000 });
    seedCase(pid, "upside", "2026-10-28T09:00:02.000Z", { npv: 90000, p05: 80000 }); // max p05 -> the engine "recommends" upside
    seedCase(pid, "downside", "2026-10-28T09:00:03.000Z", { npv: 10000, p05: 5000 });
    expect(listBusinessCases(pid).recommendedScenario).toBe("upside");

    expect((await adopt(pid, base)).status).toBe(201);
    const check = await targetCheck(pid);
    expect(check.judged_basis).toBe("adopted");
    expect(check.judged_case_id).toBe(base);
    const npv = check.entries.find((e) => e.metric_key === "npv")!;
    expect(npv.status).toBe("met"); // pre-fix: "indeterminate" (no p50 for the recommended scenario in the adopted case)
    expect(npv.actual).toBe(40000);
    expect(npv.actual_basis).toContain("채택 Case");
    // /s8-lens-summary judges the same adopted case the same way
    const lens = buildS8LensSummary(db, pid);
    expect(lens.goals).toMatchObject({ goal_count: 1, met: 1, missed: 0 });
  });

  test("adopt a case that MISSES the goal: both consumers say missed (consistent, not recommended-scenario dependent)", async () => {
    const pid = seedProject("D4 downside 채택");
    goal(pid, "npv", 30000);
    seedCase(pid, "base", "2026-10-28T09:00:01.000Z", { npv: 40000, p05: 35000 });
    seedCase(pid, "upside", "2026-10-28T09:00:02.000Z", { npv: 90000, p05: 80000 });
    const down = seedCase(pid, "downside", "2026-10-28T09:00:03.000Z", { npv: 10000, p05: 5000 });
    expect((await adopt(pid, down)).status).toBe(201);
    const npv = (await targetCheck(pid)).entries.find((e) => e.metric_key === "npv")!;
    expect(npv).toMatchObject({ status: "missed", actual: 10000 });
    expect(buildS8LensSummary(db, pid).goals).toMatchObject({ met: 0, missed: 1 });
  });

  test("nothing adopted yet: the BASE case is judged and labelled as a fallback", async () => {
    const pid = seedProject("D4 미채택");
    goal(pid, "npv", 30000);
    const base = seedCase(pid, "base", "2026-10-28T09:00:01.000Z", { npv: 40000, p05: 35000 });
    seedCase(pid, "upside", "2026-10-28T09:00:02.000Z", { npv: 90000, p05: 80000 });
    const check = await targetCheck(pid);
    expect(check.judged_basis).toBe("base_fallback");
    expect(check.judged_case_id).toBe(base);
    const npv = check.entries.find((e) => e.metric_key === "npv")!;
    expect(npv).toMatchObject({ status: "met", actual: 40000 });
    expect(npv.actual_basis).toContain("채택 전");
    // no cases at all -> nothing to judge (a fact, not a miss)
    const empty = seedProject("D4 케이스 없음");
    goal(empty, "npv", 30000);
    const none = await targetCheck(empty);
    expect(none.judged_case_id).toBeNull();
    expect(none.entries.find((e) => e.metric_key === "npv")!.status).toBe("indeterminate");
    expect(goalJudgedCase(listBusinessCases(empty))).toMatchObject({ caseView: null });
  });
});

describe("D5: S8 completion keys on the adopted case, or the base model when none is adopted", () => {
  const s8 = (pid: string) => {
    const ev = evaluateProcess({ type: "project", id: pid });
    return { bepMissing: ev.requiredArtifacts.includes(blocker("s8.bep_input_snapshot")), ev };
  };

  test("a null DOWNSIDE BEP (latest-created model) no longer blocks S8 when the base BEP exists", () => {
    const pid = seedProject("D5 downside null");
    seedCase(pid, "base", "2026-10-28T09:00:01.000Z", { npv: 2, bep: 4.9 });
    seedCase(pid, "upside", "2026-10-28T09:00:02.000Z", { npv: 50, bep: 3.1 });
    seedCase(pid, "downside", "2026-10-28T09:00:03.000Z", { npv: -40, bep: null }); // latest created, BEP not reached
    expect(s8(pid).bepMissing).toBe(false);
  });

  test("the adopted case decides once adopted: an adopted case without BEP re-opens, one with BEP keeps S8 satisfied", async () => {
    const pid = seedProject("D5 adopted");
    const base = seedCase(pid, "base", "2026-10-28T09:00:01.000Z", { npv: 2, bep: 4.9 });
    const down = seedCase(pid, "downside", "2026-10-28T09:00:02.000Z", { npv: -40, bep: null });
    goal(pid, "npv", -100000);
    expect((await adopt(pid, base)).status).toBe(201);
    expect(s8(pid).bepMissing).toBe(false);
    // adopting the downside (no BEP) is judged on the downside itself - the base BEP must not paper over it
    // (the old rule never completed this project either: its latest-created model is the downside)
    expect((await adopt(pid, down)).status).toBe(201);
    const ev = s8(pid);
    expect(ev.bepMissing).toBe(true);
    expect(ev.ev.blockers.join("\n")).toContain("채택한 케이스");
  });

  test("no base BEP anywhere still blocks (null stays null, no invented value)", () => {
    const pid = seedProject("D5 all null");
    seedCase(pid, "base", "2026-10-28T09:00:01.000Z", { npv: -5, bep: null });
    seedCase(pid, "downside", "2026-10-28T09:00:02.000Z", { npv: -40, bep: null });
    const r = s8(pid);
    expect(r.bepMissing).toBe(true);
    expect(r.ev.blockers.join("\n")).toContain("기준(base) 시나리오 기준");
  });

  test("non-regression: a project the OLD rule already completed (latest-created model has a BEP) stays complete", async () => {
    const pid = seedProject("D5 grandfather");
    const base = seedCase(pid, "base", "2026-10-28T09:00:01.000Z", { npv: 2, bep: null });   // base BEP null ...
    seedCase(pid, "upside", "2026-10-28T09:00:02.000Z", { npv: 50, bep: 3.1 });              // ... latest-created has one: old rule = complete
    goal(pid, "npv", -100000);
    expect(s8(pid).bepMissing).toBe(false);
    expect((await adopt(pid, base)).status).toBe(201);
    expect(s8(pid).bepMissing).toBe(false); // adopted base has no BEP, but the old rule completed it: never un-completed
  });

  test("LOW-3: the NPV-quantile check has the same non-regression OR (adopted case without sims, latest has them)", async () => {
    const pid = seedProject("D5 quantiles");
    const base = seedCase(pid, "base", "2026-10-28T09:00:01.000Z", { npv: 2, bep: 4.9 });
    db.run("DELETE FROM valuation_simulation WHERE model_id = ?", [base]); // adopted/base model has no simulation rows
    seedCase(pid, "upside", "2026-10-28T09:00:02.000Z", { npv: 50, bep: 3.1 }); // latest-created keeps them
    const ev = evaluateProcess({ type: "project", id: pid });
    expect(ev.requiredArtifacts).not.toContain(blocker("s8.npv_quantiles"));
  });
});
