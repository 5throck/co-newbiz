// @version 1.0.0
/**
 * Migration runner — applies db/migrations/*.sql in filename order, tracked
 * in schema_migrations. Pure-SQL migrations only (ADR-0002 portability
 * constraint) — no ORM-generated DDL.
 *
 * Usage: bun db/migrate.ts [--db-path <path>]
 */

import { getDb } from "./client.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

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
    db.transaction(() => {
      db.run(sql);
      db.run(
        "INSERT INTO schema_migrations (id, filename, applied_at) VALUES (?, ?, ?)",
        [basename(file), file, new Date().toISOString()]
      );
    })();
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
