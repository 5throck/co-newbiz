#!/usr/bin/env bun
// @version 1.0.0
/**
 * co-newbiz analysis-engine CLI — design v1.0 §4-8.
 *
 * Usage:
 *   bun scripts/co-newbiz/newbiz.ts <command> [options]
 *
 * Commands implemented so far (Stage 5 Wave 5.1):
 *   db:migrate   Apply pending db/migrations/*.sql
 *   db:analyze   (Wave 5.1 stub — query-plan check, not yet implemented)
 *   status       Print migration status
 *
 * Remaining commands (md:sync, fetch, law:sync, policy:sync, policy:impact,
 * proc:resolve, glossary:lint, fin:analyze, fin:project, assume, calibrate,
 * convert, model, simulate, rag, diff, watch:run, report, export, adr:new,
 * user:*) land in their respective Wave 5.2-5.7 PRs per docs/dev-plan.md —
 * not stubbed here to avoid a command that silently does nothing.
 */

import { runMigrations } from "../../db/migrate.ts";
import { getDb } from "../../db/client.ts";

const [command, ...args] = process.argv.slice(2);

function printUsage(): void {
  console.log("Usage: bun scripts/co-newbiz/newbiz.ts <command>");
  console.log("Commands: db:migrate, status");
}

switch (command) {
  case "db:migrate": {
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    const { applied, skipped } = runMigrations(dbPath);
    console.log(`✅ Applied ${applied.length} migration(s): ${applied.join(", ") || "(none)"}`);
    console.log(`   Skipped ${skipped.length} already-applied migration(s).`);
    break;
  }
  case "status": {
    const db = getDb();
    const rows = db.query("SELECT filename, applied_at FROM schema_migrations ORDER BY filename").all();
    console.log(`Applied migrations (${rows.length}):`);
    for (const r of rows as { filename: string; applied_at: string }[]) {
      console.log(`  ${r.filename} — ${r.applied_at}`);
    }
    break;
  }
  default:
    printUsage();
    if (command) process.exit(1);
}
