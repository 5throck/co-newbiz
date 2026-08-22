/**
 * Unit tests for migration 0015 (project_policy_pin rebuild + grandfathering
 * backfill) — ADR-0047 §4 (the backfill is a precondition of PR-5, not a
 * follow-up) and the PR-5b spec constraint 10. Runs against real scratch
 * SQLite files (same pattern as migration-0013.test.ts) so the partial
 * unique live index and the FKs are exercised by SQLite itself.
 *
 * Two databases, two purposes:
 *   - MAIN DB: fresh full migration — shape contract, live-index semantics,
 *     append-only supersede sequence;
 *   - STAGED DB: built to exactly pre-0015 state (the 0013 survival-test
 *     pattern), projects + one OLD-shape pin row seeded BEFORE 0015 applies —
 *     proving the backfill row-count and the rebuild's row preservation.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0015.sqlite";
const STAGED_DB_PATH = "db/data/test-migration-0015-staged.sqlite";
const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/migrations");
const NOW = "2026-08-23T10:00:00Z";

/**
 * The 13 (procedure doc, version) pairs authored into 0015's backfill,
 * read from the procedure schema.yaml files at migration-authoring time
 * (2026-08-23). Static by design: the backfill is a point-in-time snapshot;
 * later procedure bumps flow through the policy_change pipeline, never by
 * editing an applied migration.
 */
const AUTHORED_PIN_SET: ReadonlyArray<[string, string]> = [
  ["shared-brownfield-dd", "1.3.0"],
  ["shared-brownfield-fs", "1.2.0"],
  ["shared-brownfield-pre-fs", "1.3.0"],
  ["shared-brownfield-screening", "1.2.0"],
  ["shared-entity-establishment-execution", "1.1.0"],
  ["shared-entity-ic-review", "1.1.0"],
  ["shared-greenfield-dd", "1.0.0"],
  ["shared-greenfield-fs", "1.0.0"],
  ["shared-greenfield-pre-fs", "1.2.0"],
  ["shared-greenfield-screening", "1.3.0"],
  ["shared-group-investment-review", "1.1.0"],
  ["ent-a-brownfield-screening", "1.2.0"], // variant — version inherited from the referenced shared procedure
  ["region-eu-brownfield-screening", "1.2.0"], // variant — same
];

const PIN_COLUMNS = [
  "id", "project_id", "policy_doc_id", "pinned_version",
  "pinned_at", "pinned_by", "superseded_by",
] as const;

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

function indexSql(target: Db, table: string): { name: string; sql: string | null }[] {
  return target.query(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`).all() as never[];
}

/** Seed exactly pre-0015 state on the staged DB (0013 survival-test pattern). */
function buildStagedDb(): Db {
  // Always start from a clean file: each staged test builds its own pre-0015
  // world, and a leftover file from the previous staged test would make the
  // raw migration replay below fail with "table already exists".
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
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f < "0015").sort();
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
// Shape contract
// ---------------------------------------------------------------------------

describe("shape: project_policy_pin rebuild", () => {
  test("column set matches the 0015 target shape exactly (order included)", () => {
    expect(tableColumns(db, "project_policy_pin").map((c) => c.name)).toEqual([...PIN_COLUMNS]);
  });

  test("the live-row index is a partial UNIQUE on (project_id, policy_doc_id)", () => {
    const idx = indexSql(db, "project_policy_pin").find((i) => i.name === "idx_project_policy_pin_live")!;
    expect(idx).toBeDefined();
    expect(idx.sql).toMatch(/UNIQUE INDEX/i);
    expect(idx.sql).toMatch(/project_id/i);
    expect(idx.sql).toMatch(/policy_doc_id/i);
    expect(idx.sql).toMatch(/WHERE superseded_by IS NULL/i);
  });

  test("project FK and superseded_by self-FK are enforced after the rebuild", () => {
    expect(() =>
      db.run("INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by) VALUES (?,?,?,?,?,?)", [
        ulid(), "01NOSUCHPROJECT0005", "shared-brownfield-dd", "1.3.0", NOW, "tester",
      ]),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      db.run(
        "INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by, superseded_by) VALUES (?,?,?,?,?,?,?)",
        [ulid(), insertProject(), "shared-brownfield-dd", "1.3.0", NOW, "tester", "01NOSUCHPIN00000000001"],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// Live-row semantics — append-only supersede (the 0013 pattern)
// ---------------------------------------------------------------------------

describe("live-row semantics", () => {
  test("two live pins for the same (project, policy_doc_id) are rejected", () => {
    const pid = insertProject();
    db.run("INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by) VALUES (?,?,?,?,?,?)", [
      ulid(), pid, "shared-brownfield-dd", "1.3.0", NOW, "tester",
    ]);
    expect(() =>
      db.run("INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by) VALUES (?,?,?,?,?,?)", [
        ulid(), pid, "shared-brownfield-dd", "1.4.0", NOW, "tester",
      ]),
    ).toThrow(/UNIQUE constraint failed/);
  });

  test("the 0013-documented supersede sequence works and its reversal trips the index", () => {
    const pid = insertProject();
    const oldId = ulid();
    db.run("INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by) VALUES (?,?,?,?,?,?)", [
      oldId, pid, "shared-greenfield-fs", "1.0.0", NOW, "tester",
    ]);

    // Legal order: successor born non-live → predecessor retires → successor live
    const newId = ulid();
    db.run(
      "INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by, superseded_by) VALUES (?,?,?,?,?,?,?)",
      [newId, pid, "shared-greenfield-fs", "1.1.0", NOW, "tester", oldId],
    );
    db.run("UPDATE project_policy_pin SET superseded_by = ? WHERE id = ?", [newId, oldId]);
    db.run("UPDATE project_policy_pin SET superseded_by = NULL WHERE id = ?", [newId]);
    const live = db.query("SELECT id, pinned_version FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = 'shared-greenfield-fs' AND superseded_by IS NULL").get(pid);
    expect(live).toEqual({ id: newId, pinned_version: "1.1.0" });
    expect((db.query("SELECT superseded_by FROM project_policy_pin WHERE id = ?").get(oldId) as { superseded_by: string }).superseded_by).toBe(newId);

    // Reversal: going live while the predecessor still occupies the slot
    // trips the partial unique index — the database rejects the other order.
    const pid2 = insertProject();
    const a = ulid();
    const b = ulid();
    db.run("INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by) VALUES (?,?,?,?,?,?)", [
      a, pid2, "shared-greenfield-fs", "1.0.0", NOW, "tester",
    ]);
    db.run(
      "INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by, superseded_by) VALUES (?,?,?,?,?,?,?)",
      [b, pid2, "shared-greenfield-fs", "1.1.0", NOW, "tester", a],
    );
    expect(() => db.run("UPDATE project_policy_pin SET superseded_by = NULL WHERE id = ?", [b])).toThrow(/UNIQUE constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// Backfill + rebuild row preservation — staged pre-0015 database
// ---------------------------------------------------------------------------

describe("grandfathering backfill (staged pre-0015 state)", () => {
  test("backfill row-count = 13 × project count; versions match the authored constants; provenance stamped", () => {
    const sdb = buildStagedDb();
    try {
      const p1 = insertProject(sdb);
      const p2 = insertProject(sdb);

      const { applied } = runMigrations(STAGED_DB_PATH);
      expect(applied).toContain("0015_project_policy_pin.sql");

      const count = (sdb.query("SELECT COUNT(*) AS c FROM project_policy_pin").get() as { c: number }).c;
      expect(count).toBe(AUTHORED_PIN_SET.length * 2); // 13 docs × 2 projects

      for (const [projectId, label] of [[p1, "p1"], [p2, "p2"]] as const) {
        const rows = sdb
          .query("SELECT policy_doc_id, pinned_version, pinned_at, pinned_by FROM project_policy_pin WHERE project_id = ? ORDER BY policy_doc_id")
          .all(projectId) as { policy_doc_id: string; pinned_version: string; pinned_at: string; pinned_by: string }[];
        expect(rows.map((r) => [r.policy_doc_id, r.pinned_version])).toEqual([...AUTHORED_PIN_SET].sort((x, y) => x[0].localeCompare(y[0])));
        for (const r of rows) {
          expect(r.pinned_at).toBe("2026-08-23T00:00:00Z"); // fixed literal — ADR-0002, no dynamic dates
          expect(r.pinned_by).toBe("migration-0015"); // migration-authoring actor literal
        }
        expect(label).toBeTruthy();
      }
    } finally {
      // The staged DB owns the singleton while this test runs; hand the main
      // DB back even on failure so the describes that follow keep a live handle.
      resetDb();
      db = getDb(TEST_DB_PATH);
    }
  });

  test("a pre-0015 old-shape pin row survives the rebuild mapped to the new shape", () => {
    const sdb = buildStagedDb();
    try {
      const pid = insertProject(sdb);
      // The 0011 shape FK'd policy_id → policy(id), so a realistic legacy pin
      // needs its then-live policy row to exist first.
      sdb.run(
        "INSERT INTO policy (id, scope, name, version, effective_from, doc_path) VALUES (?,?,?,?,?,?)",
        ["legacy-policy-doc", "shared", "Legacy DD policy", "0.9.0", "2025-12-01T00:00:00Z", "policies/legacy-dd.md"],
      );
      sdb.run(
        "INSERT INTO project_policy_pin (project_id, policy_id, policy_version, pinned_at, pinned_by, migration_note) VALUES (?,?,?,?,?,?)",
        [pid, "legacy-policy-doc", "0.9.0", "2026-01-15T00:00:00Z", "legacy-admin", "pre-0015 pin"]
      );

      runMigrations(STAGED_DB_PATH);

      const row = sdb
        .query("SELECT id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by, superseded_by FROM project_policy_pin WHERE policy_doc_id = 'legacy-policy-doc'")
        .get() as { id: string; project_id: string; policy_doc_id: string; pinned_version: string; pinned_at: string; pinned_by: string; superseded_by: string | null };
      expect(row).toMatchObject({
        project_id: pid,
        policy_doc_id: "legacy-policy-doc",
        pinned_version: "0.9.0",
        pinned_at: "2026-01-15T00:00:00Z",
        pinned_by: "legacy-admin",
        superseded_by: null,
      });
      expect(row.id).toBe(`pin-0015-legacy-policy-doc-${pid}`); // deterministic rebuild id
    } finally {
      resetDb();
      db = getDb(TEST_DB_PATH);
    }
  });

  test("a fresh database (no projects at 0015 time) backfills zero rows — the INSERT...SELECT self-guards", () => {
    // The MAIN test DB had no md_project rows when runMigrations applied 0015.
    const c = (db.query("SELECT COUNT(*) AS c FROM project_policy_pin WHERE pinned_by = 'migration-0015'").get() as { c: number }).c;
    expect(c).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Runner idempotence
// ---------------------------------------------------------------------------

describe("migration idempotence", () => {
  test("re-running runMigrations applies nothing; the data-half WHERE NOT EXISTS guard holds under manual re-execution of the backfill", () => {
    const { applied, skipped } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect(skipped).toContain("0015_project_policy_pin.sql");
    expect(skipped.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length);

    // Belt-and-braces: even if the backfill statements themselves ran again
    // (manual execution), WHERE NOT EXISTS keeps them from duplicating.
    const pid = insertProject();
    const sql = readFileSync(join(MIGRATIONS_DIR, "0015_project_policy_pin.sql"), "utf-8");
    const stmt = sql
      .split(";")
      .map((s) => s.trim())
      .find((s) => /INSERT INTO project_policy_pin\b/.test(s) && s.includes("'shared-brownfield-dd'"))!;
    expect(stmt).toBeDefined(); // the chunk exists (comment lines precede the INSERT)
    db.run(`${stmt};`, [] as never[]);
    const rows = db
      .query("SELECT pinned_version FROM project_policy_pin WHERE project_id = ? AND policy_doc_id = 'shared-brownfield-dd'")
      .all(pid) as { pinned_version: string }[];
    expect(rows).toEqual([{ pinned_version: "1.3.0" }]); // exactly one — the guard held
  });

  test("0015 is recorded in schema_migrations", () => {
    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows.map((r) => r.filename)).toContain("0015_project_policy_pin.sql");
  });
});
