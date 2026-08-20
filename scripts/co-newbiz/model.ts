#!/usr/bin/env bun
// @version 1.0.0
/**
 * model/diff — run-based versioning CLI (design v1.0 §4-8, ADR-0005).
 *
 * v1 scope is honest about what exists: `model` records a versioned input
 * snapshot (createRun — copy the source run's inputs, apply --set
 * overrides, hash, persist atomically) and `diff` prints the
 * variable-level bridge between two runs. There is no valuation engine
 * yet (python/ has no DCF/NPV module), so valuation output and NPV-level
 * bridge decomposition are explicitly deferred: these commands version
 * INPUTS, they do not value them.
 *
 * Usage:
 *   bun scripts/co-newbiz/model.ts model --project <id> --label "v1 Pre-FS" [--from-run <id>] [--set key=value ...] [--db-path <path>]
 *   bun scripts/co-newbiz/model.ts diff <runA> <runB> [--db-path <path>]
 *
 * Also wired as the `model` / `diff` cases of newbiz.ts.
 */

import { getDb } from "../../db/client.ts";
import { createRun, diffRuns, type CreateRunResult, type RunDiff } from "../../db/lib/versioning.ts";

export interface ModelCreateOptions {
  projectId: string;
  label: string;
  fromRunId?: string;
  /** Raw `key=value` strings collected from repeated --set flags. */
  setPairs?: string[];
  createdBy?: string;
}

/** Parse `--set key=value` pairs; every value must parse as a finite number. */
export function parseSetPairs(pairs: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error(`--set expects key=value, got '${pair}'.`);
    const key = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1).trim();
    const value = Number(raw);
    if (!key || raw === "" || !Number.isFinite(value)) {
      throw new Error(`--set value for '${key}' must be a finite number, got '${pair.slice(eq + 1)}'.`);
    }
    out[key] = value;
  }
  return out;
}

export function runModelCreate(opts: ModelCreateOptions, dbPath?: string): CreateRunResult {
  return createRun(getDb(dbPath), {
    projectId: opts.projectId,
    label: opts.label,
    createdBy: opts.createdBy ?? "cli",
    fromRunId: opts.fromRunId,
    overrides: parseSetPairs(opts.setPairs ?? []),
  });
}

export function runModelDiff(runA: string, runB: string, dbPath?: string): RunDiff {
  return diffRuns(getDb(dbPath), runA, runB);
}

if (import.meta.main) {
  const [sub, ...rest] = process.argv.slice(2);
  const dbPathIdx = rest.indexOf("--db-path");
  const dbPath = dbPathIdx >= 0 ? rest[dbPathIdx + 1] : undefined;
  try {
    if (sub === "model") {
      const projectIdx = rest.indexOf("--project");
      const labelIdx = rest.indexOf("--label");
      const fromRunIdx = rest.indexOf("--from-run");
      const setPairs = rest.filter((_, i) => i > 0 && rest[i - 1] === "--set");
      const projectId = projectIdx >= 0 ? rest[projectIdx + 1] : undefined;
      const label = labelIdx >= 0 ? rest[labelIdx + 1] : undefined;
      if (!projectId || !label) {
        console.error('model requires --project <id> and --label "v1 Pre-FS"');
        console.error("(v1 records the versioned input snapshot; valuation output arrives with the model engine)");
        process.exit(1);
      }
      console.log(
        JSON.stringify(
          runModelCreate(
            {
              projectId,
              label,
              fromRunId: fromRunIdx >= 0 ? rest[fromRunIdx + 1] : undefined,
              setPairs,
            },
            dbPath,
          ),
          null,
          2,
        ),
      );
    } else if (sub === "diff") {
      const [runA, runB] = rest;
      if (!runA || !runB) {
        console.error("diff requires <runA> <runB>");
        process.exit(1);
      }
      console.log(JSON.stringify(runModelDiff(runA, runB, dbPath), null, 2));
    } else {
      console.error("Usage: bun scripts/co-newbiz/model.ts model --project <id> --label <label> [--from-run <id>] [--set key=value ...] [--db-path <path>]");
      console.error("       bun scripts/co-newbiz/model.ts diff <runA> <runB> [--db-path <path>]");
      process.exit(1);
    }
  } catch (err) {
    console.error(`${sub ?? "model"} failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
