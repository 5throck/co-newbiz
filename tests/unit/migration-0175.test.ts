// @version 1.0.0
/**
 * Migration 0175 (condition_precedent + approval_chain.gate_decision_id / decision_reason) - ADR-0186 P3.
 * Applies every other migration to a scratch :memory: database first (so 0175 arrives LATE, after 0176 / 0177,
 * exactly as on a database that already ran P1), then the target, and proves: the reversible header form, additive
 * (existing approval_chain rows survive with NULL links), the constraints (gate / clear_by / status CHECKs, foreign
 * keys), the guard triggers (never deleted, a closed row is immutable), the effective-state link, and that the
 * declared ROLLBACK-SQL really restores the earlier shape. ASCII-only source.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";
import { ensureApprovalChain, recordDecision } from "../../db/lib/approval-chain.ts";
import { countersignState } from "../../db/lib/gate-effective.ts";
import { closeCondition, ConditionError, insertConditions, listConditions, openConditions } from "../../db/repositories/condition-precedent.repository.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0175_"))!;
const SQL = readFileSync(join(DIR, TARGET), "utf-8");
const NOW = "2026-10-27T00:00:00Z";
const runSql = (db: Database, sql: string) => { for (const s of splitSqlStatements(sql)) db.run(s); };
const cols = (db: Database, table: string): string[] => (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
const rollbackOf = (sql: string): string[] => {
  const block = sql.slice(sql.indexOf("ROLLBACK-SQL-BEGIN"), sql.indexOf("ROLLBACK-SQL-END"));
  return block.split("\n").slice(1).map((l) => l.replace(/^--\s*/, "").trim()).filter(Boolean);
};

/** Every migration except 0175 applied: 0175 is a late arrival after 0176 / 0177. */
function dbWithoutTarget(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) if (f !== TARGET) runSql(db, readFileSync(join(DIR, f), "utf-8"));
  return db;
}

function seedProjectWithDecision(db: Database, decisionGate: "entity_ic" | "group_ic" = "entity_ic"): { projectId: string; decisionId: string } {
  db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p1','p1',?,'fs','internal','greenfield','open')", [NOW]);
  db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES ('d1','project','p1',?,'go','r','maker',?)", [decisionGate, NOW]);
  return { projectId: "p1", decisionId: "d1" };
}

describe("0175 condition_precedent", () => {
  test("exists, opens with the reversible header form and declares ROLLBACK-SQL (ADR-0014)", () => {
    expect(TARGET).toBeDefined();
    expect(SQL.startsWith("-- @reversible: true")).toBe(true);
    expect(SQL).toContain("ADR-0014");
    expect(SQL).toContain("ROLLBACK-SQL-BEGIN");
    expect(SQL).toContain("ROLLBACK-SQL-END");
    // numbering: 0175 sorts between 0174 and 0176 (the gap P1 left)
    expect(files.indexOf(TARGET)).toBe(files.indexOf("0174_kill_criteria_override.sql") + 1);
  });

  test("additive: a pre-existing approval_chain row survives with NULL links and a decided row keeps its data", () => {
    const db = dbWithoutTarget();
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p0','p0',?,'fs','internal','greenfield','open')", [NOW]);
    // written with raw SQL: the engine itself needs the 0175 columns (code and migration ship together)
    db.run("INSERT INTO approval_chain (id, project_id, level, gate, sequence, approver_role, status, decision, decided_at, created_at, updated_at, recorded_by, decided_by) VALUES ('c0','p0','entity','entity_ic',1,'entity_ic','approved','approved',?,?,?,'maker','checker')", [NOW, NOW, NOW]);
    expect(cols(db, "approval_chain")).not.toContain("gate_decision_id");
    db.transaction(() => runSql(db, SQL))();
    expect(cols(db, "approval_chain")).toEqual(expect.arrayContaining(["gate_decision_id", "decision_reason"]));
    expect(db.query("SELECT recorded_by, decided_by, decision, gate_decision_id, decision_reason FROM approval_chain WHERE project_id = 'p0' AND level = 'entity'").get())
      .toEqual({ recorded_by: "maker", decided_by: "checker", decision: "approved", gate_decision_id: null, decision_reason: null });
    expect(db.query("SELECT COUNT(*) c FROM condition_precedent").get()).toEqual({ c: 0 });
  });

  test("CHECK constraints and foreign keys hold", () => {
    const db = dbWithoutTarget();
    db.transaction(() => runSql(db, SQL))();
    const { projectId, decisionId } = seedProjectWithDecision(db);
    const ins = (over: Record<string, unknown>) => {
      const row = { id: "c1", project_id: projectId, source_decision_id: decisionId, gate: "entity_ic", text: "t", clear_by: "closing", status: "open", created_by: "maker", created_at: NOW, ...over };
      db.run(
        "INSERT INTO condition_precedent (id, project_id, source_decision_id, gate, text, clear_by, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [row.id, row.project_id, row.source_decision_id, row.gate, row.text, row.clear_by, row.status, row.created_by, row.created_at] as never,
      );
    };
    expect(() => ins({ gate: "fs" })).toThrow(/CHECK/);
    expect(() => ins({ clear_by: "someday" })).toThrow(/CHECK/);
    expect(() => ins({ status: "done" })).toThrow(/CHECK/);
    expect(() => ins({ project_id: "ghost" })).toThrow(/FOREIGN KEY/);
    expect(() => ins({ source_decision_id: "ghost" })).toThrow(/FOREIGN KEY/);
    ins({});
    expect(db.query("SELECT origin, status FROM condition_precedent WHERE id = 'c1'").get()).toEqual({ origin: "recorder", status: "open" });
  });

  test("rows are never deleted and a closed row is immutable (triggers); the repository closes an open one once", () => {
    const db = dbWithoutTarget();
    db.transaction(() => runSql(db, SQL))();
    const { projectId, decisionId } = seedProjectWithDecision(db);
    const [id] = insertConditions(db, { projectId, decisionId, gate: "entity_ic", items: [{ text: "Obtain the landlord consent before closing", clear_by: "closing" }], createdBy: "maker", now: NOW });
    expect(() => db.run("DELETE FROM condition_precedent WHERE id = ?", [id])).toThrow(/never deleted/);
    // creator cannot close; evidence is required for a closing condition
    expect(() => closeCondition(db, { projectId, id, to: "cleared", by: "maker", note: "done by me", evidenceRef: "doc:1", now: NOW })).toThrow(ConditionError);
    expect(() => closeCondition(db, { projectId, id, to: "cleared", by: "checker", note: "consent received", now: NOW })).toThrow(/evidence/);
    const closed = closeCondition(db, { projectId, id, to: "cleared", by: "checker", note: "consent received", evidenceRef: "doc:1", now: NOW });
    expect(closed).toMatchObject({ status: "cleared", cleared_by: "checker", evidence_ref: "doc:1" });
    expect(() => closeCondition(db, { projectId, id, to: "withdrawn", by: "checker", note: "again", now: NOW })).toThrow(/already cleared/);
    expect(() => db.run("UPDATE condition_precedent SET text = 'edited' WHERE id = ?", [id])).toThrow(/immutable/);
    expect(openConditions(db, projectId, ["closing"])).toEqual([]);
    expect(listConditions(projectId, { db })).toHaveLength(1);
  });

  test("approval_chain.gate_decision_id links the checker's decision to ONE gate decision (a later GO is un-countersigned)", () => {
    const db = dbWithoutTarget();
    // a pre-contract decision: it exists BEFORE the migration, so it falls at or below the persisted cutoff
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p1','p1',?,'fs','internal','greenfield','open')", [NOW]);
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES ('d3','project','p1','group_ic','go','legacy','maker',?)", [NOW]);
    db.transaction(() => runSql(db, SQL))();
    expect(db.query("SELECT name, max_decision_rowid FROM gate_integrity_cutoff").get()).toEqual({ name: "maker_checker", max_decision_rowid: 1 });
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES ('d1','project','p1','entity_ic','go','r','maker',?)", [NOW]);
    const projectId = "p1";
    const decisionId = "d1";
    const ref = { id: decisionId, gate: "entity_ic", decision: "go", decided_by: "maker" };
    // no snapshot row and AFTER the cutoff: pending, never legacy (security review B1)
    expect(countersignState(db, projectId, ref)).toBe("pending_countersign");
    db.run("INSERT INTO gate_decision_snapshot (decision_id, schema_version, snapshot_json, snapshot_hash, computed_at, engine_versions_json) VALUES (?,1,'{}','h',?,'{}')", [decisionId, NOW]);
    expect(countersignState(db, projectId, ref)).toBe("pending_countersign");
    ensureApprovalChain(db, { projectId, recordedBy: "maker", now: NOW });
    recordDecision(db, { projectId, level: "entity", decision: "approved", decidedAt: NOW, decidedBy: "checker", gateDecisionId: decisionId, decisionReason: "reviewed the package", now: NOW });
    expect(countersignState(db, projectId, ref)).toBe("countersigned");
    // the same person on both seats is never a countersign
    db.run("UPDATE approval_chain SET decided_by = 'maker' WHERE project_id = ? AND level = 'entity'", [projectId]);
    expect(countersignState(db, projectId, ref)).toBe("pending_countersign");
    // a re-decision (a new GO) is not covered by the earlier countersign
    db.run("UPDATE approval_chain SET decided_by = 'checker' WHERE project_id = ? AND level = 'entity'", [projectId]);
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES ('d2','project',?,'entity_ic','go','r2','maker','2026-10-27T01:00:00Z')", [projectId]);
    expect(countersignState(db, projectId, { id: "d2", gate: "entity_ic", decision: "go", decided_by: "maker" })).toBe("pending_countersign");
    // the pre-contract decision is legacy: effective as recorded
    expect(countersignState(db, projectId, { id: "d3", gate: "group_ic", decision: "go", decided_by: "maker" })).toBe("legacy");
    // HOLD / KILL and non-IC gates need no countersign
    expect(countersignState(db, projectId, { id: "x", gate: "entity_ic", decision: "hold", decided_by: "maker" })).toBe("not_applicable");
    expect(countersignState(db, projectId, { id: "x", gate: "dd", decision: "go", decided_by: "maker" })).toBe("not_applicable");
    // the cutoff is fixed once written; an open condition changes only its close columns
    expect(() => db.run("UPDATE gate_integrity_cutoff SET max_decision_rowid = 99")).toThrow(/fixed once written/);
    expect(() => db.run("DELETE FROM gate_integrity_cutoff")).toThrow(/fixed once written/);
    const [cid] = insertConditions(db, { projectId, decisionId, gate: "entity_ic", items: [{ text: "Obtain the landlord consent letter", clear_by: "closing" }], createdBy: "maker", now: NOW });
    expect(() => db.run("UPDATE condition_precedent SET text = 'edited' WHERE id = ?", [cid])).toThrow(/may change only/);
    db.run("UPDATE condition_precedent SET status = 'withdrawn', cleared_by = 'u', cleared_at = ?, clear_note = 'n' WHERE id = ?", [NOW, cid]);
  });

  test("H1: gate_decision rows are never deleted and a new row cannot claim a rowid at or below the legacy cutoff", () => {
    const db = dbWithoutTarget();
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p1','p1',?,'fs','internal','greenfield','open')", [NOW]);
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES ('old','project','p1','dd','go','r','u',?)", [NOW]);
    db.transaction(() => runSql(db, SQL))();
    const row = (id: string, rowid?: number) =>
      db.run(`INSERT INTO gate_decision (${rowid ? "rowid, " : ""}id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (${rowid ? `${rowid}, ` : ""}'${id}','project','p1','entity_ic','go','r','u',?)`, [NOW]);
    expect(() => row("forged", 1)).toThrow(/legacy cutoff/); // an explicit legacy rowid would forge an effective decision
    row("fresh"); // auto-assigned rowids (above the cutoff) are unaffected
    expect((db.query("SELECT rowid r FROM gate_decision WHERE id = 'fresh'").get() as { r: number }).r).toBeGreaterThan(1);
    expect(() => db.run("DELETE FROM gate_decision WHERE id = 'old'")).toThrow(/never deleted/);
    expect(() => db.run("DELETE FROM gate_decision WHERE id = 'fresh'")).toThrow(/never deleted/);
    expect(db.query("SELECT COUNT(*) c FROM gate_decision").get()).toEqual({ c: 2 });
  });

  test("the declared ROLLBACK-SQL restores the pre-0175 shape", () => {
    const db = dbWithoutTarget();
    const shape = cols(db, "approval_chain");
    db.transaction(() => runSql(db, SQL))();
    expect(cols(db, "approval_chain").length).toBe(shape.length + 2);
    for (const stmt of rollbackOf(SQL)) db.run(stmt);
    expect(cols(db, "approval_chain")).toEqual(shape);
    expect(db.query("SELECT name FROM sqlite_master WHERE name LIKE '%condition_precedent%' OR name LIKE '%gate_integrity_cutoff%' OR name LIKE 'trg_gate_decision_no_%'").all()).toEqual([]);
  });
});
