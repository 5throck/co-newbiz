// @version 1.0.0
/**
 * ADR-0200 decision 8 / design 2026-11-17 section 10.10 — the S6 evaluation dispatcher: pool bound (TB1), single priority
 * (TB2), the starvation guard (TB3), de-duplication and take-over (TB4), no 409 for running work (TB6), and gap-free
 * version numbers under parallel items (TB9). Cancel, restart, queue_full and budget live in brownfield-eval-queue-ops.test.ts.
 * A deterministic fake runner answers every DART fetch in-process; the test decides when a fetch (an item in flight) returns.
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { createHarness } from "./helpers/eval-queue-harness.ts";

const h = await createHarness("pool");
afterAll(() => h.cleanup());
const { queue, repo, db } = h;
const POOL = queue.EVAL_WORKER_POOL_SIZE;

describe("worker pool", () => {
  test("TB1: the pool size is 3 and in-flight work never exceeds it, across 3 bulk runs and 5 single starts", async () => {
    expect(POOL).toBe(3);
    const o1 = h.mkOpp("tb1a", 20);
    const o2 = h.mkOpp("tb1b", 20);
    const o3 = h.mkOpp("tb1c", 20);
    const o4 = h.mkOpp("tb1s", 5);
    const samples: number[] = [];
    queue.setDispatchObserverForTests((e) => samples.push(e.inFlight));
    const runs: string[] = [];
    for (const o of [o1, o2, o3]) {
      const res = await h.start(o.opp);
      expect(res.status).toBe(202);
      runs.push((await h.data(res)).data.run_id);
    }
    for (const id of o4.ids) {
      const res = await h.start(o4.opp, { target_ids: [id] });
      expect(res.status).toBe(202);
      runs.push((await h.data(res)).data.run_id);
    }
    await h.idle();
    queue.setDispatchObserverForTests(null);
    expect(samples.length).toBe(65);
    expect(Math.max(...samples)).toBeLessThanOrEqual(POOL);
    expect(h.ctl.peak).toBeLessThanOrEqual(POOL);
    expect(h.ctl.sameCandidateTwice).toBe(false);
    for (const id of runs) expect(repo.getRun(db, id)?.status).toBe("completed");
    const done = (
      db.query("SELECT COUNT(*) n FROM brownfield_eval_draft_run_item WHERE state = 'done'").get() as { n: number }
    ).n;
    expect(done).toBe(65);
  });

  test("TB9: parallel items over different candidates keep gap-free version numbers; a repeat run adds none (unchanged inputs)", async () => {
    const o = h.mkOpp("tb9", 6);
    const first = (await h.data(await h.start(o.opp))).data.run_id as string;
    await h.idle();
    const second = (await h.data(await h.start(o.opp, { force_refresh: true }))).data.run_id as string;
    await h.idle();
    expect(repo.getRun(db, first)?.status).toBe("completed");
    expect(repo.getRun(db, second)?.status).toBe("completed");
    for (const id of o.ids) expect(repo.getLatestVersion(db, id, "financial")?.version_no).toBe(1);
    const dupes = db
      .query(
        "SELECT brownfield_target_id, category, version_no, COUNT(*) n FROM brownfield_eval_draft_version GROUP BY brownfield_target_id, category, version_no HAVING n > 1",
      )
      .all();
    expect(dupes).toEqual([]);
  });
});

describe("priority (gated runner)", () => {
  const events: Array<{ single: boolean; runId: string; inFlight: number; singleInFlight: number }> = [];
  beforeAll(() => {
    h.ctl.manual = true;
    queue.setDispatchObserverForTests((e) => events.push(e));
  });
  afterAll(() => {
    h.ctl.manual = false;
    h.releaseAll();
    queue.setDispatchObserverForTests(null);
  });

  test("TB2 + TB6: with a bulk queue in flight, a single start is accepted (202) and takes the next free slot", async () => {
    const bulkOpp = h.mkOpp("tb2b", 10);
    const singleOpp = h.mkOpp("tb2s", 2);
    const bulkRes = await h.start(bulkOpp.opp);
    expect(bulkRes.status).toBe(202);
    const bulkRun = (await h.data(bulkRes)).data.run_id as string;
    await h.until(() => h.heldCorps().length === POOL, "3 bulk items in flight");
    expect(queue.inFlightCount()).toBe(POOL);
    const before = events.length;
    const singleRes = await h.start(singleOpp.opp, { target_ids: [singleOpp.ids[0]] });
    expect(singleRes.status).toBe(202); // never 409 at a full pool
    const single = await h.data(singleRes);
    expect(single.data.queued).toBe(1);
    expect(events.length).toBe(before); // pool is full: waits for a slot
    h.release(bulkOpp.corps[0]); // one bulk item completes -> the freed slot goes to the single, not the next bulk item
    await h.until(() => events.length === before + 1, "next dispatch");
    expect(events[before]).toMatchObject({ single: true, runId: single.data.run_id });
    expect(repo.getRun(db, bulkRun)?.status).toBe("running");
    h.releaseAll();
    await h.until(() => queue.inFlightCount() === 0 || h.heldCorps().length > 0, "progress");
    for (let i = 0; i < 100 && (queue.isEngineActive(bulkRun) || queue.isEngineActive(single.data.run_id)); i++) {
      h.releaseAll();
      await h.tick(10);
    }
    expect(repo.getRun(db, bulkRun)?.status).toBe("completed");
    expect(repo.getRun(db, single.data.run_id)?.status).toBe("completed");
  });

  test("TB3: starvation guard — while bulk items wait, at most POOL-1 slots hold single items", async () => {
    const singles = h.mkOpp("tb3s", 8);
    const bulkOpp = h.mkOpp("tb3b", 6);
    events.length = 0;
    // three single starts fill the pool (no bulk is waiting yet, so the guard is inactive)
    for (const id of singles.ids.slice(0, 3))
      expect((await h.start(singles.opp, { target_ids: [id] })).status).toBe(202);
    await h.until(() => h.heldCorps().length === POOL, "3 singles in flight");
    // a bulk run now waits; further singles queue behind a full pool
    const bulkRun = (await h.data(await h.start(bulkOpp.opp))).data.run_id as string;
    for (const id of singles.ids.slice(3, 6))
      expect((await h.start(singles.opp, { target_ids: [id] })).status).toBe(202);
    const mark = events.length;
    h.release(singles.corps[0]); // a single frees a slot: 2 singles still hold slots (= POOL-1) and bulk waits -> bulk goes
    await h.until(() => events.length === mark + 1, "dispatch after first release");
    expect(events[mark]).toMatchObject({ single: false, runId: bulkRun });
    expect(events[mark].singleInFlight).toBeLessThanOrEqual(POOL - 1);
    h.release(singles.corps[1]); // another single slot frees: singles drop to 1, so a single may take it again
    await h.until(() => events.length === mark + 2, "dispatch after second release");
    expect(events[mark + 1].single).toBe(true);
    // no dispatch ever put POOL singles in flight while bulk waited (after the bulk run was queued)
    for (const e of events.slice(mark)) if (!e.single) expect(e.singleInFlight).toBeLessThan(POOL);
    for (let i = 0; i < 400 && queue.isEngineActive(bulkRun); i++) {
      h.releaseAll();
      await h.tick(10);
    }
    await h.idle();
    expect(repo.getRun(db, bulkRun)?.status).toBe("completed");
    expect(h.ctl.sameCandidateTwice).toBe(false);
  });
});

describe("de-duplication (TB4)", () => {
  beforeAll(() => {
    h.ctl.manual = true;
  });
  afterAll(() => {
    h.ctl.manual = false;
    h.releaseAll();
  });

  test("a candidate running in run A is skipped_active in a new bulk run B; a bulk-queued candidate is taken over by a single start", async () => {
    const o = h.mkOpp("tb4", 8);
    const runA = (await h.data(await h.start(o.opp, { target_ids: o.ids.slice(0, 5) }))).data.run_id as string;
    await h.until(() => h.heldCorps().length === POOL, "3 items of run A in flight");
    expect(h.stateOf(runA, o.ids[0])).not.toBe("pending"); // running
    expect(h.stateOf(runA, o.ids[4])).toBe("pending"); // queued behind the full pool
    // new bulk run B over a different set that overlaps A: running and queued candidates are skipped_active
    const resB = await h.data(await h.start(o.opp, { target_ids: [o.ids[0], o.ids[4], o.ids[5], o.ids[6]] }));
    const runB = resB.data.run_id as string;
    expect(resB.data.queued).toBe(2);
    expect(resB.data.skipped).toEqual([
      { target_id: o.ids[0], reason: "already_active" },
      { target_id: o.ids[4], reason: "already_active" },
    ]);
    expect(h.stateOf(runB, o.ids[0])).toBe("skipped_active");
    expect(h.stateOf(runA, o.ids[4])).toBe("pending"); // a bulk start never takes over
    // a SINGLE start over the candidate queued deep in bulk run A: take-over
    h.ctl.sameCandidateTwice = false;
    const resS = await h.data(await h.start(o.opp, { target_ids: [o.ids[4]] }));
    expect(resS.data.taken_over).toEqual([{ target_id: o.ids[4], from_run_id: runA }]);
    expect(resS.data.queued).toBe(1);
    expect(h.stateOf(runA, o.ids[4])).toBe("skipped_active");
    const taken = repo.listRunItems(db, runA).find((i) => i.brownfield_target_id === o.ids[4])!;
    expect(taken.error_message).toBe(`taken_over_by:${resS.data.run_id}`);
    // a single start over a candidate that runs, or waits in another SINGLE run, is skipped
    const again = await h.data(await h.start(o.opp, { target_ids: [o.ids[0]] }));
    expect(again.data.skipped).toEqual([{ target_id: o.ids[0], reason: "already_active" }]);
    const audits = db
      .query("SELECT target FROM audit_log WHERE action = 'target_eval.bulk_run.take_over'")
      .all() as Array<{ target: string }>;
    expect(audits.map((a) => a.target)).toEqual([
      `${o.opp}:run:${runA}:target=${o.ids[4]}:taken_over_by=${resS.data.run_id}`,
    ]);
    for (let i = 0; i < 600 && queue.inFlightCount() + h.heldCorps().length > 0; i++) {
      h.releaseAll();
      await h.tick(10);
    }
    await h.idle();
    expect(h.ctl.sameCandidateTwice).toBe(false);
    expect(repo.getRun(db, runA)?.status).toBe("completed");
    expect(repo.getRun(db, runB)?.status).toBe("completed");
    // every candidate got exactly one financial version (nobody was evaluated twice)
    for (const id of o.ids.slice(0, 7)) expect(repo.getLatestVersion(db, id, "financial")?.version_no).toBe(1);
  });
});
