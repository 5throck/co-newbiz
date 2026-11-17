// @version 1.0.0
/**
 * ADR-0200 decision 8 / design 2026-11-17 section 10.10 — queue operations: queue_full 429 (TB5), run cancel and the
 * per-row queued cancel A4b (TB7), restart and interrupted detection (TB8) and the global DART reserve (TB10). The fake
 * runner (helpers/eval-queue-harness.ts) holds DART fetches so the tests control what is in flight.
 */
import { test, expect, describe, afterAll } from "bun:test";
import { createHarness } from "./helpers/eval-queue-harness.ts";

const h = await createHarness("ops");
afterAll(() => h.cleanup());
const { queue, repo, db } = h;
const POOL = queue.EVAL_WORKER_POOL_SIZE;
const runPath = (opp: string, run: string) => `/api/brownfield/${opp}/eval-draft-runs/${run}`;

async function drain(): Promise<void> {
  h.ctl.manual = false;
  h.releaseAll();
  await h.idle();
}

describe("TB5 queue_full", () => {
  test("pending items across the opportunity's active runs are capped at 200; the refusal is 429 queue_full {queued, limit}", async () => {
    expect(repo.MAX_QUEUED_ITEMS_PER_OPPORTUNITY).toBe(200);
    const o = h.mkOpp("tb5", 230);
    h.ctl.manual = true;
    const r1 = await h.start(o.opp, { target_ids: o.ids.slice(0, 100) });
    const r2 = await h.start(o.opp, { target_ids: o.ids.slice(100, 200) });
    expect([r1.status, r2.status]).toEqual([202, 202]);
    const run1 = (await h.data(r1)).data;
    expect(run1.queued).toBe(100);
    const queued = repo.countQueuedItems(db, o.opp);
    expect(queued).toBeGreaterThan(190); // 200 items minus the ones a worker already holds
    const refused = await h.start(o.opp, { target_ids: o.ids.slice(200, 230) });
    expect(refused.status).toBe(429);
    const body = await h.data(refused);
    expect(body.error.code).toBe("queue_full");
    expect(body.error.details).toEqual({ queued, limit: 200 });
    // a refused start leaves nothing behind
    expect(db.query("SELECT COUNT(*) n FROM brownfield_eval_draft_run WHERE opportunity_id = ?").get(o.opp)).toEqual({
      n: 2,
    });
    // a small start that fits is still accepted
    expect((await h.start(o.opp, { target_ids: o.ids.slice(200, 202) })).status).toBe(202);
    // identical active set: reuse, never a duplicate and never queue_full
    const again = await h.start(o.opp, { target_ids: o.ids.slice(0, 100) });
    expect(again.status).toBe(202);
    expect((await h.data(again)).meta.reused).toBe(true);
    for (const r of repo.getActiveRunsForOpportunity(db, o.opp))
      expect((await h.post(`${runPath(o.opp, r.id)}/cancel`)).status).toBe(200);
    await drain();
  });
});

describe("TB7 cancel", () => {
  test("run cancel: queued items become cancelled, in-flight items finish, the run ends cancelled, versions stay", async () => {
    const o = h.mkOpp("tb7", 6);
    h.ctl.manual = true;
    const run = (await h.data(await h.start(o.opp))).data.run_id as string;
    await h.until(() => h.heldCorps().length === POOL, "3 in flight");
    expect((await h.post(`${runPath(o.opp, run)}/cancel`, {}, h.viewerCookie)).status).toBe(403);
    const res = await h.post(`${runPath(o.opp, run)}/cancel`);
    expect(res.status).toBe(200);
    const body = (await h.data(res)).data;
    expect(body.cancelled_items).toBe(3);
    expect(repo.getRun(db, run)?.status).toBe("running"); // the in-flight items finish their current step first
    expect(repo.listRunItems(db, run).filter((i) => i.state === "cancelled")).toHaveLength(3);
    // the run is no longer reusable while it is being cancelled; and nothing new is picked up from it
    const reuse = await h.data(await h.start(o.opp));
    expect(reuse.meta.reused).toBe(false);
    h.ctl.manual = false;
    h.releaseAll();
    await h.idle();
    expect(repo.getRun(db, run)?.status).toBe("cancelled");
    const done = repo.listRunItems(db, run).filter((i) => i.state === "done");
    expect(done).toHaveLength(3);
    for (const i of done) expect(i.financial_version_id).not.toBeNull(); // versions of in-flight items stay
    expect((await h.post(`${runPath(o.opp, run)}/cancel`)).status).toBe(409); // finished run
    // the new run (queued items re-queued after the cancel) completes
    expect(repo.getRun(db, reuse.data.run_id)?.status).toBe("completed");
  });

  test("A4b: a queued item cancels, a running item is 409 item_running, a finished item 409 item_finished, foreign ids 404", async () => {
    const o = h.mkOpp("tb7b", 5);
    const other = h.mkOpp("tb7c", 1);
    h.ctl.manual = true;
    const run = (await h.data(await h.start(o.opp))).data.run_id as string;
    await h.until(() => h.heldCorps().length === POOL, "3 in flight");
    const items = repo.listRunItems(db, run);
    const running = items.find((i) => i.state !== "pending")!;
    const queued = items.find((i) => i.state === "pending")!;
    const url = (item: string, opp = o.opp, r = run) => `${runPath(opp, r)}/items/${item}/cancel`;
    expect((await h.post(url(running.id))).status).toBe(409);
    expect((await h.data(await h.post(url(running.id)))).error.code).toBe("item_running");
    expect((await h.post(url(queued.id), {}, h.viewerCookie)).status).toBe(403);
    expect((await h.post(url(queued.id), {}, "")).status).toBe(401);
    expect((await h.post(url(queued.id, other.opp))).status).toBe(404); // run of another opportunity
    expect((await h.post(url(h.ulid()))).status).toBe(404);
    const ok = await h.post(url(queued.id));
    expect(ok.status).toBe(200);
    expect((await h.data(ok)).data.state).toBe("cancelled");
    expect(repo.getRunItem(db, queued.id)?.state).toBe("cancelled");
    expect(db.query("SELECT target FROM audit_log WHERE action = 'target_eval.bulk_item.cancel'").all()).toHaveLength(
      1,
    );
    expect((await h.data(await h.post(url(queued.id)))).error.code).toBe("item_finished");
    h.ctl.manual = false;
    h.releaseAll();
    await h.idle();
    expect(repo.getRun(db, run)?.status).toBe("completed"); // cancelling an item never cancels the run
    const counts = (await h.data(await h.get(runPath(o.opp, run)))).data.counts;
    expect(counts).toEqual({ done: 4, running: 0, queued: 0, skipped: 0, failed: 0, cancelled: 1, total: 5 });
  });
});

describe("TB8 restart", () => {
  test("a queued run is registered (never interrupted); after a restart it is interrupted only past 10 minutes; pending items stay pending; resume is manual", async () => {
    const o = h.mkOpp("tb8", 4);
    h.ctl.manual = true;
    const live = (await h.data(await h.start(o.opp, { target_ids: o.ids.slice(0, 2) }))).data.run_id as string;
    await h.until(() => h.heldCorps().length === 2, "2 in flight");
    db.run("UPDATE brownfield_eval_draft_run SET heartbeat_at = ? WHERE id = ?", [
      new Date(Date.now() - 3_600_000).toISOString(),
      live,
    ]);
    expect((await h.data(await h.get(runPath(o.opp, live)))).data.run.status).toBe("running"); // registered: not interrupted
    h.ctl.manual = false;
    h.releaseAll();
    await h.idle();
    // simulated restart: the run exists in the database, nothing is registered with the dispatcher
    queue.resetQueueForTests();
    const { run } = repo.createRunOrThrow(db, {
      opportunityId: o.opp,
      categories: "financial",
      targetIds: o.ids.slice(2),
      webEvidence: false,
      forceRefresh: false,
      startedBy: h.ANALYST,
      startedVia: "ui",
      now: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const midStep = repo.listRunItems(db, run.id)[0];
    repo.updateRunItem(db, midStep.id, { state: "financial_draft" }, new Date().toISOString());
    expect((await h.data(await h.get(runPath(o.opp, run.id)))).data.run.status).toBe("running"); // 5 min: not yet
    db.run("UPDATE brownfield_eval_draft_run SET heartbeat_at = ? WHERE id = ?", [
      new Date(Date.now() - 11 * 60_000).toISOString(),
      run.id,
    ]);
    const view = (await h.data(await h.get(runPath(o.opp, run.id)))).data;
    expect(view.run.status).toBe("interrupted");
    expect(view.counts).toMatchObject({ queued: 1, running: 1, total: 2 });
    await h.tick(100); // no auto-resume: nothing runs until a person presses resume
    expect(queue.isEngineActive(run.id)).toBe(false);
    expect(repo.listRunItems(db, run.id).map((i) => i.state)).toEqual(["financial_draft", "pending"]);
    const resumed = await h.post(`${runPath(o.opp, run.id)}/resume`);
    expect(resumed.status).toBe(202);
    await h.idle();
    expect(repo.getRun(db, run.id)?.status).toBe("completed");
    expect(repo.listRunItems(db, run.id).map((i) => i.state)).toEqual(["done", "done"]); // mid-step item restarted its step
    expect(repo.getRun(db, run.id)?.resumed_by).toBe(h.ANALYST);
  });
});

describe("TB10 budget reserve", () => {
  test("reserve unmet: only that run pauses (budget_reserve), a fully cached item still runs, resume is refused until restored", async () => {
    const warm = h.mkOpp("tb10w", 1);
    await h.idle();
    // warm the DART cache for one candidate (budget healthy), then spend the budget down to the reserve
    expect((await h.start(warm.opp)).status).toBe(202);
    await h.idle();
    const o = h.mkOpp("tb10", 2);
    h.ctl.used = 14_990;
    const cached = await h.data(await h.start(warm.opp, { target_ids: warm.ids })); // fully cached candidate, below the reserve
    const unc = await h.data(await h.start(o.opp)); // uncached candidates: reserve unmet
    await h.idle();
    expect(repo.getRun(db, unc.data.run_id)?.status).toBe("paused_budget");
    expect(repo.getRun(db, unc.data.run_id)?.pause_reason).toBe("dart_budget_reserve");
    expect(repo.listRunItems(db, unc.data.run_id).map((i) => i.state)).toEqual(["pending", "pending"]);
    expect(repo.getRun(db, cached.data.run_id)?.status).toBe("completed"); // other runs are unaffected
    expect(
      db
        .query("SELECT COUNT(*) n FROM brownfield_eval_draft_version WHERE brownfield_target_id IN (?, ?)")
        .get(...o.ids),
    ).toEqual({ n: 0 });
    const refused = await h.post(`${runPath(o.opp, unc.data.run_id)}/resume`);
    expect(refused.status).toBe(409);
    expect((await h.data(refused)).error.code).toBe("budget_reserve");
    h.ctl.used = 0;
    expect((await h.post(`${runPath(o.opp, unc.data.run_id)}/resume`)).status).toBe(202);
    await h.idle();
    expect(repo.getRun(db, unc.data.run_id)?.status).toBe("completed");
    expect(repo.listRunItems(db, unc.data.run_id).map((i) => i.state)).toEqual(["done", "done"]);
  });
});
