// @version 1.0.0
/**
 * Project-scoped WACC input session (Wave C1).
 *
 * The assumption table is run-scoped, so "project WACC" is resolved through
 * the latest run for the project. A confirmed user value is recorded twice:
 *   1. as immutable run_input (`wacc`, and optionally `hurdle_irr`) so model
 *      snapshots reproduce; and
 *   2. as assumption rows with kind='user' so FS kill criteria can prove a
 *      human explicitly confirmed the values.
 *
 * Missing WACC deliberately degrades to the historical 10% modeling default,
 * but the resolver labels that provenance as `default`, never as user input.
 */

import type { Database } from "bun:sqlite";
import { recordAssumption } from "./assumption.ts";
import { createRun } from "./versioning.ts";

export const DEFAULT_WACC = 0.1;

export interface WaccResolution {
  value: number;
  source: "user" | "run_input" | "default";
  assumption_id: string | null;
  run_id: string | null;
  as_of: string | null;
  rationale: string | null;
  anchor_ref: string | null;
}

export interface WaccSessionResult {
  run_id: string;
  wacc: WaccResolution;
  hurdle_irr: WaccResolution | null;
}

function assertRate(key: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= -1) {
    throw new Error(`${key} must be a finite rate greater than -1.`);
  }
}

function latestAssumption(db: Database, projectId: string, key: "wacc" | "hurdle_irr"): WaccResolution | null {
  const row = db
    .query(
      `SELECT a.id, a.run_id, a.value, a.as_of, a.rationale, a.anchor_ref
       FROM assumption a JOIN run r ON r.id = a.run_id
       WHERE r.project_id = ? AND a.assumption_key = ? AND a.kind = 'user'
       ORDER BY a.as_of DESC, r.created_at DESC, a.id DESC
       LIMIT 1`,
    )
    .get(projectId, key) as
    | { id: string; run_id: string; value: number; as_of: string; rationale: string | null; anchor_ref: string | null }
    | undefined;
  if (!row) return null;
  return {
    value: row.value,
    source: "user",
    assumption_id: row.id,
    run_id: row.run_id,
    as_of: row.as_of,
    rationale: row.rationale,
    anchor_ref: row.anchor_ref,
  };
}

function latestRunInput(db: Database, projectId: string, key: "wacc" | "hurdle_irr"): WaccResolution | null {
  const row = db
    .query(
      `SELECT r.id AS run_id, ri.value, r.created_at
       FROM run r JOIN run_input ri ON ri.run_id = r.id
       WHERE r.project_id = ? AND ri.assumption_key = ?
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 1`,
    )
    .get(projectId, key) as { run_id: string; value: number; created_at: string } | undefined;
  if (!row) return null;
  return {
    value: row.value,
    source: "run_input",
    assumption_id: null,
    run_id: row.run_id,
    as_of: row.created_at,
    rationale: "Versioned run_input exists without a user assumption row.",
    anchor_ref: null,
  };
}

export function resolveProjectWacc(db: Database, projectId: string): WaccResolution {
  return (
    latestAssumption(db, projectId, "wacc") ??
    latestRunInput(db, projectId, "wacc") ??
    {
      value: DEFAULT_WACC,
      source: "default",
      assumption_id: null,
      run_id: null,
      as_of: null,
      rationale: "Historical deterministic fallback; run the WACC input session before FS gate.",
      anchor_ref: null,
    }
  );
}

export function resolveProjectHurdleIrr(db: Database, projectId: string): WaccResolution | null {
  return latestAssumption(db, projectId, "hurdle_irr") ?? latestRunInput(db, projectId, "hurdle_irr");
}

export function resolveRunWacc(db: Database, runId: string): WaccResolution | null {
  const user = db
    .query(
      `SELECT id, run_id, value, as_of, rationale, anchor_ref
       FROM assumption
       WHERE run_id = ? AND assumption_key = 'wacc' AND kind = 'user'
       ORDER BY as_of DESC, id DESC
       LIMIT 1`,
    )
    .get(runId) as
    | { id: string; run_id: string; value: number; as_of: string; rationale: string | null; anchor_ref: string | null }
    | undefined;
  if (user) {
    return {
      value: user.value,
      source: "user",
      assumption_id: user.id,
      run_id: user.run_id,
      as_of: user.as_of,
      rationale: user.rationale,
      anchor_ref: user.anchor_ref,
    };
  }
  const input = db
    .query("SELECT assumption_key, value FROM run_input WHERE run_id = ? AND assumption_key IN ('wacc','run.wacc') ORDER BY assumption_key")
    .get(runId) as { assumption_key: string; value: number } | undefined;
  return input
    ? {
        value: input.value,
        source: "run_input",
        assumption_id: null,
        run_id: runId,
        as_of: null,
        rationale: `Resolved from ${input.assumption_key} run_input.`,
        anchor_ref: null,
      }
    : null;
}

export function recordWaccSession(
  db: Database,
  opts: {
    projectId: string;
    wacc: number;
    hurdleIrr?: number | null;
    mode?: string | null;
    rationale?: string | null;
    anchorRef?: string | null;
    asOf?: string | null;
    actor: string;
    now?: string;
  },
): WaccSessionResult {
  assertRate("wacc", opts.wacc);
  if (opts.hurdleIrr !== undefined && opts.hurdleIrr !== null) assertRate("hurdle_irr", opts.hurdleIrr);
  const now = opts.now ?? new Date().toISOString();
  const asOf = opts.asOf?.trim() || now.slice(0, 10);
  const overrides: Record<string, number> = { wacc: opts.wacc };
  if (opts.hurdleIrr !== undefined && opts.hurdleIrr !== null) overrides.hurdle_irr = opts.hurdleIrr;
  const label = `WACC input session${opts.mode ? ` (${opts.mode})` : ""}`;
  const rationale = [opts.rationale?.trim(), opts.mode ? `mode=${opts.mode}` : ""].filter(Boolean).join("; ") || null;

  const run = createRun(db, {
    projectId: opts.projectId,
    label,
    createdBy: opts.actor,
    overrides,
    now,
  });
  recordAssumption(db, {
    runId: run.run_id,
    assumptionKey: "wacc",
    kind: "user",
    value: opts.wacc,
    asOf,
    rationale: rationale ?? undefined,
    anchorRef: opts.anchorRef,
    actor: opts.actor,
    now,
  });
  const hurdle = opts.hurdleIrr !== undefined && opts.hurdleIrr !== null
    ? recordAssumption(db, {
        runId: run.run_id,
        assumptionKey: "hurdle_irr",
        kind: "user",
        value: opts.hurdleIrr,
        asOf,
        rationale: rationale ?? undefined,
        anchorRef: opts.anchorRef,
        actor: opts.actor,
        now,
      })
    : null;
  return {
    run_id: run.run_id,
    wacc: resolveProjectWacc(db, opts.projectId),
    hurdle_irr: hurdle ? resolveProjectHurdleIrr(db, opts.projectId) : null,
  };
}
