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
 * Statements are executed one-by-one (splitSqlStatements, ADR-0163) so a
 * constraint failure in ANY statement aborts the migration: bun:sqlite's
 * multi-statement Database.run() silently swallows errors raised by
 * non-final statements, which previously let CHECK-guarded safety
 * assertions inside migrations (0132, 0137) pass vacuously.
 *
 * Usage: bun db/migrate.ts [--db-path <path>]
 */

import { getDb, DB_DIR } from "./client.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

// bun:sqlite's Database.run() executes a multi-statement script through
// sqlite3_exec, which does NOT surface an error raised by a non-final
// statement — a constraint failure mid-script was silently ignored, so
// CHECK-guarded row-count safety assertions inside migrations (0132, 0137
// headers) could never abort. To get stop-on-error semantics each statement
// is split out and executed individually: a single db.run(statement) throws
// on failure. The splitter below is a small tokenizer that is aware of:
//   - '--' line comments and '/**/' block comments (skipped, never split on)
//   - single-quoted strings (with '' escaping), double-quoted identifiers,
//     [bracket] and `backtick` identifiers
//   - trigger bodies: after CREATE [TEMP] TRIGGER ... BEGIN, ';' inside
//     the body does not end the statement until the matching END (nesting
//     counted for nested BEGIN; CASE ... END inside the body is paired so
//     it does not close the trigger early).
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let triggerDepth = 0; // >0 while inside a CREATE TRIGGER body
  let expectingTriggerBody = false; // saw CREATE ... TRIGGER, waiting for BEGIN

  const flush = () => {
    const trimmed = current.trim();
    // Drop chunks that carry no executable SQL (pure comment blocks).
    const executable = trimmed.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (executable.length > 0) statements.push(trimmed);
    current = "";
  };

  const wordAt = (pos: number): { word: string; end: number } | null => {
    const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(pos));
    return m ? { word: m[0].toUpperCase(), end: pos + m[0].length } : null;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Comments: copied verbatim (so stored CREATE-statement text stays
    // byte-identical to what the old multi-statement run persisted), but a
    // ';' inside a comment never ends a statement.
    if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl + 1;
      current += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? sql.length : close + 2;
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    // Strings and quoted identifiers: copy verbatim, '' escapes.
    if (ch === "'") {
      current += ch;
      i++;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { current += sql[i + 1]; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "[") {
      const closeCh = ch === "[" ? "]" : ch;
      current += ch;
      i++;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === closeCh) {
          if (sql[i + 1] === closeCh && closeCh !== "]") { current += sql[i + 1]; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Words: track trigger BEGIN/END nesting.
    if (/[A-Za-z_]/.test(ch)) {
      const hit = wordAt(i);
      if (!hit) { current += ch; i++; continue; }
      const { word, end } = hit;
      if (word === "TRIGGER") expectingTriggerBody = true;
      else if (word === "BEGIN") {
        if (expectingTriggerBody) { triggerDepth = 1; expectingTriggerBody = false; }
        else if (triggerDepth > 0) triggerDepth++;
      } else if (word === "CASE" && triggerDepth > 0) triggerDepth++;
      else if (word === "END" && triggerDepth > 0) {
        triggerDepth--;
      }
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    if (ch === ";" && triggerDepth === 0) {
      flush();
      i++;
      continue;
    }

    current += ch;
    i++;
  }
  flush();
  return statements;
}

/** Execute a SQL script statement-by-statement, aborting on the first error. */
function runScript(db: ReturnType<typeof getDb>, sql: string): void {
  for (const statement of splitSqlStatements(sql)) db.run(statement);
}

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

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function getMigrationStatus(dbPath?: string): { applied: string[]; pending: string[] } {
  const db = getDb(dbPath);
  ensureMigrationsTable(db);

  const already = new Set(
    db.query("SELECT filename FROM schema_migrations").all().map((r: any) => r.filename)
  );

  const files = migrationFiles();
  return {
    applied: files.filter((f) => already.has(f)),
    pending: files.filter((f) => !already.has(f)),
  };
}

export function runMigrations(dbPath?: string): { applied: string[]; skipped: string[] } {
  const db = getDb(dbPath);
  ensureMigrationsTable(db);

  const already = new Set(
    db.query("SELECT filename FROM schema_migrations").all().map((r: any) => r.filename)
  );

  const files = migrationFiles();

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
      runScript(db, sql);
      db.run(
        "INSERT INTO schema_migrations (id, filename, applied_at) VALUES (?, ?, ?)",
        [basename(file), file, new Date().toISOString()]
      );
    } else {
      db.transaction(() => {
        runScript(db, sql);
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
