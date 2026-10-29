// @version 1.0.0
/**
 * Scheduler job handler contract (ADR-0189, design section 2.2). A handler is a registered, named unit of work with
 * structural results - there is NO free-text command anywhere in the scheduler (an admin console that could name a
 * command would be remote code execution).
 */
import type { SchedulerEnv } from "../scheduler-core.ts";
import type { CatchupPolicy } from "../scheduler-core.ts";

export interface JobContext {
  /** the scheduler's DB handle (bun:sqlite Database) */
  db: any;
  now: Date;
  env: SchedulerEnv;
  /** aborted when the timeout elapses; long handlers should check it between units of work */
  signal: AbortSignal;
  /** directory for generated report files (handlers must not assume the repo layout) */
  reportDir: string;
}

export interface JobResult {
  rowsRead?: number;
  rowsWritten?: number;
  rowsChanged?: number;
  /** structured details (per-source counts, report path...); scrubbed before storage */
  detail?: unknown;
  /** set to end the run as 'skipped' (e.g. credential_missing) instead of success */
  skipped?: string;
}

/** Throw to request a retry (network / 5xx / 429). Any other error ends the run as failed without retry. */
export class RetryableJobError extends Error {}

export interface JobHandler {
  key: string;
  displayName: string;
  description: string;
  defaultCron: string;
  timeoutSec: number;
  maxRetries: number;
  catchup: CatchupPolicy;
  /** Must be async-friendly and check ctx.signal between units of work: on timeout run-job exits the process (124). */
  run(ctx: JobContext): Promise<JobResult> | JobResult;
}
