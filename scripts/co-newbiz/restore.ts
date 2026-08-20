#!/usr/bin/env bun
// @version 1.0.0
/**
 * SQLite restore — the rollback mechanism ADR-0014's migration discipline
 * relies on (this codebase has no per-migration DOWN script; a migration
 * is "reversible" precisely because a pre-migration backup exists to
 * restore from — see the `@reversible` tag comment in every
 * db/migrations/*.sql file).
 *
 * Verification (ADR-0015: "a backup never restored is not verified") is
 * built in, not left to the caller: after restoring, this script re-derives
 * row counts from the restored DB and diffs them against the backup's own
 * manifest — a mismatch fails loudly rather than reporting a silent "done."
 *
 * Usage:
 *   bun scripts/co-newbiz/restore.ts <backup-file> [--db-path <path>]
 */

import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { resetDb, getDb } from "../../db/client.ts";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) opts[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { positional, opts };
}

export interface RestoreVerification {
  ok: boolean;
  mismatches: { table: string; expected: number; actual: number }[];
}

export function runRestore(backupFile: string, dbPath?: string): RestoreVerification {
  const resolvedDbPath = dbPath ?? process.env.CO_NEWBIZ_DB_PATH ?? "db/data/co-newbiz.sqlite";
  const manifestFile = `${backupFile}.manifest.json`;

  if (!existsSync(backupFile)) throw new Error(`Backup file not found: ${backupFile}`);
  if (!existsSync(manifestFile)) throw new Error(`Backup manifest not found: ${manifestFile} — cannot verify restore without it.`);

  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as { tableRowCounts: Record<string, number> };

  // The live DB's own -wal sidecar (from writes AFTER the backup was
  // taken) must be neutralized before the backup's main file is copied in
  // — otherwise SQLite replays those leftover WAL frames on next open and
  // silently re-applies exactly the writes this restore is supposed to
  // undo. This was caught by actually rehearsing a rollback (Wave 5.9),
  // not discovered by inspection.
  //
  // TRUNCATE-checkpointing the live connection's own WAL (rather than
  // deleting the -wal/-shm files afterward) does this in place, with no
  // file-delete race against Windows' handle-release timing: the WAL ends
  // up zero-length, so it has nothing left to replay regardless of what
  // still touches it a moment later.
  if (existsSync(resolvedDbPath)) {
    const liveDb = getDb(resolvedDbPath);
    liveDb.run("PRAGMA wal_checkpoint(TRUNCATE)");
  }
  resetDb();

  copyFileSync(backupFile, resolvedDbPath);

  const db = getDb(resolvedDbPath);
  const mismatches: { table: string; expected: number; actual: number }[] = [];
  for (const [table, expected] of Object.entries(manifest.tableRowCounts)) {
    const row = db.query(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
    if (row.n !== expected) mismatches.push({ table, expected, actual: row.n });
  }

  return { ok: mismatches.length === 0, mismatches };
}

if (import.meta.main) {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const backupFile = positional[0];
  if (!backupFile) {
    console.error("Usage: bun scripts/co-newbiz/restore.ts <backup-file> [--db-path <path>]");
    process.exit(1);
  }
  const result = runRestore(backupFile, opts["db-path"]);
  if (result.ok) {
    console.log("✅ Restore verified — every table's row count matches the backup manifest.");
  } else {
    console.error("❌ Restore verification FAILED — row-count mismatch:");
    for (const m of result.mismatches) console.error(`   ${m.table}: expected ${m.expected}, got ${m.actual}`);
    process.exit(1);
  }
}
