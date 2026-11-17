// @version 1.0.0
/**
 * Security-review hardening of the S6 evaluation queue (ADR-0200 decision 8): audits commit in the same transaction as the
 * decision-bearing write, paused/interrupted runs in dedupe, take-over and the queue cap, route guards, per-item timeout,
 * cooldown pruning, and the "nothing to enqueue" start. Fake runner: helpers/eval-queue-harness.ts.
 */
import { test, expect, describe, afterAll } from "bun:test";
import { createHarness } from "./helpers/eval-queue-harness.ts";

const h = await createHarness("sec");
afterAll(() => h.cleanup());
const { queue, repo, db, bulk } = h;
const runPath = (opp: string, run: string) => `/api/brownfield/${opp}/eval-draft-runs/${run}`;
const NOW = () => new Date().toISOString();
const mkRun = (opp: string, ids: string[], now = NOW()) =>
  repo.createRunOrThrow(db, {
    opportunityId: opp,
    categories: "financial",
    targetIds: ids,
    webEvidence: false,
    forceRefresh: false,
    startedBy: h.ANALYST,
    startedVia: "ui",
    now,
  }).run;
const input = (opp: string, ids: string[]) => ({
  opportunityId: opp,
  categories: "financial" as const,
  targetIds: ids,
  webEvidence: false,
  forceRefresh: false,
  startedBy: h.ANALYST,
  startedVia: "ui",
  now: NOW(),
});
const auditCount = (action: string) =>
  (db.query("SELECT COUNT(*) n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;

describe("audit in the same transaction", () => {
  test("a throwing audit rolls back the start, the take-over, the run cancel and the item cancel", () => {
    const o = h.mkOpp("tx", 4);
    const bulkRun = mkRun(o.opp, [o.ids[0], o.ids[1]]); // unregistered, items pending
    const boom = () => {
      throw new Error("audit failed");
    };
    // start + take-over: nothing is written when onWrite throws
    expect(() => repo.createRun(db, { ...input(o.opp, [o.ids[0]]), onWrite: boom })).toThrow("audit failed");
    expect(repo.listRunItems(db, bulkRun.id).map((i) => i.state)).toEqual(["pending", "pending"]); // not taken over
    expect(db.query("SELECT COUNT(*) n FROM brownfield_eval_draft_run WHERE opportunity_id = ?").get(o.opp)).toEqual({
      n: 1,
    });
    // item cancel
    const item = repo.listRunItems(db, bulkRun.id)[0];
    expect(() =>
      repo.cancelQueuedItem(db, item.id, NOW(), () => {
        throw new Error("audit failed");
      }),
    ).toThrow("audit failed");
    expect(repo.getRunItem(db, item.id)?.state).toBe("pending");
    // run cancel
    expect(() => queue.cancelRun(db, bulkRun.id, NOW(), boom)).toThrow("audit failed");
    expect(repo.getRun(db, bulkRun.id)?.status).toBe("running");
    expect(repo.listRunItems(db, bulkRun.id).map((i) => i.state)).toEqual(["pending", "pending"]);
  });

  test("the routes write start, take_over, cancel and item-cancel audits with the decision", async () => {
    const o = h.mkOpp("txr", 3);
    h.ctl.manual = true;
    const run = (await h.data(await h.start(o.opp, { target_ids: o.ids }))).data.run_id as string;
    await h.until(() => h.heldCorps().length === 3, "3 in flight");
    expect(auditCount("target_eval.bulk_run.start")).toBeGreaterThan(0);
    expect((await h.post(`${runPath(o.opp, run)}/cancel`)).status).toBe(200);
    expect(auditCount("target_eval.bulk_run.cancel")).toBe(1);
    h.ctl.manual = false;
    h.releaseAll();
    await h.idle();
  });
});

describe("paused and interrupted runs", () => {
  test("(a) a bulk start skips a paused run's candidate with reason paused_run + the run id; identical sets are reused", async () => {
    const o = h.mkOpp("pa", 4);
    const paused = mkRun(o.opp, [o.ids[0], o.ids[1]]);
    repo.pauseRun(db, paused.id, "dart_budget_reserve", NOW());
    const res = await h.data(await h.start(o.opp, { target_ids: [o.ids[0], o.ids[2], o.ids[3]] }));
    expect(res.data.skipped).toEqual([{ target_id: o.ids[0], reason: "paused_run", run_id: paused.id }]);
    expect(res.data.queued).toBe(2);
    await h.idle();
    const again = await h.data(await h.start(o.opp, { target_ids: [o.ids[0], o.ids[1]] }));
    expect(again.meta.reused).toBe(true);
    expect(again.data.run_id).toBe(paused.id);
  });

  test("(b) an interrupted run does not hold the queue cap; a paused_budget run does", () => {
    const o = h.mkOpp("pb", 6);
    const interrupted = mkRun(o.opp, o.ids.slice(0, 3));
    db.run("UPDATE brownfield_eval_draft_run SET status = 'interrupted' WHERE id = ?", [interrupted.id]);
    expect(repo.countQueuedItems(db, o.opp)).toBe(0);
    const paused = mkRun(o.opp, o.ids.slice(3));
    repo.pauseRun(db, paused.id, "dart_budget_reserve", NOW());
    expect(repo.countQueuedItems(db, o.opp)).toBe(3);
  });

  test("(c) a SINGLE start takes over items of paused and interrupted runs, including a mid-step item", async () => {
    const o = h.mkOpp("pc", 4);
    const paused = mkRun(o.opp, [o.ids[0], o.ids[1]]);
    repo.pauseRun(db, paused.id, "dart_budget_reserve", NOW());
    repo.updateRunItem(db, repo.listRunItems(db, paused.id)[0].id, { state: "financial_draft" }, NOW());
    const interrupted = mkRun(o.opp, [o.ids[2], o.ids[3]]);
    db.run("UPDATE brownfield_eval_draft_run SET status = 'interrupted' WHERE id = ?", [interrupted.id]);
    for (const [i, from] of [
      [0, paused.id],
      [1, paused.id],
      [2, interrupted.id],
    ] as const) {
      const res = await h.data(await h.start(o.opp, { target_ids: [o.ids[i]] }));
      expect(res.data.taken_over).toEqual([{ target_id: o.ids[i], from_run_id: from }]);
      expect(h.stateOf(from, o.ids[i])).toBe("skipped_active");
      const old = repo.listRunItems(db, from).find((x) => x.brownfield_target_id === o.ids[i])!;
      expect(old.error_message).toBe(`taken_over_by:${res.data.run_id}`);
    }
    await h.idle();
    expect(auditCount("target_eval.bulk_run.take_over")).toBe(3);
  });
});

describe("start without anything to enqueue, and the cap counts eligible items", () => {
  test("(6) every candidate skipped: 200, no run row, no audit, no cooldown consumed", async () => {
    const o = h.mkOpp("empty", 2);
    h.ctl.manual = true;
    await h.start(o.opp, { target_ids: [o.ids[0]] });
    await h.start(o.opp, { target_ids: [o.ids[1]] });
    await h.until(() => h.heldCorps().length === 2, "2 in flight");
    const runs = () =>
      (
        db.query("SELECT COUNT(*) n FROM brownfield_eval_draft_run WHERE opportunity_id = ?").get(o.opp) as {
          n: number;
        }
      ).n;
    const starts = auditCount("target_eval.bulk_run.start");
    const res = await h.start(o.opp, { target_ids: o.ids, categories: "technical" });
    expect(res.status).toBe(200);
    expect((await h.data(res)).data).toMatchObject({ run_id: null, status: null, queued: 0, taken_over: [] });
    expect(runs()).toBe(2);
    expect(auditCount("target_eval.bulk_run.start")).toBe(starts);
    h.ctl.manual = false;
    h.releaseAll();
    await h.idle();
  });

  test("(6) the cap counts what would actually be enqueued, not the candidates asked for", async () => {
    const o = h.mkOpp("cap", 260);
    h.ctl.manual = true;
    await h.start(o.opp, { target_ids: o.ids.slice(0, 100) }); // 97 queued + 3 in flight
    const ok = await h.start(o.opp, { target_ids: o.ids.slice(0, 180) }); // 100 skipped, 80 enqueued: 177 <= 200
    expect(ok.status).toBe(202);
    expect((await h.data(ok)).data.queued).toBe(80);
    const refused = await h.start(o.opp, { target_ids: o.ids.slice(180, 260) }); // 80 more: 257 > 200
    expect(refused.status).toBe(429);
    for (const r of repo.getActiveRunsForOpportunity(db, o.opp)) await h.post(`${runPath(o.opp, r.id)}/cancel`);
    h.ctl.manual = false;
    h.releaseAll();
    await h.idle();
  });
});

describe("route guards", () => {
  test("resume is N2-guarded; cancel and item cancel refuse a promoted opportunity", async () => {
    const o = h.mkOpp("guard", 2);
    const run = mkRun(o.opp, o.ids);
    repo.pauseRun(db, run.id, "dart_budget_reserve", NOW());
    db.run("UPDATE opportunity SET status = 'identified' WHERE id = ?", [o.opp]);
    const resume = await h.post(`${runPath(o.opp, run.id)}/resume`);
    expect(resume.status).toBe(409);
    expect((await h.data(resume)).error.code).toBe("not_selected");
    db.run("UPDATE opportunity SET status = 'selected' WHERE id = ?", [o.opp]);
    const item = repo.listRunItems(db, run.id)[0];
    db.run("PRAGMA foreign_keys = OFF");
    db.run("UPDATE opportunity SET project_id = 'p-promoted' WHERE id = ?", [o.opp]);
    try {
      const cancel = await h.post(`${runPath(o.opp, run.id)}/cancel`);
      expect(cancel.status).toBe(409);
      expect((await h.data(cancel)).error.code).toBe("already_promoted");
      expect((await h.post(`${runPath(o.opp, run.id)}/items/${item.id}/cancel`)).status).toBe(409);
      expect(repo.getRunItem(db, item.id)?.state).toBe("pending");
    } finally {
      db.run("UPDATE opportunity SET project_id = NULL WHERE id = ?", [o.opp]);
      db.run("PRAGMA foreign_keys = ON");
    }
  });
});

describe("hung items and cooldown memory", () => {
  test("a hung item ends failed (item_timeout) and frees its slot; its late work cannot revive it", async () => {
    const o = h.mkOpp("hang", 2);
    queue.setItemTimeoutForTests(80);
    h.ctl.manual = true;
    const run = (await h.data(await h.start(o.opp, { target_ids: [o.ids[0]] }))).data.run_id as string;
    await h.until(() => h.heldCorps().length === 1, "item held");
    await h.until(() => queue.inFlightCount() === 0, "slot freed by the timeout");
    const item = repo.listRunItems(db, run)[0];
    expect(item.state).toBe("failed");
    expect(item.error_message).toBe("item_timeout");
    h.ctl.manual = false;
    h.releaseAll(); // the hung fetch finally returns
    await h.tick(100);
    expect(repo.getRunItem(db, item.id)?.state).toBe("failed");
    await h.idle();
    expect(repo.getRun(db, run)?.status).toBe("completed");
    queue.setItemTimeoutForTests(0);
  });

  test("expired cooldown windows are pruned on each start", () => {
    bulk.setStartCooldownForTests(1000);
    bulk.noteRunStart("u1", undefined, 0);
    bulk.noteRunStart("u2", "t1", 0);
    expect(bulk.cooldownEntryCountForTests()).toBe(2);
    bulk.noteRunStart("u3", undefined, 5000);
    expect(bulk.cooldownEntryCountForTests()).toBe(1);
    bulk.setStartCooldownForTests(0);
  });
});
