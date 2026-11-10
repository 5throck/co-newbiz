// @version 1.1.0 (2026-11-10: resolveDbPath marker-validates `here` against db/migrations
// before trusting it — the Turbopack dev shim rebases import.meta identity to <repo>/app,
// which once created a stray empty database at app/db/data/. Design 2026-11-10-db-path-resolver-marker.)
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

/**
 * Pure path resolution, injectable for tests (design 2026-11-10-db-path-resolver-marker):
 * 1. CO_NEWBIZ_DB_PATH override wins (tests rely on it).
 * 2. `here` (the module's own directory) is trusted ONLY when it really is the
 *    repo db/ directory — validated by the layout marker `migrations/` next to
 *    `data/`. Under Next/Turbopack the import.meta shim resolves module ids
 *    against the bundler's ABSOLUTE_ROOT (observed: <repo>/app), so an
 *    out-of-root module carries a REBASED dirname; trusting it once created a
 *    second, divergent empty database at app/db/data/.
 * 3. Otherwise walk up from `cwd` until the db/migrations marker appears.
 * 4. No marker anywhere: cwd-relative fallback (operator runs from repo root).
 */
export function resolveDbPath(opts: {
  envPath?: string;
  cwd: string;
  here?: string;
  exists: (p: string) => boolean;
}): string {
  if (opts.envPath) return opts.envPath;
  if (opts.here && opts.exists(join(opts.here, "migrations"))) return join(opts.here, "data", "co-newbiz.sqlite");
  let dir = opts.cwd;
  for (let i = 0; i < 8; i++) {
    if (opts.exists(join(dir, "db", "migrations"))) return join(dir, "db", "data", "co-newbiz.sqlite");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(opts.cwd, "db", "data", "co-newbiz.sqlite");
}

// Anchored to THIS file's directory (<repo>/db), NOT the process working
// directory — previously the default was cwd-relative, so running the web
// server from app/web-next silently created a second, divergent database at
// app/web-next/db/data/. CO_NEWBIZ_DB_PATH still overrides (tests rely on it).
function resolveDefaultDbPath(): string {
  // import.meta.dir/dirname are Bun-native; under Next's bundler only
  // import.meta.url may survive, and even that can be a non-file scheme.
  const meta = import.meta as { dir?: string; dirname?: string; url?: string };
  const url = meta.url;
  const here =
    meta.dirname ??
    meta.dir ??
    (() => {
      try {
        return typeof url === "string" && url.startsWith("file:") ? dirname(fileURLToPath(url)) : undefined;
      } catch {
        return undefined;
      }
    })();
  return resolveDbPath({
    envPath: process.env.CO_NEWBIZ_DB_PATH,
    cwd: process.cwd(),
    here,
    exists: existsSync,
  });
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
  // 병렬 실행 계층(job-worker)과 앱이 같은 DB를 동시에 쓸 때 즉시 BUSY로
  // 터뜨리지 않고 잠금을 기다리게 한다(2026-09-19-sim-engine-runtime-separation §3).
  db.run("PRAGMA busy_timeout = 5000;");
  db.run("PRAGMA foreign_keys = ON;");
  _db = db;
  return db;
}

/** For tests: force a fresh connection against a given path (e.g. ':memory:'). */
export function resetDb(): void {
  _db?.close();
  _db = null;
}
