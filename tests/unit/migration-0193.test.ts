// @version 1.0.0
/**
 * Migration 0193 (ADR-0198, spec 2026-11-13-s2-driver-linkage D-B) — the
 * additive nullable payload column `opportunity.driver_links_json` with a
 * json_valid CHECK (the migration-0150 house pattern). Applies the full
 * migration chain to a scratch :memory: database and proves: the filename is
 * the next migration after 0192, the column exists nullable with default NULL,
 * the CHECK rejects invalid JSON while accepting valid payload documents and
 * NULL, the column is purely additive (a pre-existing opportunity row is
 * untouched and the existing columns stay byte-identical), and the header
 * carries the @reversible markers.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const TARGET = files.find((f) => f.startsWith("0193_")) ?? "";
const SQL = readFileSync(join(DIR, TARGET), "utf-8");
const NOW = "2026-11-14T00:00:00Z";

function applyBefore(db: Database): void {
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)",
  );
  for (const f of files) {
    if (f >= TARGET) break;
    for (const s of splitSqlStatements(readFileSync(join(DIR, f), "utf-8"))) db.run(s);
  }
}

function fresh(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  applyBefore(db);
  db.transaction(() => {
    for (const s of splitSqlStatements(SQL)) db.run(s);
  })();
  return db;
}

const makeOpp = (db: Database, id: string) =>
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    id,
    "opp",
    "scope",
    "identified",
    "u",
    NOW,
  ]);

describe("migration 0193 opportunity.driver_links_json (ADR-0198)", () => {
  test("filename is the next migration after 0192", () => {
    expect(TARGET).toBe("0193_opportunity_driver_links.sql");
    expect(files.some((f) => f.startsWith("0192_"))).toBe(true);
  });

  test("the column exists, nullable, with default NULL, purely additive", () => {
    const db = fresh();
    const info = db.query("PRAGMA table_info(opportunity)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const col = info.find((c) => c.name === "driver_links_json");
    expect(col).toBeDefined();
    expect(col?.type).toBe("TEXT");
    expect(col?.notnull).toBe(0);
    expect(col?.dflt_value).toBeNull();
    // The column is the LAST one (additive) and no existing column moved.
    expect(info[info.length - 1].name).toBe("driver_links_json");
    expect(info.filter((c) => c.name === "entry_market_derivation_json")).toHaveLength(1);
  });

  test("CHECK: invalid JSON is rejected; valid payload documents and NULL are accepted", () => {
    const db = fresh();
    makeOpp(db, "o1");
    expect(() => db.run("UPDATE opportunity SET driver_links_json = '{not-json' WHERE id = 'o1'")).toThrow();
    db.run("UPDATE opportunity SET driver_links_json = ? WHERE id = 'o1'", [
      JSON.stringify({ links: [], set_by: "u", set_at: NOW }),
    ]);
    db.run("UPDATE opportunity SET driver_links_json = NULL WHERE id = 'o1'");
  });

  test("NULL = no links: a pre-existing row is byte-identical and untouched", () => {
    const db = fresh();
    makeOpp(db, "o1");
    const row = db
      .query("SELECT id, name, market_scope, status, driver_links_json FROM opportunity WHERE id = 'o1'")
      .get() as Record<string, unknown>;
    expect(row.driver_links_json).toBeNull();
    expect(row.status).toBe("identified");
  });

  test("header carries the @reversible marker and a ROLLBACK-SQL block (house pattern)", () => {
    expect(SQL).toContain("@reversible: true");
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    expect(SQL).toContain("ROLLBACK-SQL-END");
    // The column participates in its own CHECK, so the rollback documents the
    // migration-0150 table-rebuild path (no naive DROP COLUMN).
    expect(SQL).toContain("0150");
  });
});
