// @version 1.0.0
// Background S8 business-case generation (POST /api/projects/[id]/business-case/generate).
//
// Execution model — ASYNC (202 + poll), on the existing process_run / activity_run / agent_run model
// (ADR-0096 / ADR-0098 §3). The route only claims the project's run slot (inserts the process_run row)
// and returns; the 3-scenario chain then runs detached from the request in the long-lived server
// process, so a browser refresh, a closed tab or a tunnel timeout (Cloudflare cuts long requests)
// cannot interrupt it. The client resumes by asking for the latest run and polling the status route.
//
// Nothing here honours request.signal: the generator was never tied to the request lifecycle, but it
// used to be AWAITED by the request, which is what the UI could not survive (the runId and "busy"
// state lived only in the page's React state, and a second press after a reload started a duplicate
// run). Detaching removes the coupling altogether.
//
// Concurrency: one run per project (409 already_running, with the running run's id). Orphans — a
// 'running' run whose server process died — are failed by sweepStaleGenerationRuns (anything started
// before this process booted, or older than GENERATION_STALE_MS), so a crash mid-run leaves a FAILED
// run, never a ghost "running" row that blocks the project forever.
//
// Writes PROPOSALS only (generator contract, boundary #2): never an adoption marker or gate_decision.
import { getDb } from "../../../db/client.ts";
import { insertProcessRun, nowIso } from "./agent-orchestrator.ts";
import { generateBusinessCases, mergeRunMeta, processBootedAt } from "./business-case-generator.ts";

export const S8_GENERATION_STAGE = "s8_business_case_generation";
/** A 'running' generation older than this is hung or orphaned — failed by the sweep. */
export const GENERATION_STALE_MS = 30 * 60 * 1000;
const MAX_ERROR_CHARS = 500;
const STALE_MESSAGE = "timeout_or_crash: the generation did not finish (server restarted or hung) — start it again.";

export type StartGeneration =
  | { kind: "started"; runId: string; startedAt: string }
  | { kind: "already_running"; runId: string }
  | { kind: "already_run"; runId: string };

interface TestHooks {
  /** Generator override (fast / failing / blocking stubs); production runs the real generateBusinessCases. */
  generate?: (
    projectId: string,
    opts: { actor: string; source?: string; processRunId: string; yieldBetweenActivities?: boolean },
  ) => Promise<unknown>;
}
let testHooks: TestHooks = {};
/** Test seam only: inject the generator. Pass {} to reset. */
export function setBusinessCaseRunTestHooks(hooks: TestHooks): void {
  testHooks = hooks;
}

const inflight = new Set<Promise<void>>();
/** Test seam: resolves when every background generation started by this process has settled. */
export async function businessCaseGenerationIdle(): Promise<void> {
  await Promise.allSettled([...inflight]);
}

/** Settle a run (and its still-'running' activity rows) as failed with `message` — only while it is 'running'. */
function failRun(runId: string, message: string, now: string = nowIso()): void {
  const db = getDb();
  const run = db.query("SELECT status FROM process_run WHERE id = ?").get(runId) as { status: string } | undefined;
  if (run?.status !== "running") return;
  const open = db
    .query(
      "SELECT activity_id FROM activity_run WHERE process_run_id = ? AND status = 'running' ORDER BY started_at, id",
    )
    .all(runId) as Array<{ activity_id: string }>;
  db.run("UPDATE activity_run SET status = 'failed', finished_at = ? WHERE process_run_id = ? AND status = 'running'", [
    now,
    runId,
  ]);
  db.run("UPDATE agent_run SET status = 'failed', finished_at = ? WHERE process_run_id = ? AND status = 'running'", [
    now,
    runId,
  ]);
  db.run("UPDATE process_run SET status = 'failed', finished_at = ? WHERE id = ?", [now, runId]);
  mergeRunMeta(runId, {
    error: message.slice(0, MAX_ERROR_CHARS),
    ...(open[0] ? { failed_activity: open[0].activity_id } : {}),
  });
}

/** Fail 'running' generation runs that can no longer finish (previous process / outlived the cap). */
export function sweepStaleGenerationRuns(now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - GENERATION_STALE_MS).toISOString();
  const stale = getDb()
    .query(`SELECT id FROM process_run WHERE stage = ? AND status = 'running' AND (started_at < ? OR started_at < ?)`)
    .all(S8_GENERATION_STAGE, processBootedAt(), cutoff) as Array<{ id: string }>;
  for (const r of stale) failRun(r.id, STALE_MESSAGE, now.toISOString());
  return stale.length;
}

/**
 * Claim the project's slot and start the generation in the background. Synchronous up to (and
 * including) the process_run INSERT — no await between the running-check and the INSERT, so two
 * requests in one process cannot both pass. `regenerate` bypasses the already-run guard (a NEW run)
 * but never the running guard.
 */
export function startBusinessCaseGeneration(input: {
  projectId: string;
  actor: string;
  regenerate: boolean;
  source?: string;
  now?: Date;
}): StartGeneration {
  const db = getDb();
  sweepStaleGenerationRuns(input.now ?? new Date());

  const running = db
    .query(
      `SELECT id FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = ? AND status = 'running'
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(input.projectId, S8_GENERATION_STAGE) as { id: string } | undefined;
  if (running) return { kind: "already_running", runId: running.id };

  if (!input.regenerate) {
    const existing = db
      .query(
        `SELECT id FROM process_run
         WHERE entity_type = 'project' AND entity_id = ? AND stage = ? AND status != 'failed'
         ORDER BY started_at DESC, id DESC LIMIT 1`,
      )
      .get(input.projectId, S8_GENERATION_STAGE) as { id: string } | undefined;
    if (existing) return { kind: "already_run", runId: existing.id };
  }

  const source = input.source ?? "web";
  const runId = insertProcessRun({ entityType: "project", entityId: input.projectId }, S8_GENERATION_STAGE, {
    actor: input.actor,
    source,
  });
  const startedAt = (db.query("SELECT started_at FROM process_run WHERE id = ?").get(runId) as { started_at: string })
    .started_at;

  const task: Promise<void> = (async () => {
    // Let the request answer 202 before the first (synchronous, possibly heavy) generator step.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      await (testHooks.generate ?? generateBusinessCases)(input.projectId, {
        actor: input.actor,
        source,
        processRunId: runId,
        yieldBetweenActivities: true,
      });
      failRun(runId, "The generation ended without finishing the run.");
    } catch (err) {
      failRun(runId, err instanceof Error ? err.message : String(err));
    }
  })()
    .catch(() => {})
    .finally(() => inflight.delete(task));
  inflight.add(task);
  return { kind: "started", runId, startedAt };
}

// ── Status view (shared by GET .../generate and GET .../generate/[runId]) ───

export type GenerationActivityStatus = "waiting" | "running" | "done" | "failed" | "skipped";

export interface GenerationActivityView {
  activityId: string;
  agentKey: string;
  status: GenerationActivityStatus;
  started_at: string | null;
  finished_at: string | null;
  outputMd: string | null;
  /** Failure reason of the failing activity (from the run's meta); null otherwise. */
  error: string | null;
}

export interface GenerationRunView {
  runId: string;
  status: string;
  stage: string;
  started_at: string;
  finished_at: string | null;
  /** Run-level failure reason (a pre-chain error, a failed activity's error, or the stale sweep); null unless failed. */
  error: string | null;
  failed_activity: string | null;
  recommended_scenario: string | null;
  activities: GenerationActivityView[];
  progress: { total: number; done: number; running: number; failed: number };
}

export interface GenerationRunRow {
  id: string;
  status: string;
  stage: string;
  started_at: string;
  finished_at: string | null;
  meta_json: string | null;
}

interface ActivityRow {
  activity_id: string;
  status: string;
  output_md: string | null;
  agent_key: string;
  started_at: string;
  finished_at: string | null;
}

interface RunMeta {
  planned?: Array<{ activityId?: unknown; agentKey?: unknown }>;
  recommended_scenario?: unknown;
  failed_activity?: unknown;
  error?: unknown;
}

function parseMeta(metaJson: string | null): RunMeta {
  if (!metaJson) return {};
  try {
    const v = JSON.parse(metaJson) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as RunMeta) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * Run status with per-activity progress. Planned activities that have not started are "waiting"
 * (or "skipped" once the run is over without reaching them — the chain stops at the first failure).
 */
export function generationRunView(run: GenerationRunRow): GenerationRunView {
  const meta = parseMeta(run.meta_json);
  const actual = getDb()
    .query(
      `SELECT a.activity_id, a.status, a.output_md, r.agent_key, a.started_at, a.finished_at
       FROM activity_run a JOIN agent_run r ON r.process_run_id = a.process_run_id AND r.activity_id = a.activity_id
       WHERE a.process_run_id = ? ORDER BY a.started_at, a.id`,
    )
    .all(run.id) as unknown as ActivityRow[];
  const byId = new Map(actual.map((a) => [a.activity_id, a]));
  const failedActivity = str(meta.failed_activity);
  const runError = str(meta.error);
  const terminal = run.status !== "running";

  const fromRow = (a: ActivityRow): GenerationActivityView => ({
    activityId: a.activity_id,
    agentKey: a.agent_key,
    status: a.status === "running" || a.status === "done" || a.status === "failed" ? a.status : "failed",
    started_at: a.started_at,
    finished_at: a.finished_at,
    outputMd: a.output_md,
    error: a.status === "failed" && a.activity_id === failedActivity ? runError : null,
  });

  const activities: GenerationActivityView[] = [];
  const seen = new Set<string>();
  for (const p of meta.planned ?? []) {
    const activityId = str(p.activityId);
    if (!activityId || seen.has(activityId)) continue;
    seen.add(activityId);
    const row = byId.get(activityId);
    activities.push(
      row
        ? fromRow(row)
        : {
            activityId,
            agentKey: str(p.agentKey) ?? "",
            status: terminal ? "skipped" : "waiting",
            started_at: null,
            finished_at: null,
            outputMd: null,
            error: null,
          },
    );
  }
  for (const a of actual) if (!seen.has(a.activity_id)) activities.push(fromRow(a));

  const count = (s: GenerationActivityStatus) => activities.filter((a) => a.status === s).length;
  return {
    runId: run.id,
    status: run.status,
    stage: run.stage,
    started_at: run.started_at,
    finished_at: run.finished_at,
    error: run.status === "failed" ? runError : null,
    failed_activity: failedActivity,
    recommended_scenario: str(meta.recommended_scenario),
    activities,
    progress: { total: activities.length, done: count("done"), running: count("running"), failed: count("failed") },
  };
}

/**
 * Latest generation run of the project (any status) as a status view; null when none. The polled
 * progress view omits the per-activity artifacts (outputMd) — the full run status route has them.
 */
export function latestGenerationRun(projectId: string, now: Date = new Date()): GenerationRunView | null {
  sweepStaleGenerationRuns(now);
  const row = getDb()
    .query(
      `SELECT id, status, stage, started_at, finished_at, meta_json FROM process_run
       WHERE entity_type = 'project' AND entity_id = ? AND stage = ?
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId, S8_GENERATION_STAGE) as GenerationRunRow | undefined;
  if (!row) return null;
  const view = generationRunView(row);
  return { ...view, activities: view.activities.map((a) => ({ ...a, outputMd: null })) };
}
