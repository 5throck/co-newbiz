// @version 1.0.0
/**
 * Migration 0132 (ADR-0157) — the target axis on DD state.
 *
 * Applies every migration BEFORE 0132 to a scratch database, seeds legacy DD
 * state rows, then applies 0132 and proves: the project_checklist_item_state
 * rebuild preserved every row verbatim (equal row counts, same ids/values,
 * target_id NULL — no backfill), the old inline UNIQUE is replaced by a
 * per-target unique index, and the additive columns / dd_target_open exist.
 */
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const TARGET = files.find((f) => f.startsWith("0132_"))!;

function applyBefore(db: Database): void {
  // Some earlier migrations reference the runner's bookkeeping table.
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  for (const f of files) {
    if (f >= TARGET) break;
    db.run(readFileSync(join(DIR, f), "utf-8"));
  }
}

describe("migration 0132 dd target axis", () => {
  test("rebuild copies every legacy state row verbatim and keeps the gate scope NULL", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    db.run("PRAGMA foreign_keys = ON");
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES ('p1','P-1','2026-01-01'), ('p2','P-2','2026-01-01')");
    const rows: Array<[string, string, string, string, string]> = [];
    for (let i = 0; i < 25; i++) rows.push([`s${i}`, i % 2 ? "p1" : "p2", `chk-${i % 3}`, `item-${i}`, i % 4 === 0 ? "fail" : "pass"]);
    for (const [id, project, checklist, item, status] of rows) {
      db.run(
        "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, note, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?,?)",
        [id, project, checklist, item, status, `note-${id}`, "u", "2026-01-02"],
      );
    }
    const before = db.query("SELECT id, project_id, checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at FROM project_checklist_item_state ORDER BY id").all();
    expect(before.length).toBe(25);

    db.transaction(() => db.run(readFileSync(join(DIR, TARGET), "utf-8")))();

    const after = db.query("SELECT id, project_id, checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at FROM project_checklist_item_state ORDER BY id").all();
    expect(after.length).toBe(before.length);
    expect(after).toEqual(before);
    expect((db.query("SELECT COUNT(*) c FROM project_checklist_item_state WHERE target_id IS NOT NULL").get() as { c: number }).c).toBe(0);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("uniqueness is per (project, target, checklist, item); additive columns and dd_target_open exist", () => {
    const db = new Database(":memory:");
    applyBefore(db);
    db.transaction(() => db.run(readFileSync(join(DIR, TARGET), "utf-8")))();
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES ('p1','P-1','2026-01-01')");
    db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES ('o1','opp','selected','u','2026-01-01')");
    db.run("INSERT INTO brownfield_target (id, opportunity_id, company_name, status, created_at, updated_at) VALUES ('tB','o1','B','shortlisted','2026-01-01','2026-01-01')");
    const ins = (id: string, target: string | null) =>
      db.run(
        "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at, target_id) VALUES (?, 'p1', 'c', 'i', 'pass', 'u', 'now', ?)",
        [id, target],
      );
    ins("a", null);
    expect(() => ins("b", null)).toThrow(); // same scope, same item
    ins("c", "tB"); // another scope, same item is fine
    expect(() => ins("d", "tB")).toThrow();

    for (const [table, col] of [["project_checklist_item_custom", "target_id"], ["dd_finding", "target_id"], ["waiver", "target_id"], ["project_checklist_item_state", "target_id"], ["gate_decision_stale", "stale_at"]] as const) {
      const cols = (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols).toContain(col);
    }
    db.run("INSERT INTO dd_target_open (id, project_id, target_id, opened_by, opened_at, rationale) VALUES ('x','p1','tB','u','now','r')");
    expect(() => db.run("INSERT INTO dd_target_open (id, project_id, target_id, opened_by, opened_at, rationale) VALUES ('y','p1','tB','u','now','r')")).toThrow();
    expect(() => db.run("INSERT INTO dd_target_open (id, project_id, target_id, opened_by, opened_at, rationale, source) VALUES ('z','p1','tB','u','now','r','bogus')")).toThrow();
  });
});
