// @version 1.0.0
/**
 * Migration 0140 — establishment step assignee + append-only event history
 * (ADR-0165). Proves: additive columns/table/indexes exist, existing rows
 * survive with a NULL assignee, the event CHECKs (reopen needs a >= 10 char
 * reason and done -> in_progress) hold, and the header rollback SQL removes
 * everything 0140 added and 0140 re-applies cleanly.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0140_"))!;
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
const stepCols = (db: Database) => (db.query("PRAGMA table_info(entity_establishment_step)").all() as Array<{ name: string }>).map((c) => c.name);
const hasTable = (db: Database, name: string) => !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const hasIndex = (db: Database, name: string) => !!db.query("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name);

function seedStep(db: Database): void {
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES ('o1','n','m','selected','u',?)", [NOW]);
  db.run(
    `INSERT INTO entity_establishment_step (id, opportunity_id, step_no, status, origin, owner, updated_at)
     VALUES ('s1','o1',1,'done','internal','alice',?)`,
    [NOW],
  );
}

function insertEvent(db: Database, over: Record<string, unknown>): void {
  const e = {
    id: "e" + Math.random().toString(36).slice(2), step_id: "s1", project_id: "p1", step_no: 1, kind: "status_change",
    from_status: null, to_status: "in_progress", from_assignee: null, to_assignee: null, reason: null, evidence_url: null,
    actor_user_id: "alice", audit_id: null, created_at: NOW, ...over,
  };
  db.run(
    `INSERT INTO entity_establishment_step_event
       (id, step_id, project_id, step_no, kind, from_status, to_status, from_assignee, to_assignee, reason, evidence_url, actor_user_id, audit_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [e.id, e.step_id, e.project_id, e.step_no, e.kind, e.from_status, e.to_status, e.from_assignee, e.to_assignee, e.reason, e.evidence_url, e.actor_user_id, e.audit_id, e.created_at],
  );
}

describe("migration 0140 establishment assignee + event history", () => {
  test("is declared reversible with rollback SQL", () => {
    expect(SQL).toContain("@reversible: true");
    expect(ROLLBACK).toContain("DROP TABLE entity_establishment_step_event");
    expect(SQL).not.toMatch(/datetime\(|CURRENT_TIMESTAMP|strftime\(/i);
  });

  test("adds columns, table and indexes; existing rows keep a NULL assignee", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seedStep(db);
    db.run(SQL);
    expect(stepCols(db)).toEqual(expect.arrayContaining(["assignee_user_id", "assigned_by", "assigned_at"]));
    expect(hasTable(db, "entity_establishment_step_event")).toBe(true);
    expect(hasIndex(db, "idx_eese_project")).toBe(true);
    expect(hasIndex(db, "idx_ees_assignee")).toBe(true);
    const row = db.query("SELECT status, owner, assignee_user_id FROM entity_establishment_step WHERE id='s1'").get() as Record<string, unknown>;
    expect(row).toEqual({ status: "done", owner: "alice", assignee_user_id: null });
  });

  test("event CHECKs: reopen needs a reason of 10+ chars and done -> in_progress", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seedStep(db);
    db.run(SQL);
    db.run("PRAGMA foreign_keys = OFF"); // CHECK behaviour only; project row not needed
    const reopen = { kind: "reopen", from_status: "done", to_status: "in_progress" };
    expect(() => insertEvent(db, { ...reopen, reason: null })).toThrow();
    expect(() => insertEvent(db, { ...reopen, reason: "short" })).toThrow();
    expect(() => insertEvent(db, { ...reopen, reason: "          " })).toThrow();
    expect(() => insertEvent(db, { ...reopen, from_status: "in_progress", reason: "a sufficiently long reason" })).toThrow();
    expect(() => insertEvent(db, { ...reopen, to_status: "halted", reason: "a sufficiently long reason" })).toThrow();
    insertEvent(db, { ...reopen, reason: "a sufficiently long reason" });
    insertEvent(db, { kind: "assign", to_status: null, to_assignee: "bob" });
    expect(() => insertEvent(db, { kind: "bogus" })).toThrow();
    expect(() => insertEvent(db, { step_no: 6 })).toThrow();
    expect(() => insertEvent(db, { to_status: "finished" })).toThrow();
  });

  test("header rollback removes everything 0140 added; 0140 re-applies", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seedStep(db);
    const colsBefore = stepCols(db);
    db.run(SQL);
    runEach(db, ROLLBACK);
    expect(stepCols(db)).toEqual(colsBefore);
    expect(hasTable(db, "entity_establishment_step_event")).toBe(false);
    expect(hasIndex(db, "idx_ees_assignee")).toBe(false);
    expect(db.query("SELECT COUNT(*) c FROM entity_establishment_step").get()).toEqual({ c: 1 });
    db.run(SQL);
    expect(hasTable(db, "entity_establishment_step_event")).toBe(true);
  });
});
