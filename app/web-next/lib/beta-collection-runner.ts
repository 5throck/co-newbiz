// @version 1.0.0
// In-app KRX beta-series collection (POST /api/projects/[id]/wacc/beta-series/collect).
//
// Execution model — ASYNC (202 + poll). The CLI's default range is the last 13 months; every
// (service, weekday) is one KRX call paced at >=250 ms (source-adapters.ts), so a cold run is hundreds of
// calls = minutes, far beyond a request timeout. The route therefore only records a job_run row and returns;
// the work runs in-process in the long-lived Next/Bun server (same code as the CLI: runBetaCollection in
// scripts/co-newbiz/beta-series-core.ts — no spawn, no second implementation) and the UI polls the status.
//
// This is a user-triggered one-off, NOT a scheduler: ADR-0019's "no in-process timers" rule is untouched —
// nothing here schedules anything. A server restart mid-run orphans the row; the stale sweep below fails it
// after STALE_RUN_MS so the project is never blocked forever (ensure_fresh makes the rerun a cache-hit).
//
// Run record: the existing job_run table (job_key 'beta-series.collect', trigger 'manual', actor = calling
// user, env NULL so the scheduler's own sweep/health queries never touch it, detail_json.project_id for the
// per-project lookup). No schema change.
//
// Concurrency: one run per project (409 already_running) and ONE run at a time per server process
// (409 collection_busy) — the KRX adapter's run state (budget/stats/pacing) is module-global, so two
// concurrent runs would corrupt each other's counters.
import { finishJobRun } from "../../../scripts/co-newbiz/scheduler-core.ts";
import {
  type BetaCollectionOptions,
  type BetaCollectionResult,
  BetaSeriesError,
  krxApiKeyAvailable,
  resolveBetaCompanies,
  runBetaCollection,
} from "../../../scripts/co-newbiz/beta-series-core.ts";
import { fetchSource } from "../../../scripts/co-newbiz/jobs/collect/fetch-source.ts";
import { SOURCE_ADAPTERS } from "../../../scripts/co-newbiz/source-adapters.ts";
import { CORP_BOND_BBBM_SERIES_ID, CORP_BOND_SERIES_ID, RF_SERIES_ID } from "../../../db/lib/wacc-reference.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import type { getDb } from "../../../db/client.ts";

type Db = ReturnType<typeof getDb>;

export const BETA_COLLECT_JOB_KEY = "beta-series.collect";
/** ECOS market-rate collection for the WACC reference (risk-free / credit-spread). */
export const ECOS_COLLECT_JOB_KEY = "wacc-ecos.collect";
/** A 'running' row older than this is an orphan of a killed server — failed by the sweep. */
export const STALE_RUN_MS = 60 * 60 * 1000;
const MAX_WARNINGS_KEPT = 20;

export type BetaCollectRunStatus = "running" | "success" | "failed";

export interface BetaCollectRun {
  run_id: string;
  status: BetaCollectRunStatus;
  started_at: string;
  finished_at: string | null;
  /** Failure reason (secret-scrubbed, <= 2 KB); null unless failed. */
  error: string | null;
  /** Present once finished: observations written, KRX calls, cache hits, per-series counts. */
  result: Record<string, unknown> | null;
}

export type StartBetaCollection =
  | { kind: "started"; runId: string; startedAt: string }
  | { kind: "already_running"; runId: string }
  | { kind: "busy"; runId: string }
  | { kind: "missing_api_key" }
  | { kind: "invalid"; code: "project_not_found" | "no_company"; message: string };

export interface EcosCollectionResult {
  rowsUpserted: number;
  rowsChanged: number;
  series: Array<{ seriesId: string; rowsUpserted: number; failures: number }>;
  failures: Array<{ series_id: string; period?: string; message: string }>;
}

interface TestHooks {
  /** ECOS runner override (failure / gating tests); the success tests run the real fetchSource over a fetch stub. */
  ecosRun?: (db: Db) => Promise<EcosCollectionResult>;
  run?: (opts: BetaCollectionOptions) => Promise<BetaCollectionResult>;
  pacing?: BetaCollectionOptions["pacing"];
  from?: string;
  to?: string;
}
let testHooks: TestHooks = {};
/** Test seam only: inject the runner / pacing / range. Pass {} to reset. */
export function setBetaCollectionTestHooks(hooks: TestHooks): void {
  testHooks = hooks;
}

const inflight = new Set<Promise<void>>();
/** Test seam: resolves when every background collection started by this process has settled. */
export async function betaCollectionIdle(): Promise<void> {
  await Promise.allSettled([...inflight]);
}

/** Fail 'running' rows of `jobKey` that outlived STALE_RUN_MS (server killed mid-run). */
export function sweepStaleRuns(db: Db, jobKey: string, now: Date): number {
  const cutoff = new Date(now.getTime() - STALE_RUN_MS).toISOString();
  const res = db.run(
    `UPDATE job_run SET status = 'failed', finished_at = ?, error = 'timeout_or_crash: the run did not finish (server restarted or hung) — start it again.'
     WHERE job_key = ? AND status = 'running' AND started_at < ?`,
    [now.toISOString(), jobKey, cutoff],
  );
  return res.changes;
}

export function sweepStaleBetaRuns(db: Db, now: Date): number {
  return sweepStaleRuns(db, BETA_COLLECT_JOB_KEY, now);
}

function projectOf(detailJson: string | null): string | null {
  if (!detailJson) return null;
  try {
    const v = (JSON.parse(detailJson) as { project_id?: unknown }).project_id;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Validate, claim the per-project slot and start the collection in the background. Synchronous up to the
 * point the job_run row exists (no await between the running-check and the INSERT, so two requests in one
 * process cannot both pass). Errors the caller can fix come back as a result kind, never a throw.
 */
export function startBetaCollection(
  db: Db,
  input: { projectId: string; actor: string; now?: Date },
): StartBetaCollection {
  const now = input.now ?? new Date();
  if (!krxApiKeyAvailable()) return { kind: "missing_api_key" };
  try {
    resolveBetaCompanies(db, input.projectId);
  } catch (err) {
    if (err instanceof BetaSeriesError && (err.code === "project_not_found" || err.code === "no_company")) {
      return { kind: "invalid", code: err.code, message: err.message };
    }
    throw err;
  }

  sweepStaleBetaRuns(db, now);
  const running = db
    .query("SELECT id, detail_json FROM job_run WHERE job_key = ? AND status = 'running' ORDER BY started_at, id")
    .all(BETA_COLLECT_JOB_KEY) as Array<{ id: string; detail_json: string | null }>;
  const same = running.find((r) => projectOf(r.detail_json) === input.projectId);
  if (same) return { kind: "already_running", runId: same.id };
  if (running.length > 0) return { kind: "busy", runId: running[0].id };

  const runId = ulid();
  const startedAt = now.toISOString();
  db.run(
    `INSERT INTO job_run (id, job_key, started_at, status, "trigger", actor, attempt, detail_json) VALUES (?, ?, ?, 'running', 'manual', ?, 1, ?)`,
    [runId, BETA_COLLECT_JOB_KEY, startedAt, input.actor, JSON.stringify({ project_id: input.projectId })],
  );

  // executeRun records its own failures; the catch only keeps a bookkeeping error from becoming an
  // unhandled rejection in the server process.
  const task: Promise<void> = executeRun(db, runId, input.projectId)
    .catch(() => {})
    .finally(() => inflight.delete(task));
  inflight.add(task);
  return { kind: "started", runId, startedAt };
}

async function executeRun(db: Db, runId: string, projectId: string): Promise<void> {
  const warnings: string[] = [];
  const keepWarning = (line: string) => {
    if (warnings.length < MAX_WARNINGS_KEPT) warnings.push(line.slice(0, 300));
  };
  try {
    const run = testHooks.run ?? runBetaCollection;
    const result = await run({
      projectId,
      db,
      from: testHooks.from,
      to: testHooks.to,
      pacing: testHooks.pacing,
      log: () => {},
      warn: keepWarning,
    });
    finishJobRun(db, runId, {
      status: "success",
      now: new Date(),
      rowsRead: result.krxCalls,
      rowsWritten: result.collected,
      detail: {
        project_id: projectId,
        collected: result.collected,
        krx_calls: result.krxCalls,
        cache_hits: result.cacheHits,
        empty_days: result.emptyDays,
        series: result.series,
        warnings,
      },
    });
  } catch (err) {
    finishJobRun(db, runId, {
      status: "failed",
      now: new Date(),
      error: err instanceof Error ? err.message : String(err),
      detail: {
        project_id: projectId,
        code: err instanceof BetaSeriesError ? err.code : "unexpected",
        warnings,
      },
    });
  }
}

interface RunRow {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  detail_json: string | null;
}

function toRun(row: RunRow): BetaCollectRun {
  let result: Record<string, unknown> | null = null;
  if (row.status === "success" && row.detail_json) {
    try {
      const { project_id: _omit, ...rest } = JSON.parse(row.detail_json) as Record<string, unknown>;
      result = rest;
    } catch {
      result = null;
    }
  }
  return {
    run_id: row.id,
    status: row.status === "running" || row.status === "success" ? row.status : "failed",
    started_at: row.started_at,
    finished_at: row.finished_at,
    error: row.error,
    result,
  };
}

/** Latest collection run recorded for the project (null when none). */
export function latestBetaCollectionRun(db: Db, projectId: string, now: Date = new Date()): BetaCollectRun | null {
  sweepStaleBetaRuns(db, now);
  const row = db
    .query(
      `SELECT id, status, started_at, finished_at, error, detail_json FROM job_run
       WHERE job_key = ? AND json_extract(detail_json, '$.project_id') = ?
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(BETA_COLLECT_JOB_KEY, projectId) as RunRow | undefined;
  return row ? toRun(row) : null;
}

// ── ECOS (WACC reference: risk-free rate + credit spread) ───────────────────
//
// The same async/202 model, recorded in job_run (job_key 'wacc-ecos.collect'). The ECOS series are
// market-common (not per-project), so the concurrency slot and the status are GLOBAL: one ECOS collection
// at a time (409 already_running for anyone asking meanwhile) and every member sees the latest run. The
// requesting project is kept in detail_json for the audit trail only. Scoped to the three series the WACC
// reference reads (RF_SERIES_ID / CORP_BOND_SERIES_ID / CORP_BOND_BBBM_SERIES_ID, ADR-0208) over the last 12
// months through fetchSource — the same library the CLI `fetch --source ecos` and the nightly collect.ecos job call. Months ECOS has not
// published yet fail as isolated per-period failures (kept as warnings); the run only fails when NOTHING
// landed.

export type StartEcosCollection =
  | { kind: "started"; runId: string; startedAt: string }
  | { kind: "already_running"; runId: string }
  | { kind: "missing_api_key" };

const ECOS_SERIES = [RF_SERIES_ID, CORP_BOND_SERIES_ID, CORP_BOND_BBBM_SERIES_ID] as const;
const ECOS_TIMEOUT_MS = 10 * 60 * 1000;

function ecosMonthRange(now: Date): { from: string; to: string } {
  const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return { to: ym(now), from: ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))) };
}

/** True when ECOS_API_KEY is available (loads the .env pipeline keys first). Never exposes the value. */
export function ecosApiKeyAvailable(): boolean {
  return SOURCE_ADAPTERS.ecos.isEnabled();
}

async function collectEcos(db: Db, now: Date): Promise<EcosCollectionResult> {
  const { from, to } = ecosMonthRange(now);
  const signal = AbortSignal.timeout(ECOS_TIMEOUT_MS);
  const out: EcosCollectionResult = { rowsUpserted: 0, rowsChanged: 0, series: [], failures: [] };
  for (const seriesArg of ECOS_SERIES) {
    const res = await fetchSource(db as never, "ecos", { seriesArg, fromArg: from, toArg: to, signal });
    if (!res.ok) {
      throw new Error(
        res.reason === "credential_missing"
          ? `${res.credentialEnv} is not set (.env) — nothing can be collected.`
          : `ECOS series '${seriesArg}' is not in the adapter catalog.`,
      );
    }
    out.rowsUpserted += res.rowsUpserted;
    out.rowsChanged += res.rowsChanged;
    out.series.push({ seriesId: seriesArg, rowsUpserted: res.rowsUpserted, failures: res.failures.length });
    for (const f of res.failures) {
      if (out.failures.length < MAX_WARNINGS_KEPT) {
        out.failures.push({
          series_id: f.seriesId,
          ...(f.period ? { period: f.period } : {}),
          message: f.message.slice(0, 300),
        });
      }
    }
  }
  if (out.rowsUpserted === 0) {
    const first = out.failures[0];
    throw new Error(
      `ECOS collection wrote 0 observations${first ? ` — first failure: ${first.series_id}${first.period ? `@${first.period}` : ""}: ${first.message}` : ""}`,
    );
  }
  return out;
}

export function startEcosCollection(
  db: Db,
  input: { projectId: string; actor: string; now?: Date },
): StartEcosCollection {
  const now = input.now ?? new Date();
  if (!ecosApiKeyAvailable()) return { kind: "missing_api_key" };
  sweepStaleRuns(db, ECOS_COLLECT_JOB_KEY, now);
  const running = db
    .query("SELECT id FROM job_run WHERE job_key = ? AND status = 'running' ORDER BY started_at, id LIMIT 1")
    .get(ECOS_COLLECT_JOB_KEY) as { id: string } | undefined;
  if (running) return { kind: "already_running", runId: running.id };

  const runId = ulid();
  const startedAt = now.toISOString();
  db.run(
    `INSERT INTO job_run (id, job_key, started_at, status, "trigger", actor, attempt, detail_json) VALUES (?, ?, ?, 'running', 'manual', ?, 1, ?)`,
    [runId, ECOS_COLLECT_JOB_KEY, startedAt, input.actor, JSON.stringify({ project_id: input.projectId })],
  );
  const task: Promise<void> = (async () => {
    try {
      const result = await (testHooks.ecosRun ?? ((d: Db) => collectEcos(d, new Date())))(db);
      finishJobRun(db, runId, {
        status: "success",
        now: new Date(),
        rowsWritten: result.rowsUpserted,
        rowsChanged: result.rowsChanged,
        detail: {
          project_id: input.projectId,
          rows_upserted: result.rowsUpserted,
          rows_changed: result.rowsChanged,
          series: result.series,
          warnings: result.failures,
        },
      });
    } catch (err) {
      finishJobRun(db, runId, {
        status: "failed",
        now: new Date(),
        error: err instanceof Error ? err.message : String(err),
        detail: { project_id: input.projectId, code: "ecos_failed" },
      });
    }
  })()
    .catch(() => {})
    .finally(() => inflight.delete(task));
  inflight.add(task);
  return { kind: "started", runId, startedAt };
}

/** Latest ECOS collection run (global — the series are market-common); null when none. */
export function latestEcosCollectionRun(db: Db, now: Date = new Date()): BetaCollectRun | null {
  sweepStaleRuns(db, ECOS_COLLECT_JOB_KEY, now);
  const row = db
    .query(
      `SELECT id, status, started_at, finished_at, error, detail_json FROM job_run
       WHERE job_key = ? ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(ECOS_COLLECT_JOB_KEY) as RunRow | undefined;
  return row ? toRun(row) : null;
}
