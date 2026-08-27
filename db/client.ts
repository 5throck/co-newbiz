// @version 1.0.0
/**
 * SQLite connection factory — bun:sqlite, WAL mode, foreign_keys enforced.
 * Per ADR-0001 (SQLite adoption) and ADR-0002 (portability constraints):
 * this is the ONLY place a raw Database handle is opened. All application
 * code accesses data through db/repositories/*.ts, never this file directly
 * (design v1.0 section 4-1; FR-SEC-03 depends on this being the single choke point).
 *
 * Note: Database.exec() below is bun:sqlite's own SQL-statement runner
 * (equivalent to sqlite3_exec), not Node's child_process.exec — no shell
 * or external process is invoked anywhere in this file.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_DB_PATH = process.env.CO_NEWBIZ_DB_PATH ?? "db/data/co-newbiz.sqlite";

// Lazy-loaded Database class from bun:sqlite
let _Database: any = null;
let _db: any | null = null;

function loadBunSqlite(): any {
  if (!_Database) {
    // Use require for synchronous loading in Bun runtime
    // This avoids static analysis by Next.js/Turbopack
    _Database = require("bun:sqlite").Database;
  }
  return _Database;
}

export function getDb(dbPath: string = DEFAULT_DB_PATH): any {
  if (_db) return _db;

  const Database = loadBunSqlite();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  _db = db;
  return db;
}

/** For tests: force a fresh connection against a given path (e.g. ':memory:'). */
export function resetDb(): void {
  _db?.close();
  _db = null;
}
