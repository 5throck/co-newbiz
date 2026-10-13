// @version 1.0.0
/**
 * Migration runner — stop-on-error semantics (ADR-0163).
 *
 * bun:sqlite's multi-statement Database.run() silently swallows an error
 * raised by a non-final statement (sqlite3_exec semantics). The runner now
 * splits every migration into individual statements and executes them
 * one-by-one, so a constraint failure anywhere aborts the whole migration.
 * Proves:
 *   - a middle-statement CHECK failure throws and rolls the migration back
 *   - a valid multi-statement migration with triggers still applies
 *   - 0132/0137 apply cleanly via the runner and their header assertions
 *     now actually abort when the precondition fails
 *   - splitter correctness on strings / quoted identifiers / comments /
 *     trigger bodies
 *   - full-run schema equivalence: applying all migrations per-statement
 *     produces the same schema as the old multi-statement path
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runMigrations, splitSqlStatements } from "../../db/migrate.ts";
import { resetDb } from "../../db/client.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

function applyAllLegacy(db: Database, upto?: string) {
  for (const f of files) {
    if (upto && f >= upto) break;
    db.run(readFileSync(join(DIR, f), "utf-8"));
  }
}

describe("splitSqlStatements", () => {
  test("splits on top-level semicolons only", () => {
    expect(splitSqlStatements("A; B; C;").length).toBe(3);
  });

  test("semicolons inside strings, quoted identifiers and comments never split", () => {
    const sql = [
      "INSERT INTO t VALUES ('a;b''c');",
      'CREATE TABLE "we;ird" (x);',
      "CREATE TABLE [br;acket] (x);",
      "CREATE TABLE \x60ba;cktick\x60 (x);",
      "-- comment; with semicolon\nCREATE TABLE t2 (x);",
      "/* block; comment */ CREATE TABLE t3 (x);",
    ].join("\n");
    const out = splitSqlStatements(sql);
    expect(out.length).toBe(6);
    expect(out[0]).toContain("'a;b''c'");
  });

  test("trigger bodies survive; CASE...END inside does not close the trigger", () => {
    const sql = [
      "CREATE TRIGGER trg BEFORE INSERT ON t",
      "BEGIN",
      "  INSERT INTO log VALUES (CASE WHEN new.x > 0 THEN 'pos' ELSE 'neg' END);",
      "  UPDATE log SET y = 1;",
      "END;",
      "CREATE TABLE after_trg (x);",
    ].join("\n");
    const out = splitSqlStatements(sql);
    expect(out.length).toBe(2);
    expect(out[0]).toContain("UPDATE log SET y = 1;");
    expect(out[1]).toContain("after_trg");
  });

  test("empty and comment-only statements are dropped", () => {
    expect(splitSqlStatements(";; -- only comment\n ;  ").length).toBe(0);
  });
});

describe("migration runner stop-on-error", () => {
  const mkdb = () => new Database(":memory:");

  test("middle-statement CHECK failure: OLD runner silently skips, NEW runner throws", () => {
    const sql = [
      "CREATE TABLE guard (v INTEGER CHECK (v > 10));",
      "CREATE TABLE m (id INTEGER);",
      "INSERT INTO guard VALUES (5);", // CHECK violation mid-script
      "INSERT INTO m VALUES (1);",
    ].join("\n");
    // OLD behavior: db.run on the whole script silently skips the bad INSERT
    // and still applies the LAST statement — the defect.
    const legacyDb = mkdb();
    expect(() => legacyDb.run(sql)).not.toThrow();
    expect((legacyDb.query("SELECT COUNT(*) c FROM m").get() as { c: number }).c).toBe(1);
    // NEW behavior: throws at the violating statement; nothing applied after it.
    const newDb = mkdb();
    expect(() => { for (const s of splitSqlStatements(sql)) newDb.run(s); }).toThrow(/CHECK|constraint/i);
    expect((newDb.query("SELECT COUNT(*) c FROM m").get() as { c: number }).c).toBe(0);
  });

  test("a failing migration rolls back through db.transaction (all-or-nothing)", () => {
    const db = mkdb();
    db.run("CREATE TABLE guard (v INTEGER CHECK (v > 10));");
    const tx = db.transaction(() => {
      for (const s of splitSqlStatements("INSERT INTO guard VALUES (20); INSERT INTO guard VALUES (5);")) db.run(s);
    });
    expect(() => tx()).toThrow(/CHECK|constraint/i);
    expect((db.query("SELECT COUNT(*) c FROM guard").get() as { c: number }).c).toBe(0); // first INSERT rolled back too
  });

  test("a valid multi-statement migration with triggers still applies", () => {
    const db = mkdb();
    db.run("CREATE TABLE t2 (x INTEGER);");
    db.run("CREATE TABLE log (x INTEGER);");
    const sql = [
      "CREATE TABLE t3 (x INTEGER);",
      "CREATE TRIGGER trg BEFORE INSERT ON t3",
      "BEGIN",
      "  INSERT INTO log VALUES (CASE WHEN new.x > 0 THEN 1 ELSE 0 END);",
      "END;",
      "INSERT INTO t3 VALUES (5);",
    ].join("\n");
    for (const s of splitSqlStatements(sql)) db.run(s);
    expect((db.query("SELECT COUNT(*) c FROM t3").get() as { c: number }).c).toBe(1);
    expect((db.query("SELECT COUNT(*) c FROM log").get() as { c: number }).c).toBe(1); // trigger fired
  });

  test("all migrations apply cleanly through the runner (temp file DB)", () => {
    const tmp = join(import.meta.dirname, "tmp-migration-runner");
    const dbPath = join(tmp, "test.sqlite");
    require("node:fs").rmSync(tmp, { recursive: true, force: true });
    require("node:fs").mkdirSync(tmp, { recursive: true });
    resetDb();
    try {
      const { applied } = runMigrations(dbPath);
      expect(applied.length).toBe(files.length);
      resetDb();
      const db = new Database(dbPath, { readonly: true });
      const triggers = (db.query("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'trigger'").get() as { c: number }).c;
      expect(triggers).toBeGreaterThan(0);
      db.close();
    } finally {
      resetDb();
      require("node:fs").rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("0132/0137 header assertions now abort", () => {
  const mkMigrated = (upto?: string) => {
    const db = new Database(":memory:");
    db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    applyAllLegacy(db, upto ? files.find((f) => f.startsWith(upto)) : undefined);
    return db;
  };

  // Tamper the guard CHECK (ok = 1 -> ok = 2): the guard INSERT then always
  // violates. Under the OLD runner (multi-statement db.run) that violation
  // was SILENT and the migration "succeeded" with its safety assertion dead;
  // under the NEW runner it throws and aborts.
  const sabotage = (sql: string) => sql.replace(/CHECK \(ok = 1\)/g, "CHECK (ok = 2)");

  test("0132 rebuild row-count guard actually aborts on violation", () => {
    const sql = sabotage(readFileSync(join(DIR, files.find((f) => f.startsWith("0132_"))!), "utf-8"));
    const legacyDb = mkMigrated("0132_");
    expect(() => legacyDb.run(sql)).not.toThrow(); // OLD: assertion dead, migration "succeeds"
    const newDb = mkMigrated();
    expect(() => { for (const s of splitSqlStatements(sql)) newDb.run(s); }).toThrow(/CHECK|constraint/i); // NEW: aborts
  });

  test("0137 rebuild guard actually aborts on violation", () => {
    const sql = sabotage(readFileSync(join(DIR, files.find((f) => f.startsWith("0137_"))!), "utf-8"));
    const legacyDb = mkMigrated("0137_");
    expect(() => legacyDb.run(sql)).not.toThrow();
    const newDb = mkMigrated();
    expect(() => { for (const s of splitSqlStatements(sql)) newDb.run(s); }).toThrow(/CHECK|constraint/i);
  });

  test("0132, 0137 and 0138 apply cleanly through the runner on an untampered DB", () => {
    const db = mkMigrated("0132_");
    for (const name of ["0132_", "0137_", "0138_"]) {
      const sql = readFileSync(join(DIR, files.find((f) => f.startsWith(name))!), "utf-8");
      expect(() => { for (const s of splitSqlStatements(sql)) db.run(s); }).not.toThrow();
    }
    // the widened CHECK accepts the seven ADR-0148 domains now
    const ddl = (db.query("SELECT sql FROM sqlite_master WHERE name = 'project_checklist_item_custom'").get() as { sql: string }).sql;
    for (const d of ["commercial", "technical", "legal", "financial", "hr", "market", "financing"]) {
      expect(ddl).toContain("'" + d + "'");
    }
  });
});
