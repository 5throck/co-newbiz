// @version 1.0.0
/**
 * Migration 0137 — project_checklist_item_custom.domain widened to the seven
 * ADR-0148 DD domains by a table rebuild. Proves: pre-existing rows survive
 * verbatim, the column set / index / FKs are unchanged apart from the CHECK,
 * the four new domains insert, an unknown domain still fails, and the header
 * rollback SQL reverses it (and refuses while new-domain rows exist), after
 * which 0137 re-applies cleanly.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0137_"))!;
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
const cols = (db: Database) => db.query("PRAGMA table_info(project_checklist_item_custom)").all();
const fks = (db: Database) => db.query("PRAGMA foreign_key_list(project_checklist_item_custom)").all();
const idx = (db: Database) => db.query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'project_checklist_item_custom' AND sql IS NOT NULL ORDER BY name").all();
const rows = (db: Database) => db.query("SELECT * FROM project_checklist_item_custom ORDER BY id").all();
const insert = (db: Database, id: string, domain: string) =>
  db.run(
    "INSERT INTO project_checklist_item_custom (id, project_id, domain, item_label, rationale, source_reliability, proposed_by_agent, status, approved_by, approved_at, created_at, target_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)",
    [id, "p1", domain, `label-${id}`, `why-${id}`, "C", "commercial-dd-agent", id.endsWith("a") ? "approved" : "proposed", id.endsWith("a") ? "u" : null, id.endsWith("a") ? "2026-02-01" : null, "2026-01-02"],
  );

function seeded(): Database {
  const db = new Database(":memory:");
  applyBefore(db);
  db.run("PRAGMA foreign_keys = ON");
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES ('p1','P-1','2026-01-01')");
  ["commercial", "technical", "legal"].forEach((d, i) => { insert(db, `c${i}`, d); insert(db, `c${i}a`, d); });
  return db;
}

describe("migration 0137 custom DD item domains", () => {
  test("rebuild preserves rows, columns, FKs and index; widens only the domain CHECK", () => {
    const db = seeded();
    const before = { rows: rows(db), cols: cols(db), fks: fks(db), idx: idx(db) };
    expect(before.rows.length).toBe(6);
    expect(() => insert(db, "x1", "hr")).toThrow();
    db.transaction(() => db.run(SQL))();
    expect(rows(db)).toEqual(before.rows);
    expect(cols(db)).toEqual(before.cols);
    expect(fks(db)).toEqual(before.fks);
    expect(idx(db)).toEqual(before.idx);
    expect(db.query("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'project_checklist_item_custom'").get()).toEqual({ c: 0 });
    for (const d of ["financial", "hr", "market", "financing"]) insert(db, `n-${d}`, d);
    expect(() => insert(db, "bad", "tax")).toThrow();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("header rollback reverses the rebuild, refuses while new-domain rows exist, and 0137 re-applies", () => {
    const db = seeded();
    const before = { rows: rows(db), cols: cols(db), idx: idx(db) };
    db.transaction(() => db.run(SQL))();
    insert(db, "n-hr", "hr");
    expect(() => runEach(db, ROLLBACK)).toThrow(/CHECK constraint failed/);
    expect(rows(db).length).toBe(7); // aborted rollback changed nothing
    db.run("DELETE FROM project_checklist_item_custom WHERE id = 'n-hr'");
    runEach(db, ROLLBACK);
    expect(rows(db)).toEqual(before.rows);
    expect(cols(db)).toEqual(before.cols);
    expect(idx(db)).toEqual(before.idx);
    expect(() => insert(db, "x2", "hr")).toThrow();
    db.transaction(() => db.run(SQL))();
    expect(rows(db)).toEqual(before.rows);
    insert(db, "n-mk", "market");
  });
});
