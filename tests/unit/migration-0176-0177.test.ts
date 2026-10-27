// @version 1.0.0
/**
 * Migrations 0176 (human-role grants, approval_chain attribution) and 0177 (na confirmation) -
 * ADR-0186 P1. Applies every earlier migration to a scratch :memory: database, then the target,
 * and proves: additive (pre-existing rows survive untouched), the reversible header, the declared
 * ROLLBACK-SQL really restores the earlier shape, and the engine attribution columns work.
 * ASCII-only source.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";
import { ensureApprovalChain, recordDecision } from "../../db/lib/approval-chain.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const NOW = "2026-10-27T00:00:00Z";
const runSql = (db: Database, sql: string) => { for (const s of splitSqlStatements(sql)) db.run(s); };
const cols = (db: Database, table: string): string[] => (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

function dbBefore(target: string): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) {
    if (f >= target) break;
    runSql(db, readFileSync(join(DIR, f), "utf-8"));
  }
  return db;
}
const rollbackOf = (sql: string): string[] => {
  const block = sql.slice(sql.indexOf("ROLLBACK-SQL-BEGIN"), sql.indexOf("ROLLBACK-SQL-END"));
  return block.split("\n").slice(1).map((l) => l.replace(/^--\s*/, "").trim()).filter(Boolean);
};

describe.each([
  ["0176_"],
  ["0177_"],
] as const)("migration %s", (prefix) => {
  const TARGET = files.find((f) => f.startsWith(prefix))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");

  test("exists, opens with the reversible header form of 0171/0172 and declares ROLLBACK-SQL (ADR-0014)", () => {
    expect(TARGET).toBeDefined();
    expect(SQL.startsWith("-- @reversible: true")).toBe(true);
    expect(SQL).toContain("ADR-0014");
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    expect(SQL).toContain("ROLLBACK-SQL-END");
  });
});

describe("0176 human_role_grant", () => {
  const TARGET = files.find((f) => f.startsWith("0176_"))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");

  test("additive: a pre-existing approval_chain row survives with NULL attribution", () => {
    const db = dbBefore(TARGET);
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p1','p1',?,'fs','internal','greenfield','open')", [NOW]);
    for (const [id, level, gate, seq, role] of [["c1", "entity", "entity_ic", 1, "entity_ic"], ["c2", "group", "group_ic", 2, "group_ic"]] as const) {
      db.run("INSERT INTO approval_chain (id, project_id, level, gate, sequence, approver_role, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'pending',?,?)", [id, "p1", level, gate, seq, role, NOW, NOW]);
    }
    expect(cols(db, "approval_chain")).not.toContain("recorded_by");
    db.transaction(() => runSql(db, SQL))();
    const rows = db.query("SELECT level, recorded_by, decided_by FROM approval_chain ORDER BY sequence").all();
    expect(rows).toEqual([{ level: "entity", recorded_by: null, decided_by: null }, { level: "group", recorded_by: null, decided_by: null }]);
    expect(db.query("SELECT COUNT(*) c FROM app_user_human_role").get()).toEqual({ c: 0 });
  });

  test("the grants table references app_user (foreign key) and the engine records maker / checker attribution", () => {
    const db = dbBefore(TARGET);
    db.transaction(() => runSql(db, SQL))();
    expect(() => db.run("INSERT INTO app_user_human_role (id, user_id, role_key, granted_by, granted_at) VALUES ('g','ghost','entity-ic-reviewer','a',?)", [NOW])).toThrow();
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p2','p2',?,'fs','internal','greenfield','open')", [NOW]);
    ensureApprovalChain(db, { projectId: "p2", recordedBy: "maker", now: NOW });
    recordDecision(db, { projectId: "p2", level: "entity", decision: "approved", decidedAt: NOW, decidedBy: "checker", now: NOW });
    expect(db.query("SELECT recorded_by, decided_by, decision FROM approval_chain WHERE project_id = 'p2' AND level = 'entity'").get()).toEqual({ recorded_by: "maker", decided_by: "checker", decision: "approved" });
    // the engine still works without attribution (existing callers)
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p3','p3',?,'fs','internal','greenfield','open')", [NOW]);
    ensureApprovalChain(db, { projectId: "p3", now: NOW });
    recordDecision(db, { projectId: "p3", level: "entity", decision: "rejected", decidedAt: NOW, now: NOW });
    expect(db.query("SELECT recorded_by, decided_by FROM approval_chain WHERE project_id = 'p3' AND level = 'entity'").get()).toEqual({ recorded_by: null, decided_by: null });
  });

  test("the declared ROLLBACK-SQL restores the pre-0176 shape", () => {
    const db = dbBefore(TARGET);
    const shape = cols(db, "approval_chain");
    db.transaction(() => runSql(db, SQL))();
    for (const stmt of rollbackOf(SQL)) db.run(stmt);
    expect(cols(db, "approval_chain")).toEqual(shape);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'app_user_human_role'").get()).toBeNull();
  });
});

describe("0177 na_confirmation", () => {
  const TARGET = files.find((f) => f.startsWith("0177_"))!;
  const SQL = readFileSync(join(DIR, TARGET), "utf-8");

  test("additive: pre-existing na rows keep their data and read as unconfirmed", () => {
    const db = dbBefore(TARGET);
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p1','p1',?,'fs','internal','greenfield','open')", [NOW]);
    db.run("INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, note, assessed_by, assessed_at) VALUES ('s1','p1','chk-x','x-01','na','legacy reason','alice',?)", [NOW]);
    db.transaction(() => runSql(db, SQL))();
    expect(cols(db, "project_checklist_item_state")).toEqual(expect.arrayContaining(["na_confirmed_by", "na_confirmed_at"]));
    expect(db.query("SELECT status, note, assessed_by, na_confirmed_by, na_confirmed_at FROM project_checklist_item_state WHERE id = 's1'").get())
      .toEqual({ status: "na", note: "legacy reason", assessed_by: "alice", na_confirmed_by: null, na_confirmed_at: null });
  });

  test("the declared ROLLBACK-SQL restores the pre-0177 shape", () => {
    const db = dbBefore(TARGET);
    const shape = cols(db, "project_checklist_item_state");
    db.transaction(() => runSql(db, SQL))();
    for (const stmt of rollbackOf(SQL)) db.run(stmt);
    expect(cols(db, "project_checklist_item_state")).toEqual(shape);
  });
});
