// @version 1.0.0
// In-app KOFIA grade-yield collection (POST /api/projects/[id]/wacc/kofia/collect), ADR-0208 slice 4.
//
// Same async/202 model as the ECOS collection (job_run, job_key 'wacc-kofia.collect', trigger 'manual', actor = calling
// user, detail_json.project_id for the audit trail). The data is market-common, so the slot and the status are GLOBAL:
// one collection at a time (409 already_running) and every member sees the latest run.
//
// GATED: start returns {kind:"disabled"} - and the collector itself refuses - unless CO_NEWBIZ_KOFIA_COLLECT is "on"
// (default off, pending KOFIA's written confirmation; see kofia-collector.ts). No job_run row is written when disabled.
import type { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { finishJobRun } from "../../../scripts/co-newbiz/scheduler-core.ts";
import { sweepStaleRuns, toRun, type BetaCollectRun, type RunRow } from "./beta-collection-runner.ts";
import {
  DEFAULT_KOFIA_DEPS,
  collectKofiaGradeYields,
  kofiaCollectEnabled,
  type KofiaCollectorDeps,
} from "./kofia-collector.ts";

type Db = ReturnType<typeof getDb>;

export const KOFIA_COLLECT_JOB_KEY = "wacc-kofia.collect";

export type StartKofiaCollection =
  | { kind: "started"; runId: string; startedAt: string }
  | { kind: "already_running"; runId: string }
  | { kind: "disabled" };

interface TestHooks {
  deps?: Partial<KofiaCollectorDeps>;
}
let testHooks: TestHooks = {};
/** Test seam only: inject the transport. Pass {} to reset. */
export function setKofiaCollectionTestHooks(hooks: TestHooks): void {
  testHooks = hooks;
}

const inflight = new Set<Promise<void>>();
/** Test seam: resolves when every background collection started by this process has settled. */
export async function kofiaCollectionIdle(): Promise<void> {
  await Promise.allSettled([...inflight]);
}

export function startKofiaCollection(
  db: Db,
  input: { projectId: string; actor: string; now?: Date },
): StartKofiaCollection {
  const now = input.now ?? new Date();
  if (!kofiaCollectEnabled()) return { kind: "disabled" };
  sweepStaleRuns(db, KOFIA_COLLECT_JOB_KEY, now);
  const running = db
    .query("SELECT id FROM job_run WHERE job_key = ? AND status = 'running' ORDER BY started_at, id LIMIT 1")
    .get(KOFIA_COLLECT_JOB_KEY) as { id: string } | undefined;
  if (running) return { kind: "already_running", runId: running.id };

  const runId = ulid();
  const startedAt = now.toISOString();
  db.run(
    `INSERT INTO job_run (id, job_key, started_at, status, "trigger", actor, attempt, detail_json) VALUES (?, ?, ?, 'running', 'manual', ?, 1, ?)`,
    [runId, KOFIA_COLLECT_JOB_KEY, startedAt, input.actor, JSON.stringify({ project_id: input.projectId })],
  );
  const task: Promise<void> = (async () => {
    try {
      const deps = { ...DEFAULT_KOFIA_DEPS, ...testHooks.deps };
      const r = await collectKofiaGradeYields(db, new Date(), deps);
      finishJobRun(db, runId, {
        status: "success",
        now: new Date(),
        rowsRead: 3,
        rowsWritten: r.grades_written + 1,
        rowsChanged: r.rows_changed,
        detail: {
          project_id: input.projectId,
          date: r.date,
          ktb_pct: r.ktb_pct,
          grades_written: r.grades_written,
          rows_changed: r.rows_changed,
          warnings: r.warnings,
          source_url: r.source_url,
        },
      });
    } catch (err) {
      finishJobRun(db, runId, {
        status: "failed",
        now: new Date(),
        error: err instanceof Error ? err.message : String(err),
        detail: { project_id: input.projectId, code: "kofia_collect_failed" },
      });
    }
  })()
    .catch(() => {})
    .finally(() => inflight.delete(task));
  inflight.add(task);
  return { kind: "started", runId, startedAt };
}

/** Latest KOFIA collection run (global); null when none. */
export function latestKofiaCollectionRun(db: Db, now: Date = new Date()): BetaCollectRun | null {
  sweepStaleRuns(db, KOFIA_COLLECT_JOB_KEY, now);
  const row = db
    .query(
      `SELECT id, status, started_at, finished_at, error, detail_json FROM job_run
       WHERE job_key = ? ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(KOFIA_COLLECT_JOB_KEY) as RunRow | undefined;
  return row ? toRun(row) : null;
}
