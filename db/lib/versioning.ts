// @version 1.0.0
/**
 * Run-based versioning engine — ADR-0005, design v1.0 §4-4, FR-DATA-10.
 *
 * A run is a frozen point-in-time input set. createRun copies the source
 * run's run_input rows (an explicit fromRunId, else the project's latest
 * run by created_at, else an empty set for the project's first run),
 * applies overrides on top, and writes the run row plus every run_input
 * row in ONE transaction — there is no state where a run exists with a
 * partial snapshot. Rows are never mutated after creation; a new run is
 * the only versioning move.
 *
 * input_hash serialization contract (design §12 verification item 13 —
 * reproducibility is the point): sha256 hex over the UTF-8 encoding of the
 * entries sorted by assumption_key (Array.prototype.sort's default
 * lexicographic order on the key string), each rendered exactly as
 * `${assumption_key}=${value}` followed by a single "\n", with value via
 * JavaScript's Number.prototype.toString(). The same input set therefore
 * yields the same hash regardless of run id, label, timestamps, creator,
 * or insertion order — and the empty set hashes as sha256("").
 *
 * diffRuns is a pure function over the two runs' run_input reads: a
 * variable-level bridge (changed / added / removed per assumption_key)
 * plus both runs' input hashes. NPV-level bridge decomposition is
 * deliberately NOT here: there is no valuation engine yet (python/ has no
 * DCF/NPV module), and fabricating output-level deltas from input deltas
 * would fake a confidence the system does not have.
 */

import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";

export interface CreateRunOptions {
  projectId: string;
  label?: string | null;
  createdBy: string;
  /** Explicit source run; omitted = the project's latest run; null source = empty input set. */
  fromRunId?: string;
  /** Applied on top of the copied snapshot (key -> value). */
  overrides?: Record<string, number>;
  now?: string;
}

export interface CreateRunResult {
  run_id: string;
  project_id: string;
  label: string | null;
  input_hash: string;
  input_count: number;
  from_run_id: string | null;
}

/** sha256 over the documented sorted `key=value\n` serialization. */
export function hashInputs(inputs: ReadonlyMap<string, number>): string {
  const serialized = [...inputs.keys()]
    .sort()
    .map((key) => `${key}=${inputs.get(key)}\n`)
    .join("");
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

export function createRun(db: Database, opts: CreateRunOptions): CreateRunResult {
  const project = db.query("SELECT id FROM md_project WHERE id = ?").get(opts.projectId) as { id: string } | null;
  if (!project) {
    throw new Error(
      `Project '${opts.projectId}' not found in md_project — create it before modeling (FR-DATA-04: no silent auto-creation of master data).`,
    );
  }

  let sourceRunId = opts.fromRunId?.trim() || null;
  if (sourceRunId) {
    const source = db.query("SELECT id, project_id FROM run WHERE id = ?").get(sourceRunId) as
      | { id: string; project_id: string }
      | null;
    if (!source) {
      throw new Error(`from_run_id '${sourceRunId}' does not exist.`);
    }
    if (source.project_id !== opts.projectId) {
      throw new Error(
        `from_run_id '${sourceRunId}' belongs to a different project — a run snapshot can only chain within one project (ADR-0005).`,
      );
    }
  } else {
    // Default source: the project's latest run. id DESC is the deterministic
    // tiebreak when two runs share a created_at millisecond.
    const latest = db
      .query("SELECT id FROM run WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(opts.projectId) as { id: string } | null;
    sourceRunId = latest?.id ?? null;
  }

  const inputs = new Map<string, number>();
  if (sourceRunId) {
    const rows = db
      .query("SELECT assumption_key, value FROM run_input WHERE run_id = ?")
      .all(sourceRunId) as { assumption_key: string; value: number }[];
    for (const row of rows) inputs.set(row.assumption_key, row.value);
  }
  for (const [key, value] of Object.entries(opts.overrides ?? {})) {
    if (!key.trim()) throw new Error("Override keys must be non-empty assumption_key strings.");
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Override value for '${key}' must be a finite number.`);
    }
    inputs.set(key.trim(), value);
  }

  const inputHash = hashInputs(inputs);
  const runId = ulid();
  const now = opts.now ?? new Date().toISOString();
  db.transaction(() => {
    db.run(
      "INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)",
      [runId, opts.projectId, opts.label?.trim() || null, inputHash, opts.createdBy, now],
    );
    // Sorted insertion so the snapshot's physical row order is as
    // reproducible as its hash.
    for (const key of [...inputs.keys()].sort()) {
      db.run("INSERT INTO run_input (run_id, assumption_key, value) VALUES (?,?,?)", [runId, key, inputs.get(key)]);
    }
  })();

  return {
    run_id: runId,
    project_id: opts.projectId,
    label: opts.label?.trim() || null,
    input_hash: inputHash,
    input_count: inputs.size,
    from_run_id: sourceRunId,
  };
}

export interface DiffChangedRow {
  key: string;
  from: number;
  to: number;
  delta: number;
}

export interface DiffValueRow {
  key: string;
  value: number;
}

export interface RunDiff {
  run_a: string;
  run_b: string;
  input_hash_a: string;
  input_hash_b: string;
  /** Present in both runs with different values. */
  changed: DiffChangedRow[];
  /** Present only in run_b. */
  added: DiffValueRow[];
  /** Present only in run_a. */
  removed: DiffValueRow[];
}

export function diffRuns(db: Database, runA: string, runB: string): RunDiff {
  const hashes: string[] = [];
  const maps: Map<string, number>[] = [];
  for (const runId of [runA, runB]) {
    const run = db.query("SELECT id, input_hash FROM run WHERE id = ?").get(runId) as
      | { id: string; input_hash: string }
      | null;
    if (!run) throw new Error(`Run '${runId}' not found.`);
    hashes.push(run.input_hash);
    const map = new Map<string, number>();
    const rows = db
      .query("SELECT assumption_key, value FROM run_input WHERE run_id = ?")
      .all(runId) as { assumption_key: string; value: number }[];
    for (const row of rows) map.set(row.assumption_key, row.value);
    maps.push(map);
  }

  const [a, b] = maps;
  const changed: DiffChangedRow[] = [];
  const added: DiffValueRow[] = [];
  const removed: DiffValueRow[] = [];
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (a.has(key) && b.has(key)) {
      const from = a.get(key)!;
      const to = b.get(key)!;
      if (from !== to) changed.push({ key, from, to, delta: to - from });
    } else if (b.has(key)) {
      added.push({ key, value: b.get(key)! });
    } else {
      removed.push({ key, value: a.get(key)! });
    }
  }
  return {
    run_a: runA,
    run_b: runB,
    input_hash_a: hashes[0]!,
    input_hash_b: hashes[1]!,
    changed,
    added,
    removed,
  };
}
