// @version 1.0.0
/**
 * Migration 0138 — project.site_required no longer requires an evidence_ref
 * (ADR-0160 addendum (d), user decision 2026-10-12). Proves: only that one
 * evidence_var row changes, the header rollback restores 0136's value, and
 * 0138 re-applies cleanly.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0138_"))!;
const SQL = readFileSync(join(DIR, TARGET), "utf-8");
const ROLLBACK = (() => {
  const body = SQL.slice(SQL.indexOf("-- ROLLBACK-SQL-BEGIN"), SQL.indexOf("-- ROLLBACK-SQL-END"));
  return body.split("\n").slice(1).map((l) => l.replace(/^--\s?/, "")).join("\n");
})();

function applyBefore(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) {
    if (f >= TARGET) break;
    db.run(readFileSync(join(DIR, f), "utf-8"));
  }
}
const vars = (db: Database) => db.query("SELECT * FROM evidence_var ORDER BY var_key").all() as Record<string, unknown>[];

describe("migration 0138 site_required without evidence_ref", () => {
  test("is declared reversible with rollback SQL and uses no dynamic date", () => {
    expect(SQL).toContain("@reversible: true");
    expect(ROLLBACK).toContain("requires_evidence_ref = 1");
    expect(SQL).not.toMatch(/datetime\(|CURRENT_TIMESTAMP|strftime\(/i);
  });

  test("clears requires_evidence_ref on project.site_required only", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    const before = vars(db);
    db.run(SQL);
    const after = vars(db);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      if (before[i].var_key === "project.site_required") {
        expect(before[i].requires_evidence_ref).toBe(1);
        expect(after[i]).toEqual({ ...before[i], requires_evidence_ref: 0 });
      } else {
        expect(after[i]).toEqual(before[i]);
      }
    }
  });

  test("header rollback restores 0136's value; 0138 re-applies", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    const before = vars(db);
    db.run(SQL);
    db.run(ROLLBACK);
    expect(vars(db)).toEqual(before);
    db.run(SQL);
    expect((db.query("SELECT requires_evidence_ref r FROM evidence_var WHERE var_key = 'project.site_required'").get() as { r: number }).r).toBe(0);
  });
});
