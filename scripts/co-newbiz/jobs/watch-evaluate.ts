// @version 1.0.0
/**
 * watch.evaluate - the FR-MON-01 monitoring cycle as a scheduler handler (design 3.1). Wraps exactly what
 * `bun scripts/co-newbiz/watch-run.ts` does: runWatchCycle (watch-engine notifications), the pipeline resume pass and
 * the market-sizing queue recovery pass. Watch cooldown/hysteresis (FR-MON-03) and the watch.last_checked_at watermark
 * make a rerun safe. A disabled watch/rule is skipped inside the engine, so toggles need no scheduler action.
 *
 * Note: watch-run keeps its own per-pass `job_run` rows (job_key 'watch:run'); the scheduler's 'watch.evaluate' row is
 * the one that carries trigger/env/counts and the nested ids are recorded in its detail_json.
 */
import { runMarketSizingQueuePass, runPipelineResumePass, runWatchCycle } from "../watch-run.ts";
import type { JobHandler } from "./types.ts";

export const watchEvaluate: JobHandler = {
  key: "watch.evaluate",
  displayName: "Watch rule evaluation",
  description: "Evaluates watch rules against new data, records deterioration/opportunity notifications, resumes paused pipelines.",
  defaultCron: "*/30 * * * *",
  timeoutSec: 600,
  maxRetries: 0,
  // D7: skipped after host sleep - the next slot is soon.
  catchup: { mode: "skip" },
  async run(ctx) {
    const now = ctx.now.toISOString();
    // Handlers must be async and honour ctx.signal between units of work: a timed-out run ends the PROCESS (run-job
    // exits 124 and keeps the lock until the lease expires), so a pass must not be started after the abort.
    const checkAbort = () => {
      if (ctx.signal.aborted) throw new Error("aborted");
    };
    const cycle = runWatchCycle(ctx.db, { now });
    await Promise.resolve(); // yield so the timeout timer can fire between passes
    checkAbort();
    const resume = await runPipelineResumePass(ctx.db, { now });
    checkAbort();
    const queue = await runMarketSizingQueuePass(ctx.db, { now });
    const fired = cycle.projects.reduce((n, p) => n + p.notificationsFired + p.killCriteriaNotifications, 0);
    return {
      rowsRead: cycle.projects.length,
      rowsWritten: fired,
      rowsChanged: cycle.projects.filter((p) => p.changed).length,
      detail: {
        watch_run_ids: [cycle.jobRunId, resume.jobRunId, queue.jobRunId],
        projects: cycle.projects.length,
        reassessed: cycle.projects.filter((p) => p.reassessed).length,
        notifications_fired: fired,
        notifications_suppressed: cycle.projects.reduce((n, p) => n + p.notificationsSuppressed, 0),
        pipelines_resumed: resume.outcomes.length,
        queue_healed: queue.healed.length,
        queue_started: queue.started.length,
      },
    };
  },
};
