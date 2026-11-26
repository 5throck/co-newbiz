// @version 1.0.0
// Pure view helpers for the S8 background-generation progress block. Mirrors the run view returned by
// GET /api/projects/[id]/business-case/generate (latest run) and .../generate/[runId] — see
// lib/business-case-run.ts (generationRunView). No React, no i18n: labels are resolved by the caller.

export type GenerationActivityStatus = "waiting" | "running" | "done" | "failed" | "skipped";

export interface GenerationActivity {
  activityId: string;
  agentKey: string;
  status: GenerationActivityStatus;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface GenerationRun {
  runId: string;
  /** Run status: running | done | failed. */
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  failed_activity: string | null;
  activities: GenerationActivity[];
  progress: { total: number; done: number; running: number; failed: number };
}

const ACTIVITY_STATUSES: readonly string[] = ["waiting", "running", "done", "failed", "skipped"];

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Parse a run view from an API payload; null when it is not a run (e.g. `{ run: null }`). */
export function parseGenerationRun(raw: unknown): GenerationRun | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const runId = str(r.runId);
  const status = str(r.status);
  const startedAt = str(r.started_at);
  if (!runId || !status || !startedAt) return null;
  const activities: GenerationActivity[] = [];
  if (Array.isArray(r.activities)) {
    for (const a of r.activities) {
      if (!a || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      const activityId = str(o.activityId);
      if (!activityId) continue;
      activities.push({
        activityId,
        agentKey: str(o.agentKey) ?? "",
        status: ACTIVITY_STATUSES.includes(String(o.status)) ? (o.status as GenerationActivityStatus) : "waiting",
        started_at: str(o.started_at),
        finished_at: str(o.finished_at),
        error: str(o.error),
      });
    }
  }
  const count = (s: GenerationActivityStatus) => activities.filter((a) => a.status === s).length;
  return {
    runId,
    status,
    started_at: startedAt,
    finished_at: str(r.finished_at),
    error: str(r.error),
    failed_activity: str(r.failed_activity),
    activities,
    progress: { total: activities.length, done: count("done"), running: count("running"), failed: count("failed") },
  };
}

export interface ParsedActivityId {
  /** Brownfield target id prefix; null for the project-level (greenfield) set. */
  targetId: string | null;
  scenario: string;
  variant: string;
  step: string;
}

/** Activity ids are `[targetId/]scenario:variant:step` (lib/business-case-generator.ts); null when unrecognised. */
export function parseActivityId(activityId: string): ParsedActivityId | null {
  const slash = activityId.lastIndexOf("/");
  const targetId = slash >= 0 ? activityId.slice(0, slash) : null;
  const parts = (slash >= 0 ? activityId.slice(slash + 1) : activityId).split(":");
  if (parts.length !== 3 || parts.some((p) => p === "")) return null;
  return { targetId, scenario: parts[0], variant: parts[1], step: parts[2] };
}

/** m:ss elapsed text; "" while the activity has not started. `nowMs` drives the running activity's clock. */
export function elapsedText(a: Pick<GenerationActivity, "started_at" | "finished_at">, nowMs: number): string {
  if (!a.started_at) return "";
  const start = Date.parse(a.started_at);
  if (Number.isNaN(start)) return "";
  const end = a.finished_at ? Date.parse(a.finished_at) : nowMs;
  const secs = Math.max(0, Math.floor(((Number.isNaN(end) ? nowMs : end) - start) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function isRunInProgress(run: GenerationRun | null): boolean {
  return run?.status === "running";
}
