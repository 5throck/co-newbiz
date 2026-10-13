// @version 1.0.0
/**
 * Migration 0142 — Green Field establishment mode (ADR-0167).
 * Proves: the backfill (origin internal/joint -> new_entity, others NULL, step
 * rows default new_entity and are otherwise unchanged), the CHECK constraints
 * (mode values, business_unit only with origin internal, event reason rule),
 * the routing var seed, and the header rollback SQL restoring the previous
 * shape (and 0142 re-applying cleanly).
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0142_"))!;
const SQL = readFileSync(join(DIR, TARGET), "utf-8");
const ROLLBACK = (() => {
  const body = SQL.slice(SQL.indexOf("-- ROLLBACK-SQL-BEGIN"), SQL.indexOf("-- ROLLBACK-SQL-END"));
  return body.split("\n").slice(1).map((l) => l.replace(/^--\s?/, "")).join("\n");
})();

function exec(db: Database, sql: string): void {
  db.transaction(() => {
    for (const stmt of splitSqlStatements(sql)) db.run(stmt);
  })();
}
function applyBefore(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) {
    if (f >= TARGET) break;
    exec(db, readFileSync(join(DIR, f), "utf-8"));
  }
}
const NOW = "2026-10-14T00:00:00.000Z";
const cols = (db: Database, t: string) => (db.query(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
const mode = (db: Database, id: string) => (db.query("SELECT establishment_mode m FROM md_project WHERE id = ?").get(id) as { m: string | null }).m;

function seed(db: Database): void {
  db.run("PRAGMA foreign_keys = OFF");
  for (const [id, origin, track] of [["p-int", "internal", "greenfield"], ["p-joint", "joint", "greenfield"], ["p-ext", "external", "brownfield"], ["p-null", null, "greenfield"], ["p-bf-int", "internal", "brownfield"]] as const) {
    db.run("INSERT INTO md_project (id, project_no, created_at, origin, track) VALUES (?,?,?,?,?)", [id, `NP-${id}`, NOW, origin, track]);
  }
  db.run("INSERT INTO entity_establishment_step (id, opportunity_id, project_id, step_no, status, origin, owner, updated_at) VALUES ('s1','o1','p-int',1,'done','internal','alice',?)", [NOW]);
  db.run("INSERT INTO entity_establishment_step_event (id, step_id, project_id, step_no, kind, to_status, actor_user_id, created_at) VALUES ('e1','s1','p-int',1,'status_change','done','alice',?)", [NOW]);
}

describe("migration 0142 establishment mode", () => {
  test("is declared reversible with rollback SQL and avoids non-deterministic SQL", () => {
    expect(SQL).toContain("@reversible: true");
    expect(ROLLBACK).toContain("DROP TABLE establishment_mode_event");
    expect(ROLLBACK).toContain("DROP COLUMN establishment_mode");
    expect(SQL).not.toMatch(/datetime\(|CURRENT_TIMESTAMP|strftime\(/i);
  });

  test("backfill: internal/joint -> new_entity, others stay NULL; existing step rows default new_entity and are unchanged", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seed(db);
    exec(db, SQL);
    expect(mode(db, "p-int")).toBe("new_entity");
    expect(mode(db, "p-joint")).toBe("new_entity");
    expect(mode(db, "p-bf-int")).toBe("new_entity");
    expect(mode(db, "p-ext")).toBeNull();
    expect(mode(db, "p-null")).toBeNull();
    expect(db.query("SELECT mode, status, step_no, owner FROM entity_establishment_step WHERE id='s1'").get()).toEqual({ mode: "new_entity", status: "done", step_no: 1, owner: "alice" });
    expect(db.query("SELECT mode FROM entity_establishment_step_event WHERE id='e1'").get()).toEqual({ mode: "new_entity" });
    expect(db.query("SELECT establishment_mode_suggested s FROM md_project WHERE id='p-int'").get()).toEqual({ s: null });
  });

  test("CHECKs: unknown mode rejected; business_unit needs origin internal; step/event mode values constrained", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seed(db);
    exec(db, SQL);
    expect(() => db.run("UPDATE md_project SET establishment_mode = 'franchise' WHERE id = 'p-int'")).toThrow();
    expect(() => db.run("UPDATE md_project SET establishment_mode = 'business_unit' WHERE id = 'p-joint'")).toThrow();
    expect(() => db.run("UPDATE md_project SET establishment_mode = 'business_unit' WHERE id = 'p-ext'")).toThrow();
    db.run("UPDATE md_project SET establishment_mode = 'business_unit' WHERE id = 'p-int'");
    expect(mode(db, "p-int")).toBe("business_unit");
    expect(() => db.run("UPDATE md_project SET establishment_mode_suggested = 'x' WHERE id = 'p-int'")).toThrow();
    expect(() => db.run("INSERT INTO entity_establishment_step (id, opportunity_id, project_id, step_no, status, origin, owner, updated_at, mode) VALUES ('s2','o1','p-int',1,'pending','internal','a',?, 'x')", [NOW])).toThrow();
    db.run("INSERT INTO entity_establishment_step (id, opportunity_id, project_id, step_no, status, origin, owner, updated_at, mode) VALUES ('s2','o1','p-int',1,'pending','internal','a',?, 'business_unit')", [NOW]);
  });

  test("establishment_mode_event: a change needs from_mode != to_mode and a reason of >= 10 chars; a first set needs neither", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    seed(db);
    exec(db, SQL);
    const ins = (kind: string, from: string | null, to: string, reason: string | null) =>
      db.run("INSERT INTO establishment_mode_event (id, project_id, kind, from_mode, to_mode, reason, actor_user_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        ["m" + Math.random(), "p-int", kind, from, to, reason, "alice", NOW]);
    ins("set", null, "new_entity", null);
    expect(() => ins("change", "new_entity", "business_unit", "short")).toThrow();
    expect(() => ins("change", "new_entity", "business_unit", null)).toThrow();
    expect(() => ins("change", "new_entity", "new_entity", "long enough reason")).toThrow();
    expect(() => ins("change", null, "business_unit", "long enough reason")).toThrow();
    ins("change", "new_entity", "business_unit", "long enough reason");
  });

  test("seeds the project.establishment_mode routing var", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    exec(db, SQL);
    expect(db.query("SELECT value_type, source_kind, requires_evidence_ref FROM evidence_var WHERE var_key='project.establishment_mode'").get())
      .toEqual({ value_type: "string", source_kind: "column", requires_evidence_ref: 0 });
  });

  test("header rollback restores the previous shape; 0142 re-applies", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    const mp = cols(db, "md_project");
    const st = cols(db, "entity_establishment_step");
    const ev = cols(db, "entity_establishment_step_event");
    seed(db);
    exec(db, SQL);
    exec(db, ROLLBACK);
    expect(cols(db, "md_project")).toEqual(mp);
    expect(cols(db, "entity_establishment_step")).toEqual(st);
    expect(cols(db, "entity_establishment_step_event")).toEqual(ev);
    expect(db.query("SELECT 1 FROM sqlite_master WHERE name='establishment_mode_event'").get()).toBeNull();
    expect(db.query("SELECT 1 FROM evidence_var WHERE var_key='project.establishment_mode'").get()).toBeNull();
    exec(db, SQL);
    expect(cols(db, "md_project")).toContain("establishment_mode");
    expect(mode(db, "p-int")).toBe("new_entity");
  });
});
