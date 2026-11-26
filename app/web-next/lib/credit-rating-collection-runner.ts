// @version 1.0.0
// In-app disclosed-credit-rating collection (POST /api/projects/[id]/wacc/credit-rating/collect), ADR-0208 slice 2.
//
// Same model as the beta and ECOS collections (PR #980): the route only records a job_run row and answers 202;
// the work runs in-process in the long-lived server (collectCreditRating - one multi-megabyte DART document plus
// one bdRs.json call, so a request-time answer is not safe) and the UI polls GET until the run leaves "running".
// A user-triggered one-off, NOT a scheduler (ADR-0019 untouched). A server restart mid-run orphans the row; the
// stale sweep fails it after STALE_RUN_MS so the slot is never blocked forever (the rerun is a cache hit).
//
// Run record: the existing job_run table (job_key 'wacc-credit-rating.collect', trigger 'manual', actor = calling
// user, env NULL, detail_json {project_id, company_id, corp_code}). No schema change.
//
// Concurrency: one run per project AND one run per company (DART evidence is shared across projects, so a second
// project asking for the same company waits) -> 409 already_running.
import type { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { finishJobRun } from "../../../scripts/co-newbiz/scheduler-core.ts";
import { sweepStaleRuns, toRun, type BetaCollectRun, type RunRow } from "./beta-collection-runner.ts";
import {
  DEFAULT_CREDIT_RATING_DEPS,
  collectCreditRating,
  type CreditRatingCollectorDeps,
} from "./credit-rating-collector.ts";
import { isDartConfigured } from "./dart-client.ts";

type Db = ReturnType<typeof getDb>;

export const CREDIT_RATING_COLLECT_JOB_KEY = "wacc-credit-rating.collect";

export type StartCreditRatingCollection =
  | { kind: "started"; runId: string; startedAt: string }
  | { kind: "already_running"; runId: string }
  | { kind: "missing_api_key" }
  | { kind: "invalid"; code: "no_company" | "no_dart_corp_code"; message: string };

interface TestHooks {
  deps?: Partial<CreditRatingCollectorDeps>;
  /** Pretend the DART key is (not) configured. */
  dartConfigured?: boolean;
}
let testHooks: TestHooks = {};
/** Test seam only: inject the DART fetchers / key state. Pass {} to reset. */
export function setCreditRatingCollectionTestHooks(hooks: TestHooks): void {
  testHooks = hooks;
}

const inflight = new Set<Promise<void>>();
/** Test seam: resolves when every background collection started by this process has settled. */
export async function creditRatingCollectionIdle(): Promise<void> {
  await Promise.allSettled([...inflight]);
}

function detailOf(json: string | null): { project_id?: string; corp_code?: string } {
  if (!json) return {};
  try {
    return JSON.parse(json) as { project_id?: string; corp_code?: string };
  } catch {
    return {};
  }
}

/**
 * Validate, claim the slot and start the collection in the background. Synchronous up to the point the job_run row
 * exists (no await between the running-check and the INSERT, so two requests in one process cannot both pass).
 * `companyId` is the subject (or per-target) company the caller already resolved against project visibility.
 */
export function startCreditRatingCollection(
  db: Db,
  input: { projectId: string; companyId: string | null; actor: string; now?: Date },
): StartCreditRatingCollection {
  const now = input.now ?? new Date();
  if (!input.companyId) {
    return { kind: "invalid", code: "no_company", message: "No subject company is set." };
  }
  const company = db.query("SELECT dart_corp_code FROM md_company WHERE id = ?").get(input.companyId) as
    | { dart_corp_code: string | null }
    | undefined;
  const corpCode = company?.dart_corp_code ?? null;
  if (!corpCode) {
    return { kind: "invalid", code: "no_dart_corp_code", message: "The company has no DART corp code." };
  }
  if (!(testHooks.dartConfigured ?? isDartConfigured())) return { kind: "missing_api_key" };

  sweepStaleRuns(db, CREDIT_RATING_COLLECT_JOB_KEY, now);
  const running = db
    .query("SELECT id, detail_json FROM job_run WHERE job_key = ? AND status = 'running' ORDER BY started_at, id")
    .all(CREDIT_RATING_COLLECT_JOB_KEY) as Array<{ id: string; detail_json: string | null }>;
  const same = running.find((r) => {
    const d = detailOf(r.detail_json);
    return d.project_id === input.projectId || d.corp_code === corpCode;
  });
  if (same) return { kind: "already_running", runId: same.id };

  const runId = ulid();
  const startedAt = now.toISOString();
  db.run(
    `INSERT INTO job_run (id, job_key, started_at, status, "trigger", actor, attempt, detail_json) VALUES (?, ?, ?, 'running', 'manual', ?, 1, ?)`,
    [
      runId,
      CREDIT_RATING_COLLECT_JOB_KEY,
      startedAt,
      input.actor,
      JSON.stringify({ project_id: input.projectId, company_id: input.companyId, corp_code: corpCode }),
    ],
  );
  const task: Promise<void> = executeRun(db, runId, input.projectId, corpCode)
    .catch(() => {})
    .finally(() => inflight.delete(task));
  inflight.add(task);
  return { kind: "started", runId, startedAt };
}

async function executeRun(db: Db, runId: string, projectId: string, corpCode: string): Promise<void> {
  try {
    const deps = { ...DEFAULT_CREDIT_RATING_DEPS, ...testHooks.deps };
    const r = await collectCreditRating(db, corpCode, new Date(), deps);
    finishJobRun(db, runId, {
      status: "success",
      now: new Date(),
      rowsRead: r.bdrs_filings + (r.report_fetched ? 1 : 0),
      rowsWritten: r.bdrs_snapshots_written + (r.report_fetched ? 1 : 0),
      detail: {
        project_id: projectId,
        corp_code: corpCode,
        report_rcept_no: r.report_rcept_no,
        report_status: r.report_status,
        report_fetched: r.report_fetched,
        bdrs_filings: r.bdrs_filings,
        bdrs_snapshots_written: r.bdrs_snapshots_written,
        warnings: r.warnings,
      },
    });
  } catch (err) {
    finishJobRun(db, runId, {
      status: "failed",
      now: new Date(),
      error: err instanceof Error ? err.message : String(err),
      detail: { project_id: projectId, corp_code: corpCode, code: "credit_rating_collect_failed" },
    });
  }
}

/** Latest credit-rating collection run recorded for the project (null when none). */
export function latestCreditRatingCollectionRun(
  db: Db,
  projectId: string,
  now: Date = new Date(),
): BetaCollectRun | null {
  sweepStaleRuns(db, CREDIT_RATING_COLLECT_JOB_KEY, now);
  const row = db
    .query(
      `SELECT id, status, started_at, finished_at, error, detail_json FROM job_run
       WHERE job_key = ? AND json_extract(detail_json, '$.project_id') = ?
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(CREDIT_RATING_COLLECT_JOB_KEY, projectId) as RunRow | undefined;
  return row ? toRun(row) : null;
}
