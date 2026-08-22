/**
 * Unit tests for migration 0016 (six-validator completeness record +
 * compliance_check invalidation columns) — PR-5c spec §2.2, ADR-0048 §4-§5.
 * Real scratch SQLite (same pattern as migration-0013/0015) so the FKs,
 * CHECKs, and column shapes are exercised by SQLite itself.
 *
 * Two databases, two purposes (the 0015 pattern):
 *   - MAIN DB: fresh full migration — shape contract, CHECK bounds, FK
 *     enforcement, row-survival of a seeded OLD compliance_check row;
 *   - STAGED DB: built to exactly pre-0016 state, an old-shape
 *     compliance_check row seeded BEFORE 0016 applies — proving the two
 *     ALTERs are row-preserving.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0016.sqlite";
const STAGED_DB_PATH = "db/data/test-migration-0016-staged.sqlite";
const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/migrations");
const NOW = "2026-08-23T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;

function insertProject(target: Db = db): string {
  const id = ulid();
  target.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  return id;
}

function tableColumns(target: Db, table: string): { name: string }[] {
  return target.query(`PRAGMA table_info(${table})`).all() as never[];
}

/** Seed exactly pre-0016 state on the staged DB (0013/0015 survival-test pattern). */
function buildStagedDb(): Db {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = STAGED_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
  resetDb();
  const sdb = getDb(STAGED_DB_PATH);
  sdb.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f < "0016").sort();
  for (const file of files) {
    sdb.run(readFileSync(join(MIGRATIONS_DIR, file), "utf-8"));
    sdb.run("INSERT INTO schema_migrations (id, filename, applied_at) VALUES (?, ?, ?)", [file, file, NOW]);
  }
  return sdb;
}

beforeAll(() => {
  for (const p of [TEST_DB_PATH, STAGED_DB_PATH]) {
    if (existsSync(p)) rmSync(p);
  }
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
});

afterAll(() => {
  resetDb();
  for (const base of [TEST_DB_PATH, STAGED_DB_PATH]) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = base + suffix;
      if (existsSync(p)) rmSync(p);
    }
  }
});

// ---------------------------------------------------------------------------
// Shape contract — compliance_check invalidation columns
// ---------------------------------------------------------------------------

describe("shape: compliance_check invalidation columns", () => {
  test("invalidated_at + invalidated_by_classification are appended (nullable, after resolved_at)", () => {
    const names = tableColumns(db, "compliance_check").map((c) => c.name);
    expect(names.slice(-2)).toEqual(["invalidated_at", "invalidated_by_classification"]);
    const rows = tableColumns(db, "compliance_check");
    expect(rows[rows.length - 1].notnull).toBe(0); // nullable — pre-migration rows carry NULL
    expect(rows[rows.length - 2].notnull).toBe(0);
  });

  test("the 0006/0013 column contract is otherwise untouched (order included)", () => {
    expect(tableColumns(db, "compliance_check").map((c) => c.name)).toEqual([
      "id", "project_id", "gate", "rule_key", "layer", "result", "detail",
      "waiver_id", "detected_at", "resolved_at", "invalidated_at", "invalidated_by_classification",
    ]);
  });

  test("invalidated_by_classification FK to project_case_classification is enforced", () => {
    const pid = insertProject();
    db.run(
      "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, detected_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), pid, "DD", "ma-validator-antitrust", "procedure", "pass", "row for the FK probe", NOW],
    );
    expect(() =>
      db.run(
        "UPDATE compliance_check SET invalidated_by_classification = ? WHERE project_id = ?",
        ["01NOSUCHCLASSIFICATION0001", pid],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// Shape contract — validator_completeness_record
// ---------------------------------------------------------------------------

describe("shape: validator_completeness_record", () => {
  const RECORD_COLUMNS = [
    "id", "project_id", "run_id", "gate", "declared",
    "applicable_count", "completed_count", "validator_rows", "created_at",
  ] as const;

  test("column set matches the 0016 target shape exactly (order included)", () => {
    expect(tableColumns(db, "validator_completeness_record").map((c) => c.name)).toEqual([...RECORD_COLUMNS]);
  });

  test("declared is pinned to 6 — the no-waiver core's size is not a variable", () => {
    const pid = insertProject();
    expect(() =>
      db.run(
        "INSERT INTO validator_completeness_record (id, project_id, gate, declared, applicable_count, completed_count, validator_rows, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), pid, "dd", 5, 5, 5, "[]", NOW],
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  test("gate is dd-only; counts bounded 0..6; completed may exceed applicable (skip rows count as covered)", () => {
    const pid = insertProject();
    expect(() =>
      db.run(
        "INSERT INTO validator_completeness_record (id, project_id, gate, declared, applicable_count, completed_count, validator_rows, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), pid, "DD", 6, 6, 6, "[]", NOW],
      ),
    ).toThrow(/CHECK constraint failed/);

    // the 3-number shape of a fully-skipped-and-documented internal venture:
    // 6 declared / 1 applicable / 6 completed — legal, and load-bearing
    db.run(
      "INSERT INTO validator_completeness_record (id, project_id, gate, declared, applicable_count, completed_count, validator_rows, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), pid, "dd", 6, 1, 6, "[]", NOW],
    );
    expect(() =>
      db.run(
        "INSERT INTO validator_completeness_record (id, project_id, gate, declared, applicable_count, completed_count, validator_rows, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), pid, "dd", 6, 7, 6, "[]", NOW],
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.run(
        "INSERT INTO validator_completeness_record (id, project_id, gate, declared, applicable_count, completed_count, validator_rows, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), pid, "dd", 6, 6, 7, "[]", NOW],
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  test("project and run FKs are enforced; run_id is nullable", () => {
    expect(() =>
      db.run(
        "INSERT INTO validator_completeness_record (id, project_id, gate, declared, applicable_count, completed_count, validator_rows, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), "01NOSUCHPROJECT0000005", "dd", 6, 6, 6, "[]", NOW],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      db.run(
        "INSERT INTO validator_completeness_record (id, project_id, run_id, gate, declared, applicable_count, completed_count, validator_rows, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [ulid(), insertProject(), "01NOSUCHRUN000000000001", "dd", 6, 6, 6, "[]", NOW],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    // nullable run_id — step 14 is a governance act, not an analysis run
    const pid = insertProject();
    expect(() =>
      db.run(
        "INSERT INTO validator_completeness_record (id, project_id, run_id, gate, declared, applicable_count, completed_count, validator_rows, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [ulid(), pid, null, "dd", 6, 6, 6, "[]", NOW],
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Row survival — staged pre-0016 database
// ---------------------------------------------------------------------------

describe("row preservation (staged pre-0016 state)", () => {
  test("an old-shape compliance_check row survives the two ALTERs with both new columns NULL", () => {
    const sdb = buildStagedDb();
    try {
      const pid = insertProject(sdb);
      const rowId = ulid();
      sdb.run(
        "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, waiver_id, detected_at, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [rowId, pid, "DD", "ma-validator-certification", "procedure", "blocked", "pre-0016 row — must survive", null, "2026-08-01T00:00:00Z", null],
      );
      // belt: prove the pre-0016 table really had no invalidation columns
      expect(tableColumns(sdb, "compliance_check").map((c) => c.name)).not.toContain("invalidated_at");

      const { applied } = runMigrations(STAGED_DB_PATH);
      expect(applied).toContain("0016_validator_completeness.sql");

      const row = sdb
        .query("SELECT id, project_id, gate, rule_key, result, detail, invalidated_at, invalidated_by_classification FROM compliance_check WHERE id = ?")
        .get(rowId) as { id: string; project_id: string; gate: string; rule_key: string; result: string; detail: string; invalidated_at: string | null; invalidated_by_classification: string | null };
      expect(row).toMatchObject({
        id: rowId,
        project_id: pid,
        gate: "DD",
        rule_key: "ma-validator-certification",
        result: "blocked",
        detail: "pre-0016 row — must survive",
        invalidated_at: null,
        invalidated_by_classification: null,
      });
      expect((sdb.query("SELECT COUNT(*) AS c FROM compliance_check").get() as { c: number }).c).toBe(1);
    } finally {
      resetDb();
      db = getDb(TEST_DB_PATH);
    }
  });
});

// ---------------------------------------------------------------------------
// Runner idempotence
// ---------------------------------------------------------------------------

describe("migration idempotence", () => {
  test("re-running runMigrations applies nothing; 0016 is recorded in schema_migrations", () => {
    const { applied, skipped } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect(skipped).toContain("0016_validator_completeness.sql");
    expect(skipped.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length);

    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows.map((r) => r.filename)).toContain("0016_validator_completeness.sql");
  });
});
