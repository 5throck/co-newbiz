// @version 1.0.0
/**
 * S1-S12 demo seed E2E (T-20261022-003): both track demos — the brownfield
 * seedS1ToS12Demo and the greenfield twin seedGreenfieldS1ToS12Demo — must
 * satisfy every S1-S12 process predicate of lib/process-flow.ts end to end on a
 * scratch SQLite database. The walk evaluates the REAL entrypoint the app uses
 * (evaluateProcess, read-only import — process-flow.ts is owned by another
 * cluster) and asserts every stage in order: complete or track-skipped, no
 * blockers, nothing left current or locked. The greenfield leg also pins the
 * ADR-0161 execution baseline to its CONFIRMED state and the S12 scorecard to
 * the sanctioned record path (both recorded by the seed itself).
 */
import { describe, expect, test, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type * as flowT from "../../app/web-next/lib/process-flow.ts";

process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-s1-s12-demo-e2e.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const flow = await import("../../app/web-next/lib/process-flow.ts");
const geo = await import("../../app/web-next/lib/greenfield-execution.ts");

resetDb();
const db = getDb(TEST_DB_PATH);

type Evaluation = ReturnType<typeof flow.evaluateProcess>;
type StageRow = Evaluation["stages"][number];

/** Walk one entity S1→S12 and assert every stage in [from,to] is complete or
 *  track-skipped; on failure the message names each offending stage with the
 *  evaluation's blockers so the missing artifact is obvious. */
function expectWalkDone(entity: flowT.ProcessEntity, opts: { from?: number; to?: number } = {}): Evaluation {
  const from = opts.from ?? 1;
  const to = opts.to ?? 12;
  const ev = flow.evaluateProcess(entity);
  const undone = ev.stages
    .filter((s) => s.sequence >= from && s.sequence <= to)
    .filter((s) => s.status !== "complete" && s.status !== "skipped");
  const detail = undone.length
    ? `${undone.map((s) => `${s.id}=${s.status}`).join(", ")} | currentStage=${ev.currentStage} blockers=${JSON.stringify(ev.blockers)} missing=${JSON.stringify(ev.requiredArtifacts)}`
    : "";
  expect(detail).toBe("");
  return ev;
}

function stageStatus(ev: Evaluation, id: flowT.StageId): string {
  const s = ev.stages.find((x) => x.id === id);
  if (!s) throw new Error(`stage ${id} missing from evaluation`);
  return s.status;
}

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("S1-S12 demo seeds satisfy the process predicates (both tracks)", () => {
  const bf = seedS1ToS12Demo(TEST_DB_PATH);
  const gfPromise = seedGreenfieldS1ToS12Demo(TEST_DB_PATH);

  test("brownfield opportunity carrier: S1-S4 + S6-S7 complete, S5 greenfield-only skipped, no blockers", () => {
    const ev = expectWalkDone({ type: "opportunity", id: bf.opportunityId }, { to: 7 });
    expect(ev.track).toBe("brownfield");
    expect(ev.subTrack).toBe("m_and_a");
    expect(ev.blockers).toEqual([]);
    for (const id of ["S1", "S2", "S3", "S4", "S6", "S7"] as const) expect(stageStatus(ev, id)).toBe("complete");
    expect(stageStatus(ev, "S5")).toBe("skipped");
    // T-20261022-040: the opportunity-carrier gate ledger is pinned exactly —
    // deleting a gate fixture row must fail here, not slip through silently
    // (only entity_ic/group_ic are predicate-consumed downstream).
    expect(ev.gateStatus).toEqual({ screening: "go", pre_fs: "go", target_screening: "go" });
  });

  test("brownfield project: full S1-S12 walk completes with no blockers (per-stage)", () => {
    const ev = expectWalkDone({ type: "project", id: bf.projectId });
    expect(ev.track).toBe("brownfield");
    expect(ev.currentStage).toBeNull();
    // Project-carrier ledger (fs/dd/entity_ic/group_ic — screening/pre_fs/
    // target_screening live on the opportunity carrier, pinned above; the two
    // pins together cover all 7 flow.spec gates).
    expect(ev.gateStatus).toEqual({ fs: "go", dd: "go", entity_ic: "go", group_ic: "go" });
    // Explicit S1→S12 walk: each stage individually complete (S5 skipped on brownfield).
    for (const s of ev.stages) {
      if (s.id === "S5") expect(s.status).toBe("skipped");
      else expect(`${s.id}:${s.status}`).toBe(`${s.id}:complete`);
    }
  });

  test("brownfield S12: the track demo satisfies whatever process-flow demands at run time", () => {
    // T-20261022-001 may re-key the S12 scorecard demand; this assertion follows
    // the runtime predicate instead of hard-coding the exemption.
    const ev = flow.evaluateProcess({ type: "project", id: bf.projectId });
    expect(stageStatus(ev, "S12")).toBe("complete");
  });

  test("greenfield twin: walks and completes S1-S12 with the CONFIRMED execution baseline", async () => {
    const gf = await gfPromise;

    // Opportunity carrier: S1-S5 complete (greenfield keeps S5), S6/S7 brownfield-only skipped.
    const opp = flow.evaluateProcess({ type: "opportunity", id: gf.opportunityId });
    expect(opp.track).toBe("greenfield");
    for (const id of ["S1", "S2", "S3", "S4", "S5"] as const) expect(stageStatus(opp, id)).toBe("complete");
    expect(stageStatus(opp, "S6")).toBe("skipped");
    expect(stageStatus(opp, "S7")).toBe("skipped");
    // Gate ledger, greenfield twin: target_screening is brownfield-only — its
    // ABSENCE is part of the pin (T-20261022-040).
    expect(opp.gateStatus).toEqual({ screening: "go", pre_fs: "go" });

    // Project carrier: the full walk, stage by stage.
    const ev = expectWalkDone({ type: "project", id: gf.projectId });
    expect(ev.currentStage).toBeNull();
    expect(ev.gateStatus).toEqual({ fs: "go", dd: "go", entity_ic: "go", group_ic: "go" });
    for (const s of ev.stages) {
      if (s.id === "S6" || s.id === "S7") expect(s.status).toBe("skipped");
      else expect(`${s.id}:${s.status}`).toBe(`${s.id}:complete`);
    }

    // S11 ADR-0161: the execution baseline is not just recorded but CONFIRMED
    // by the project lead (the requirement the seed previously lacked).
    const confirmed = geo.latestConfirmedBaseline(gf.projectId, db);
    expect(confirmed).not.toBeNull();
    expect(confirmed!.confirmation).not.toBeNull();
    expect(geo.executionBaselineS11Check(gf.projectId, { otherCriteriaMet: true }, db).requirement).toBe("satisfied");

    // S12: the scorecard came through the sanctioned greenfield record path
    // (recordGreenfieldScorecardFromRequest), so the latest cycle is fresh.
    const latest = db
      .query("SELECT MAX(review_cycle) AS c FROM venture_scorecard WHERE project_id = ?")
      .get(gf.projectId) as { c: string | null };
    const { currentReviewCycle, isFreshReviewCycle } = await import("../../app/web-next/lib/portfolio.ts");
    expect(latest.c).toBe(currentReviewCycle());
    expect(isFreshReviewCycle(latest.c!)).toBe(true);
  });

  test("re-running both seeds stays idempotent and keeps every predicate green", async () => {
    seedS1ToS12Demo(TEST_DB_PATH);
    const gf = await gfPromise;
    await seedGreenfieldS1ToS12Demo(TEST_DB_PATH);
    expectWalkDone({ type: "project", id: bf.projectId });
    expectWalkDone({ type: "project", id: gf.projectId });
    // The baseline was not superseded by the re-run (still the same confirmation).
    expect(geo.executionBaselineS11Check(gf.projectId, { otherCriteriaMet: true }, db).requirement).toBe("satisfied");
  });
});
