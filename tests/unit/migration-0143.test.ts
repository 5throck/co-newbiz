// @version 1.0.0
/**
 * Migration 0143 (ADR-0174 slices 1+2) — business_case_line.end_year and the
 * comp_benchmark k-anonymity floor raised to 5.
 *
 * Applies every migration BEFORE 0143 to a scratch :memory: database, seeds
 * legacy rows, then applies 0143 and proves: the additive end_year column
 * exists, the rebuilt comp_benchmark keeps every row verbatim (equal counts,
 * same values), the new CHECK enforces headcount >= 5 (4 fails, 5 inserts,
 * 3 in the pre-migration DB makes the whole migration abort via the guarded
 * assertion), and v_comp_anonymized is recreated and queryable.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0143_"))!;

// Statement-by-statement like runMigrations (ADR-0163): bun:sqlite's
// multi-statement db.run() swallows errors raised by non-final statements,
// so the guarded assertion must be driven the way the real runner drives it.
const runSql = (db: Database, sql: string) => {
  for (const s of splitSqlStatements(sql)) db.run(s);
};

function applyBefore(db: Database): void {
  // Some earlier migrations reference the runner's bookkeeping table.
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) {
    if (f >= TARGET) break;
    runSql(db, readFileSync(join(DIR, f), "utf-8"));
  }
}

const seedComp = (db: Database, id: string, headcount: number) =>
  db.run(
    "INSERT INTO comp_benchmark (id, project_id, job_family, grade, headcount, target_median, acquirer_median, gap_pct, annual_cost_delta, evidence_ref) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, "p1", "생산", "P1", headcount, 30_000_000, 28_000_000, 7.1, 2_000_000, null],
  );

const seedProject = (db: Database) => {
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES ('p1','P-1','2026-01-01')");
  db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES ('m1','p1','greenfield_cost','case',5,'u','2026-01-01')");
};

describe("migration 0143 end_year + comp cohort floor", () => {
  test("end_year column exists; comp rows survive verbatim; view recreated", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seedProject(db);
    seedComp(db, "c1", 5);
    seedComp(db, "c2", 12);
    const before = db.query("SELECT * FROM comp_benchmark ORDER BY id").all();

    db.transaction(() => runSql(db, readFileSync(join(DIR, TARGET), "utf-8")))();

    const cols = (db.query("PRAGMA table_info(business_case_line)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("end_year");
    const after = db.query("SELECT * FROM comp_benchmark ORDER BY id").all();
    expect(after).toEqual(before);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    // The anonymized view is recreated against the rebuilt table and stays queryable.
    const v = db.query("SELECT id, headcount FROM v_comp_anonymized ORDER BY id").all();
    expect(v).toEqual([{ id: "c1", headcount: 5 }, { id: "c2", headcount: 12 }]);
  });

  test("comp CHECK headcount >= 5: 4 rejected, 5 accepted", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    db.transaction(() => runSql(db, readFileSync(join(DIR, TARGET), "utf-8")))();
    seedProject(db);
    expect(() => seedComp(db, "c3", 4)).toThrow();
    seedComp(db, "c4", 5);
    expect((db.query("SELECT COUNT(*) c FROM comp_benchmark").get() as { c: number }).c).toBe(1);
  });

  test("guarded assertion: a headcount=3 row in the pre-migration DB aborts the migration", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seedProject(db);
    seedComp(db, "bad", 3); // pre-migration CHECK floor is 3, so this inserts fine
    expect((db.query("SELECT COUNT(*) c FROM comp_benchmark").get() as { c: number }).c).toBe(1);
    expect(() => db.transaction(() => runSql(db, readFileSync(join(DIR, TARGET), "utf-8")))()).toThrow();
    // The whole migration rolled back: no end_year column, rows intact.
    const cols = (db.query("PRAGMA table_info(business_case_line)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain("end_year");
    expect((db.query("SELECT COUNT(*) c FROM comp_benchmark").get() as { c: number }).c).toBe(1);
    expect((db.query("SELECT COUNT(*) c FROM v_comp_anonymized").get() as { c: number }).c).toBe(1);
  });
});
