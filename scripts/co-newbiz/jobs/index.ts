// @version 1.0.0
/**
 * The scheduler's handler registry. Adding a job = adding a handler here; `schedule_job.job_key` values without a
 * registered handler are refused by run-job (and by the future admin create endpoint).
 */
import { gateIntegrityShadowReport } from "./gate-integrity-shadow-report.ts";
import { watchEvaluate } from "./watch-evaluate.ts";
import type { JobHandler } from "./types.ts";

const HANDLERS = new Map<string, JobHandler>();

export function registerJobHandler(h: JobHandler): void {
  HANDLERS.set(h.key, h);
}
export function getJobHandler(key: string): JobHandler | undefined {
  return HANDLERS.get(key);
}
export function listJobHandlers(): JobHandler[] {
  return [...HANDLERS.values()].sort((a, b) => a.key.localeCompare(b.key));
}
/** Test-only: remove a handler registered by a test. */
export function unregisterJobHandler(key: string): void {
  HANDLERS.delete(key);
}

registerJobHandler(watchEvaluate);
registerJobHandler(gateIntegrityShadowReport);
