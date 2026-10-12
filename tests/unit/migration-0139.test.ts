// @version 1.0.0
/**
 * Migration 0139 — venture_scorecard's uniqueness key widened with
 * review_cycle (ADR-0164). Proves: pre-existing rows survive verbatim, the
 * column set / CHECKs / FKs / indexes are unchanged apart from the key, a
 * same-measure next-quarter row on the SAME run now inserts while a
 * same-cycle duplicate still fails, the header rollback SQL reverses the
 * rebuild (and refuses while any (run, procedure, section, measure) group
 * holds rows from more than one cycle), and 0139 re-applies cleanly after a
 * rollback.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0139_"))!;
const SQL = readFileSync(join(DIR, TARGET), "utf-8");
const ROLLBACK = (() => {
  const body = SQL.slice(SQL.indexOf("-- ROLLBACK-SQL-BEGIN"), SQL.indexOf("-- ROLLBACK-SQL-END"));
  return body.split("\n").slice(1).map((l) => l.replace(/^--\s?/, "")).join("\n");
})();

/** Statement-by-statement execution (stop on first error), as the header prescribes for the rollback. */
function runEach(db: Database, sql: string): void {
  db.transaction(() => {
    for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) db.run(stmt);
  })();
}

function applyBefore(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) {
    if (f >= TARGET) break;
    db.run(readFileSync(join(DIR, f), "utf-8"));
  }
}

const cols = (db: Database) => db.query("PRAGMA table_info(venture_scorecard)").all();
const fks = (db: Database) => db.query("PRAGMA foreign_key_list(venture_scorecard)").all();
const idx = (db: Database) =>
  db.query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'venture_scorecard' AND sql IS NOT NULL ORDER BY name").all();
const rows = (db: Database) => db.query("SELECT * FROM venture_scorecard ORDER BY id").all();

const NOW = "2026-08-23T00:00:00.000Z";

function seed(db: Database, id: string, run: string, cycle: string, measure: string, section = "financial", proc = "portfolio-venture-monitoring"): void {
  db.run(
    "INSERT INTO venture_scorecard (id, run_id, project_id, source_procedure, review_cycle, venture_class, section, measure_key, target_value, actual_value, status, evidence_ref, observed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, run, "p1", proc, cycle, "driving", section, measure, ">= 0pp", "+3pp", "on_target", "doc:cim-2026-001", NOW, NOW],
  );
}

function seeded(): Database {
  const db = new Database(":memory:");
  applyBefore(db);
  db.run("PRAGMA foreign_keys = ON");
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES ('p1','P-1','2026-01-01')");
  const r1 = "run1";
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,'2026-01-02')", [r1, "p1", "h1", "u1"]);
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES ('run2','p1','h2','u1','2026-01-03')");
  seed(db, "a1", r1, "2026-Q3", "utilisation_pct", "strategic");
  seed(db, "a2", r1, "2026-Q3", "revenue_vs_case");
  seed(db, "a3", "run2", "2026-Q3", "utilisation_pct", "strategic", "jv-lifecycle-governance");
  return db;
}

describe("migration 0139 — venture_scorecard unique key gains review_cycle", () => {
  test("rebuild preserves rows, columns, FKs and indexes; widens only the unique key", () => {
    const db = seeded();
    const before = { rows: rows(db), cols: cols(db), fks: fks(db), idx: idx(db) };
    expect(before.rows.length).toBe(3);
    // Old key: the same measure + cycle on the SAME run is rejected.
    expect(() => seed(db, "x1", "run1", "2026-Q3", "utilisation_pct", "strategic")).toThrow();
    db.transaction(() => db.run(SQL))();
    expect(rows(db)).toEqual(before.rows);
    expect(cols(db)).toEqual(before.cols);
    expect(fks(db)).toEqual(before.fks);
    expect(idx(db)).toEqual(before.idx);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    // New key: same run + measure, DIFFERENT cycle now legal; same cycle still rejected.
    seed(db, "n1", "run1", "2026-Q4", "utilisation_pct", "strategic");
    expect(() => seed(db, "x2", "run1", "2026-Q4", "utilisation_pct", "strategic")).toThrow();
    db.run("DELETE FROM venture_scorecard WHERE id = 'n1'");
  });

  test("header rollback reverses the rebuild (single-cycle data), and 0139 re-applies", () => {
    const db = seeded();
    const before = { rows: rows(db), cols: cols(db), idx: idx(db) };
    db.transaction(() => db.run(SQL))();
    runEach(db, ROLLBACK);
    expect(rows(db)).toEqual(before.rows);
    expect(cols(db)).toEqual(before.cols);
    expect(idx(db)).toEqual(before.idx);
    // Back on the 0024 key: a second cycle on the same run is rejected again.
    expect(() => seed(db, "x3", "run1", "2026-Q4", "utilisation_pct", "strategic")).toThrow();
    db.transaction(() => db.run(SQL))();
    expect(rows(db)).toEqual(before.rows);
    seed(db, "n2", "run1", "2026-Q4", "utilisation_pct", "strategic");
  });

  test("rollback guard refuses while a multi-cycle (run, procedure, section, measure) group exists", () => {
    const db = seeded();
    db.transaction(() => db.run(SQL))();
    seed(db, "n3", "run1", "2026-Q4", "utilisation_pct", "strategic");
    expect(() => runEach(db, ROLLBACK)).toThrow(/CHECK constraint failed/);
    expect(rows(db).length).toBe(4); // aborted rollback changed nothing
    db.run("DELETE FROM venture_scorecard WHERE id = 'n3'");
    runEach(db, ROLLBACK);
    expect(rows(db).length).toBe(3);
  });
});
