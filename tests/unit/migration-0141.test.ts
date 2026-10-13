// @version 1.0.0
/**
 * Migration 0141 — establishment notifications + call path (ADR-0165 addendum).
 * Proves: the notification rebuild keeps every column/row/index and accepts the two
 * new trigger types (and still rejects unknown ones), the partial UNIQUE dedupe index,
 * the event `via` column (default 'unknown' for old rows, CHECK), and the header
 * rollback SQL restoring the previous shape (and 0141 re-applying cleanly).
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0141_"))!;
const SQL = readFileSync(join(DIR, TARGET), "utf-8");
const ROLLBACK = (() => {
  const body = SQL.slice(SQL.indexOf("-- ROLLBACK-SQL-BEGIN"), SQL.indexOf("-- ROLLBACK-SQL-END"));
  return body.split("\n").slice(1).map((l) => l.replace(/^--\s?/, "")).join("\n");
})();

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

const NOW = "2026-10-13T00:00:00.000Z";
const cols = (db: Database, t: string) => (db.query(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
const hasIndex = (db: Database, name: string) => !!db.query("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name);

function seed(db: Database): void {
  db.run("PRAGMA foreign_keys = OFF");
  db.run("INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at) VALUES ('n1','u1',NULL,'pipeline_paused','warning','{}','in_app','immediate',?)", [NOW]);
  db.run("INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at) VALUES ('n2','u1',NULL,'staleness','info','{}','in_app','daily',?,?)", [NOW, NOW]);
  db.run("INSERT INTO entity_establishment_step_event (id, step_id, project_id, step_no, kind, to_status, actor_user_id, created_at) VALUES ('e1','s1','p1',1,'status_change','in_progress','alice',?)", [NOW]);
}
const insertNote = (db: Database, over: Record<string, unknown>) => {
  const n = { id: "n" + Math.random().toString(36).slice(2), user_id: "u1", trigger_type: "establishment_step_reopened", dedupe_key: null, ...over };
  db.run(
    "INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, dedupe_key) VALUES (?,?,NULL,?, 'warning','{}','in_app','immediate',?,?)",
    [n.id, n.user_id, n.trigger_type, NOW, n.dedupe_key],
  );
};

describe("migration 0141 establishment notifications + call path", () => {
  test("is declared reversible with rollback SQL and avoids non-deterministic SQL", () => {
    expect(SQL).toContain("@reversible: true");
    expect(ROLLBACK).toContain("DROP TABLE notification");
    expect(ROLLBACK).toContain("DROP COLUMN via");
    expect(SQL).not.toMatch(/datetime\(|CURRENT_TIMESTAMP|strftime\(/i);
  });

  test("rebuild keeps rows, read_at and the three indexes; adds dedupe_key and the unique index", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    const before = cols(db, "notification");
    seed(db);
    db.run(SQL);
    expect(cols(db, "notification")).toEqual([...before, "dedupe_key"]);
    for (const ix of ["idx_notification_cooldown", "idx_notification_user", "idx_notification_user_unread", "idx_notification_dedupe"]) {
      expect(hasIndex(db, ix)).toBe(true);
    }
    expect(db.query("SELECT id, trigger_type, read_at, dedupe_key FROM notification ORDER BY id").all()).toEqual([
      { id: "n1", trigger_type: "pipeline_paused", read_at: null, dedupe_key: null },
      { id: "n2", trigger_type: "staleness", read_at: NOW, dedupe_key: null },
    ]);
  });

  test("accepts the two new trigger types, still rejects unknown ones; dedupe is per (user, key)", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seed(db);
    db.run(SQL);
    insertNote(db, { trigger_type: "establishment_step_reopened", dedupe_key: "k1" });
    insertNote(db, { trigger_type: "establishment_step_assigned", dedupe_key: "k2" });
    expect(() => insertNote(db, { trigger_type: "bogus" })).toThrow();
    expect(() => insertNote(db, { dedupe_key: "k1" })).toThrow(); // same user + key
    insertNote(db, { user_id: "u2", dedupe_key: "k1" }); // another recipient
    insertNote(db, { dedupe_key: null });
    insertNote(db, { dedupe_key: null }); // NULL keys are unconstrained
  });

  test("event.via defaults to unknown for old rows and is CHECK-constrained", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seed(db);
    db.run(SQL);
    expect(db.query("SELECT via FROM entity_establishment_step_event WHERE id='e1'").get()).toEqual({ via: "unknown" });
    const ins = (via: string) =>
      db.run("INSERT INTO entity_establishment_step_event (id, step_id, project_id, step_no, kind, to_status, actor_user_id, via, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ["e" + via, "s1", "p1", 1, "status_change", "in_progress", "alice", via, NOW]);
    for (const v of ["ui", "api", "mcp", "unknown"]) ins(v);
    expect(() => ins("telepathy")).toThrow();
  });

  test("header rollback restores the previous shape; 0141 re-applies", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    const noteCols = cols(db, "notification");
    const evCols = cols(db, "entity_establishment_step_event");
    seed(db);
    db.run(SQL);
    insertNote(db, { dedupe_key: "k1" });
    runEach(db, ROLLBACK);
    expect(cols(db, "notification")).toEqual(noteCols);
    expect(cols(db, "entity_establishment_step_event")).toEqual(evCols);
    expect(hasIndex(db, "idx_notification_dedupe")).toBe(false);
    for (const ix of ["idx_notification_cooldown", "idx_notification_user", "idx_notification_user_unread"]) expect(hasIndex(db, ix)).toBe(true);
    expect((db.query("SELECT COUNT(*) c FROM notification").get() as { c: number }).c).toBe(2); // new-type rows removed, old kept
    expect(() => insertNote(db, { trigger_type: "establishment_step_reopened" })).toThrow();
    db.run(SQL);
    expect(cols(db, "notification")).toContain("dedupe_key");
  });
});
