// @version 1.0.0
/**
 * FK boot-path test (PR-0 of the 2026-08-22 RAG formalization design,
 * meeting finding F10): proves db/client.ts's `PRAGMA foreign_keys = ON`
 * actually takes effect on every connection getDb() hands out — the first
 * boot AND after resetDb() — and functionally: that constraints are enforced
 * (a child insert with a missing parent throws), not just the pragma flag.
 *
 * Uses an isolated temp file DB under the OS temp dir (not db/data/) so the
 * run never touches real data files.
 */

import { test, expect, afterAll } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEMP_DIR = mkdtempSync(join(tmpdir(), "fk-pragma-test-"));
const DB_PATH = join(TEMP_DIR, "fk-pragma.sqlite");

const { getDb, resetDb } = await import("../../db/client.ts");

afterAll(() => {
  resetDb();
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

/** bun:sqlite returns PRAGMA foreign_keys as a number column: { foreign_keys: 1 }. */
function foreignKeysPragma(db: Database): number {
  const row = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  return row.foreign_keys;
}

test("first getDb() boots with PRAGMA foreign_keys = ON", () => {
  resetDb();
  const db = getDb(DB_PATH);
  expect(foreignKeysPragma(db)).toBe(1);
});

test("after resetDb(), a fresh getDb() still has foreign_keys = ON", () => {
  resetDb(); // discards the singleton (and its pragma state — FK is per-connection in SQLite)
  const db = getDb(DB_PATH);
  expect(foreignKeysPragma(db)).toBe(1);
});

test("FK constraints are actually enforced: child insert with a nonexistent parent throws", () => {
  resetDb();
  const db = getDb(DB_PATH);
  db.run("CREATE TABLE IF NOT EXISTS parent (id TEXT PRIMARY KEY)");
  db.run(
    "CREATE TABLE IF NOT EXISTS child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id))"
  );

  expect(() => db.run("INSERT INTO child (id, parent_id) VALUES ('c1', 'no-such-parent')")).toThrow(
    /FOREIGN KEY constraint failed/
  );

  // Control proving the throw was FK-driven, not a schema/lock artifact:
  // the identical insert succeeds once the parent row exists.
  db.run("INSERT INTO parent (id) VALUES ('no-such-parent')");
  db.run("INSERT INTO child (id, parent_id) VALUES ('c1', 'no-such-parent')");
  const child = db.query("SELECT id FROM child").get() as { id: string };
  expect(child.id).toBe("c1");
});
