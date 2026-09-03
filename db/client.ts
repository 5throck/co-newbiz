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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Anchored to THIS file's directory (<repo>/db), NOT the process working
// directory — previously the default was cwd-relative, so running the web
// server from app/web-next silently created a second, divergent database at
// app/web-next/db/data/. CO_NEWBIZ_DB_PATH still overrides (tests rely on it).
function resolveDefaultDbPath(): string {
  if (process.env.CO_NEWBIZ_DB_PATH) return process.env.CO_NEWBIZ_DB_PATH;
  // import.meta.dir/dirname are Bun-native; under Next's bundler only
  // import.meta.url may survive, and even that can be a non-file scheme.
  const meta = import.meta as { dir?: string; dirname?: string; url?: string };
  const url = meta.url;
  const here = meta.dirname ?? meta.dir ?? (() => {
    try {
      return typeof url === "string" && url.startsWith("file:") ? dirname(fileURLToPath(url)) : undefined;
    } catch {
      return undefined;
    }
  })();
  if (here) return join(here, "data", "co-newbiz.sqlite");
  // Last resort (bundled with no file identity): walk up from the cwd until
  // we find the repo layout marker db/migrations.
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "db", "migrations"))) return join(dir, "db", "data", "co-newbiz.sqlite");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), "db", "data", "co-newbiz.sqlite");
}
const DEFAULT_DB_PATH = resolveDefaultDbPath();
/** <repo>/db — siblings: data/ (databases), migrations/ (SQL). */
export const DB_DIR = dirname(dirname(DEFAULT_DB_PATH));

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
