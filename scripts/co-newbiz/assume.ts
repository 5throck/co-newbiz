#!/usr/bin/env bun
// @version 1.0.0
/**
 * assume — register an assumption row (design v1.0 §4-8, FR-DATA-07).
 *
 * CLI face of the same write path as POST /api/assumptions:
 * db/lib/assumption.ts recordAssumption() owns the rules (kind enum,
 * finite value, mandatory as_of, kind='assumed' requires a non-empty
 * rationale) and the audited insert, so the two surfaces cannot drift.
 * Unlike the route there is no membership context here — the operator is
 * assumed to be acting on a run they can already touch (the CLI has no
 * authenticated user to inherit permissions from).
 *
 * Usage:
 *   bun scripts/co-newbiz/assume.ts --run <id> --key <key> --kind live|user|derived|assumed --value <n>
 *       [--rationale "..."] [--anchor-ref <ref>] [--ttl-days <N>] [--as-of YYYY-MM-DD] [--db-path <path>]
 *
 * Also wired as the `assume` case of newbiz.ts.
 */

import { getDb } from "../../db/client.ts";
import { recordAssumption, ASSUMPTION_KINDS, type AssumptionRow } from "../../db/lib/assumption.ts";

export interface AssumeOptions {
  runId: string;
  assumptionKey: string;
  kind: string;
  value: number;
  /** Defaults to today (local date, ISO-8601). */
  asOf?: string;
  rationale?: string;
  anchorRef?: string;
  ttlDays?: number;
}

/** Business function imported directly by tests — mirrors model.ts's shape. */
export function runAssume(opts: AssumeOptions, dbPath?: string): AssumptionRow {
  return recordAssumption(getDb(dbPath), {
    runId: opts.runId,
    assumptionKey: opts.assumptionKey,
    kind: opts.kind,
    value: opts.value,
    asOf: opts.asOf ?? new Date().toISOString().slice(0, 10),
    rationale: opts.rationale,
    anchorRef: opts.anchorRef,
    ttlDays: opts.ttlDays ?? null,
    actor: "cli",
    now: new Date().toISOString(),
  });
}

function flag(args: readonly string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const runId = flag(args, "--run");
  const key = flag(args, "--key");
  const kind = flag(args, "--kind");
  const rawValue = flag(args, "--value");
  try {
    if (!runId || !key || !kind || rawValue === undefined) {
      console.error("assume requires --run <id> --key <key> --kind <live|user|derived|assumed> --value <n>");
      console.error(`(--as-of defaults to today; kind='assumed' requires --rationale, FR-DATA-07)`);
      process.exit(1);
    }
    const row = runAssume(
      {
        runId,
        assumptionKey: key,
        kind,
        value: Number(rawValue),
        asOf: flag(args, "--as-of"),
        rationale: flag(args, "--rationale"),
        anchorRef: flag(args, "--anchor-ref"),
        ttlDays: flag(args, "--ttl-days") !== undefined ? Number(flag(args, "--ttl-days")) : undefined,
      },
      flag(args, "--db-path"),
    );
    console.log(JSON.stringify(row, null, 2));
  } catch (err) {
    console.error(`assume failed: ${(err as Error).message}`);
    console.error(`kinds: ${[...ASSUMPTION_KINDS].join("|")}`);
    process.exit(1);
  }
}
