// @version 1.0.0
/**
 * Migration runner — applies db/migrations/*.sql in filename order, tracked
 * in schema_migrations. Pure-SQL migrations only (ADR-0002 portability
 * constraint) — no ORM-generated DDL.
 *
 * Every migration is normally wrapped in db.transaction(...) for
 * all-or-nothing application. ADR-0071 (migration 0033, the PK NOT NULL
 * table-rebuild) needed PRAGMA foreign_keys=OFF for its duration — SQLite
 * documents that pragma as a no-op while a transaction is open, and a
 * table-rebuild (DROP+RENAME) of a table with live FK-referencing child
 * rows otherwise fails ("FOREIGN KEY constraint failed") under
 * foreign_keys=ON. A migration file may opt out of the transaction wrapper
 * by starting with the exact first line `-- @notransaction` — its
 * statements then run directly (no implicit BEGIN), so a leading
 * `PRAGMA foreign_keys = OFF;` (and a trailing `= ON;`) actually takes
 * effect. This trades the all-or-nothing guarantee for that one file (a
 * failure partway through leaves a partially-rebuilt schema) — used only
 * when the FK-toggle requirement leaves no other option; a pre-migration
 * backup (ADR-0014) is the recovery path if it fails partway.
 *
 * Usage: bun db/migrate.ts [--db-path <path>]
 */

import { getDb, DB_DIR } from "./client.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

// Prefer this file's own directory (exact under the plain Bun runtime);
// fall back to DB_DIR (see db/client.ts) when bundled by Next/Turbopack,
// where import.meta.dirname may not survive.
const MIGRATIONS_DIR =
  typeof import.meta.dirname === "string"
    ? join(import.meta.dirname, "migrations")
    : join(DB_DIR, "migrations");

function ensureMigrationsTable(db: ReturnType<typeof getDb>): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
}

export function runMigrations(dbPath?: string): { applied: string[]; skipped: string[] } {
  const db = getDb(dbPath);
  ensureMigrationsTable(db);

  const already = new Set(
    db.query("SELECT filename FROM schema_migrations").all().map((r: any) => r.filename)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (already.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    const noTransaction = sql.startsWith("-- @notransaction");
    if (noTransaction) {
      db.run(sql);
      db.run(
        "INSERT INTO schema_migrations (id, filename, applied_at) VALUES (?, ?, ?)",
        [basename(file), file, new Date().toISOString()]
      );
    } else {
      db.transaction(() => {
        db.run(sql);
        db.run(
          "INSERT INTO schema_migrations (id, filename, applied_at) VALUES (?, ?, ?)",
          [basename(file), file, new Date().toISOString()]
        );
      })();
    }
    applied.push(file);
  }

  return { applied, skipped };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dbPathIdx = args.indexOf("--db-path");
  const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;

  const { applied, skipped } = runMigrations(dbPath);
  console.log(`Applied ${applied.length} migration(s): ${applied.join(", ") || "(none)"}`);
  console.log(`Skipped ${skipped.length} already-applied migration(s).`);
}
