#!/usr/bin/env bun
// @version 1.0.0
/**
 * SQLite backup — docs/security-baseline.md, ADR-0014, ADR-0015.
 *
 * ADR-0014: backup runs immediately before any migration. ADR-0015: "a
 * backup never restored is not verified" — this script also supports
 * restore.ts's verification path by writing a manifest (row counts per
 * table) alongside the copy, so a restore can be checked against a known
 * baseline without re-deriving it from the live DB (which may no longer
 * be in the same state by the time restore runs).
 *
 * WAL checkpoint runs first (TRUNCATE mode) so the backup file itself is
 * self-contained — copying the main file without checkpointing the WAL
 * would produce a backup missing not-yet-checkpointed writes.
 *
 * Usage:
 *   bun scripts/co-newbiz/backup.ts [--db-path <path>] [--backup-dir <dir>]
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { getDb } from "../../db/client.ts";

function parseArgs(argv: string[]) {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) opts[argv[i].slice(2)] = argv[i + 1];
  }
  return opts;
}

export function runBackup(dbPath?: string, backupDir?: string): { backupFile: string; manifestFile: string; tableRowCounts: Record<string, number> } {
  const resolvedDbPath = dbPath ?? process.env.CO_NEWBIZ_DB_PATH ?? "db/data/co-newbiz.sqlite";
  const resolvedBackupDir = backupDir ?? "db/backups";

  if (!existsSync(resolvedDbPath)) {
    throw new Error(`No database at ${resolvedDbPath} — nothing to back up.`);
  }

  mkdirSync(resolvedBackupDir, { recursive: true });

  const db = getDb(resolvedDbPath);
  // TRUNCATE mode checkpoint folds every WAL frame into the main file and
  // resets the WAL to empty — the main file alone is then self-contained.
  db.run("PRAGMA wal_checkpoint(TRUNCATE)");

  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const tableRowCounts: Record<string, number> = {};
  for (const { name } of tables) {
    const row = db.query(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
    tableRowCounts[name] = row.n;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = join(resolvedBackupDir, `${basename(resolvedDbPath)}.${timestamp}.bak`);
  const manifestFile = `${backupFile}.manifest.json`;

  copyFileSync(resolvedDbPath, backupFile);
  writeFileSync(
    manifestFile,
    JSON.stringify({ sourceDbPath: resolvedDbPath, backedUpAt: new Date().toISOString(), tableRowCounts }, null, 2),
  );

  return { backupFile, manifestFile, tableRowCounts };
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2));
  const result = runBackup(opts["db-path"], opts["backup-dir"]);
  console.log(`✅ Backup written: ${result.backupFile}`);
  console.log(`   Manifest: ${result.manifestFile}`);
  console.log(`   Table row counts: ${JSON.stringify(result.tableRowCounts)}`);
}
