#!/usr/bin/env bun
// @version 1.0.0
/**
 * watch:run — the OS-scheduler-driven monitoring cycle (design v1.0 §4-3,
 * ADR-0019, FR-MON-01, Wave 5.4). NEVER run from an in-process timer (an
 * app-lifetime timer dies with the app); this command is meant to be
 * registered as a `schedule_job` and invoked by Task Scheduler / a systemd
 * timer, per FR-MON-01.
 *
 * Pipeline per design §4-3, scoped to what Stage 5 has actually built so
 * far (honest about the gap, not papering over it):
 *   [1] fetch          -- NOT this wave's job. `ensure_fresh()` (Wave 5.2)
 *                          and a live fetch CLI land in a later wave; this
 *                          command reads whatever is already in
 *                          data_change_log, it does not populate it.
 *   [2] impact          changed series -> referenced 'live' assumption on
 *                        the project's latest run -> target project. No
 *                        change for a project -> that project is skipped,
 *                        not re-run "just in case" (design's own rule).
 *   [3] auto re-run      the `model` command (assembling a full financial
 *                        model from live data) does not exist yet either.
 *                        This wave re-runs the RAG ASSESSMENT via
 *                        assessScenario() using a caller-supplied updated
 *                        scenario for the changed project (--rescenarios-dir)
 *                        -- the same scenario shape the `rag` command takes.
 *                        A project with a detected change but no supplied
 *                        rescenario is reported as changed-but-not-reassessed,
 *                        not silently skipped.
 *   [4] RAG transition   assessScenario()/assessRun() already detect this.
 *   [5]-[6] notify        db/lib/watch-engine.ts evaluates watch_rule rows
 *                        and records notification rows (bundle: immediate
 *                        vs daily) -- actual email/webhook delivery is a
 *                        transport-layer concern for Wave 5.6/5.9.
 *
 * Usage:
 *   bun scripts/co-newbiz/watch-run.ts [--rescenarios-dir <dir>] [--db-path <path>]
 *
 * --rescenarios-dir points at a directory of `<project_no>.json` files,
 * each shaped like the `rag` command's scenario JSON (docs in rag.ts).
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join, basename, extname } from "node:path";
import type { Database } from "bun:sqlite";
import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { assessScenario, type RagScenario, type RagCliResult } from "./rag.ts";
import { evaluateTransitionNotifications, evaluateKillCriteriaNotifications } from "../../db/lib/watch-engine.ts";
import type { RagGrade } from "../../db/lib/rag-engine.ts";

const JOB_KEY = "watch:run";

export interface WatchCycleProjectResult {
  projectId: string;
  projectNo: string;
  changed: boolean;
  reassessed: boolean;
  ragResult?: RagCliResult;
  notificationsFired: number;
  notificationsSuppressed: number;
  killCriteriaNotifications: number;
}

export interface WatchCycleResult {
  jobRunId: string;
  projects: WatchCycleProjectResult[];
}

export interface RunWatchCycleOptions {
  now: string;
  /** project_no -> updated scenario, used only when a relevant change was detected for that project. */
  rescenarios?: Record<string, RagScenario>;
}

function jobRunStart(db: Database, now: string): string {
  const id = ulid();
  db.run("INSERT INTO job_run (id, job_key, started_at, status) VALUES (?,?,?,'running')", [id, JOB_KEY, now]);
  return id;
}

function jobRunFinish(db: Database, jobRunId: string, now: string, status: "success" | "failed", error?: string): void {
  db.run("UPDATE job_run SET finished_at = ?, status = ?, error = ? WHERE id = ?", [now, status, error ?? null, jobRunId]);
}

/**
 * Core watch cycle, DB-object-based (no filesystem dependency) so it is
 * directly unit-testable. The CLI entrypoint below loads rescenarios from
 * disk and calls this.
 */
export function runWatchCycle(db: Database, options: RunWatchCycleOptions): WatchCycleResult {
  const jobRunId = jobRunStart(db, options.now);
  const projects: WatchCycleProjectResult[] = [];

  try {
    const watchedProjectIds = (
      db.query("SELECT DISTINCT project_id FROM watch").all() as { project_id: string }[]
    ).map((r) => r.project_id);

    for (const projectId of watchedProjectIds) {
      const project = db.query("SELECT project_no FROM md_project WHERE id = ?").get(projectId) as { project_no: string } | null;
      if (!project) continue; // dangling watch row — nothing to report against.

      const watches = db
        .query("SELECT id, last_checked_at FROM watch WHERE project_id = ?")
        .all(projectId) as { id: string; last_checked_at: string | null }[];
      // Use the earliest watermark among this project's watches so a newer
      // watch never misses a change an older watch already consumed.
      const watermark = watches.reduce<string>((min, w) => {
        const at = w.last_checked_at ?? "";
        return at < min ? at : min;
      }, watches[0]?.last_checked_at ?? "");

      const latestRun = db
        .query("SELECT id FROM run WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(projectId) as { id: string } | null;

      const anchorRefs = latestRun
        ? ((db
            .query("SELECT DISTINCT anchor_ref FROM assumption WHERE run_id = ? AND kind = 'live' AND anchor_ref IS NOT NULL")
            .all(latestRun.id) as { anchor_ref: string }[]).map((r) => r.anchor_ref))
        : [];

      let changed = false;
      if (anchorRefs.length > 0) {
        const placeholders = anchorRefs.map(() => "?").join(",");
        const changeCount = db
          .query(`SELECT COUNT(*) AS c FROM data_change_log WHERE series_id IN (${placeholders}) AND detected_at > ?`)
          .get(...anchorRefs, watermark) as { c: number };
        changed = changeCount.c > 0;
      }

      const result: WatchCycleProjectResult = {
        projectId,
        projectNo: project.project_no,
        changed,
        reassessed: false,
        notificationsFired: 0,
        notificationsSuppressed: 0,
        killCriteriaNotifications: 0,
      };

      const rescenario = options.rescenarios?.[project.project_no];
      if (changed && rescenario) {
        const ragResult = assessScenario(db, rescenario, { runLabelPrefix: "auto", createdBy: "watch:run" });
        result.ragResult = ragResult;
        result.reassessed = true;

        if (ragResult.transition) {
          const notif = evaluateTransitionNotifications(db, {
            projectId,
            ragTransitionId: findTransitionId(db, ragResult.run_id),
            fromGrade: ragResult.transition.from as RagGrade | null,
            toGrade: ragResult.transition.to as RagGrade,
            now: options.now,
          });
          result.notificationsFired += notif.fired.length;
          result.notificationsSuppressed += notif.suppressedByCooldown.length;
        }
        if (rescenario.kill_criteria) {
          const killNotif = evaluateKillCriteriaNotifications(db, { projectId, runId: ragResult.run_id, now: options.now });
          result.killCriteriaNotifications = killNotif.length;
        }
      }

      // "Checked as of now" holds regardless of outcome.
      db.run("UPDATE watch SET last_checked_at = ? WHERE project_id = ?", [options.now, projectId]);
      projects.push(result);
    }

    jobRunFinish(db, jobRunId, options.now, "success");
  } catch (err) {
    jobRunFinish(db, jobRunId, options.now, "failed", (err as Error).message);
    throw err;
  }

  return { jobRunId, projects };
}

function findTransitionId(db: Database, runId: string): string {
  const row = db.query("SELECT id FROM rag_transition WHERE run_id = ? ORDER BY at DESC LIMIT 1").get(runId) as { id: string } | null;
  if (!row) {
    throw new Error(`assessScenario reported a transition but no rag_transition row exists for run ${runId} — invariant violation.`);
  }
  return row.id;
}

export function loadRescenariosDir(dir: string): Record<string, RagScenario> {
  const absDir = resolve(dir);
  if (!existsSync(absDir)) {
    throw new Error(`Rescenarios directory not found: ${absDir}`);
  }
  const out: Record<string, RagScenario> = {};
  for (const file of readdirSync(absDir)) {
    if (extname(file) !== ".json") continue;
    const scenario: RagScenario = JSON.parse(readFileSync(join(absDir, file), "utf-8"));
    const projectNo = scenario.project_no ?? basename(file, ".json");
    out[projectNo] = scenario;
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf("--rescenarios-dir");
  const dbPathIdx = argv.indexOf("--db-path");
  const dbPath = dbPathIdx >= 0 ? argv[dbPathIdx + 1] : undefined;
  const db = getDb(dbPath);
  const rescenarios = dirIdx >= 0 ? loadRescenariosDir(argv[dirIdx + 1]) : undefined;
  try {
    const result = runWatchCycle(db, { now: new Date().toISOString(), rescenarios });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`watch:run failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
