// @version 1.2.0
// 1.2.0: ADR-0189 phase P6 — retention.cleanup registers here, which makes schedule-seed create its
// schedule_job row disabled (D3) with cron 0 3 * * *, timeout 30 min, max_retries 0.
// 1.1.0: ADR-0189 phase P5 — the five collect.* handlers register here, which makes schedule-seed create their
// schedule_job rows disabled (D3) with each handler's cron/timeout/retry values.
/**
 * The scheduler's handler registry. Adding a job = adding a handler here; `schedule_job.job_key` values without a
 * registered handler are refused by run-job (and by the future admin create endpoint).
 */
import { gateIntegrityShadowReport } from "./gate-integrity-shadow-report.ts";
import { watchEvaluate } from "./watch-evaluate.ts";
import { notifyDeliver } from "./notify-deliver.ts";
import { notifyDigest } from "./notify-digest.ts";
import { collectDart } from "./collect/dart.ts";
import { collectEcos } from "./collect/ecos.ts";
import { collectKrx } from "./collect/krx.ts";
import { collectKosis } from "./collect/kosis.ts";
import { collectLaw } from "./collect/law.ts";
import { retentionCleanup } from "./retention-cleanup.ts";
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
registerJobHandler(notifyDeliver);
registerJobHandler(notifyDigest);
registerJobHandler(collectDart);
registerJobHandler(collectEcos);
registerJobHandler(collectKrx);
registerJobHandler(collectKosis);
registerJobHandler(collectLaw);
registerJobHandler(retentionCleanup);
