// @version 1.0.0
/**
 * Migration 0199 (queue item states) — ADR-0200 decision 8, design 2026-11-17 section 10.7, test "migration parity +
 * rollback guard". Applies the chain up to 0198 on a scratch SQLite, seeds run items in every legacy state (one with an
 * apply_summary), applies 0199 and proves:
 *   - filename/header: next after 0198, @notransaction, @reversible + ROLLBACK-SQL markers with the drain guard (ADR-0014);
 *   - row parity: every row is copied verbatim (count and content), foreign_key_check is empty, integrity_check is ok;
 *   - shape: the CHECK accepts 'skipped_active' and 'cancelled' and nothing else, UNIQUE and FK cascade survive, both
 *     indexes exist and the dedupe query uses idx_bedri_target_state;
 *   - rollback rehearsal: the guard counts active runs, the ROLLBACK-SQL block maps the new states and rebuilds the 0197-era
 *     table with every row kept.
 */
import { test, expect, describe } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const F199 = files.find((f) => f.startsWith("0199_")) ?? "";
const SQL199 = readFileSync(join(DIR, F199), "utf-8");
const NOW = "2026-11-17T00:00:00Z";
const LEGACY_STATES = [
  "pending",
  "financial_sync",
  "financial_draft",
  "technical_draft",
  "done",
  "failed",
  "skipped_not_dart",
  "skipped_no_company",
  "skipped_llm_unconfigured",
];

const TMP = mkdtempSync(join(tmpdir(), "migration-0199-"));
process.env.CO_NEWBIZ_DB_PATH = join(TMP, "boot.sqlite");
const { runMigrations } = await import("../../db/migrate.ts");
const { getDb, resetDb } = await import("../../db/client.ts");

function chainBefore199(name: string): Database {
  const path = join(TMP, `${name}.sqlite`);
  resetDb();
  const db = getDb(path);
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)",
  );
  for (const f of files.filter((x) => x >= F199)) db.run("INSERT INTO schema_migrations VALUES (?, ?, ?)", [f, f, NOW]);
  runMigrations(path);
  return db;
}
/** @notransaction: statements run outside a transaction so PRAGMA foreign_keys takes effect (as the runner does). */
function apply199(db: Database): void {
  for (const s of splitSqlStatements(SQL199)) db.run(s);
}
/** ROLLBACK-SQL lines in order; the GUARD comment is returned separately. */
function rollback(): { guard: string; statements: string[] } {
  const block = SQL199.split("-- ROLLBACK-SQL-BEGIN")[1]?.split("-- ROLLBACK-SQL-END")[0] ?? "";
  const lines = block.split("\n").map((l) => l.replace(/^--\s*/, "").trim());
  const guardLine = lines.find((l) => l.startsWith("-- GUARD") || l.startsWith("GUARD")) ?? "";
  return {
    guard: guardLine.split("): ")[1]?.replace(/;$/, "") ?? "",
    statements: lines
      .filter((l) => /^(PRAGMA|UPDATE|DROP|CREATE|INSERT|ALTER) /.test(l))
      .map((l) => l.replace(/;$/, "")),
  };
}
const cols = (db: Database, table: string) =>
  (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

function seed(db: Database): string[] {
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES ('opp1','o','s','identified','u',?)",
    [NOW],
  );
  db.run(
    `INSERT INTO brownfield_eval_draft_run (id, opportunity_id, categories, status, total_targets, started_by, started_via, started_at, heartbeat_at)
     VALUES ('r1', 'opp1', 'both', 'completed', ?, 'u', 'web', ?, ?)`,
    [LEGACY_STATES.length, NOW, NOW],
  );
  const ids: string[] = [];
  for (const [i, state] of LEGACY_STATES.entries()) {
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, created_at, updated_at) VALUES (?, 'opp1', ?, ?, ?)",
      [`t${i}`, `c${i}`, NOW, NOW],
    );
    db.run(
      `INSERT INTO brownfield_eval_draft_run_item (id, run_id, brownfield_target_id, seq, state, financial_outcome, dart_calls, error_message, updated_at, apply_summary)
       VALUES (?, 'r1', ?, ?, ?, 'skipped', ?, ?, ?, ?)`,
      [
        `i${i}`,
        `t${i}`,
        i,
        state,
        i,
        state === "failed" ? "x" : null,
        NOW,
        i === 4 ? '{"financial":{"applied":2}}' : null,
      ],
    );
    ids.push(`i${i}`);
  }
  return ids;
}
const dump = (db: Database) =>
  db.query("SELECT * FROM brownfield_eval_draft_run_item ORDER BY id").all() as Array<Record<string, unknown>>;

describe("migration 0199 (ADR-0200 decision 8)", () => {
  test("filename follows 0198 and the header carries the ADR-0014 markers and the drain guard", () => {
    expect(F199).toBe("0199_eval_run_item_queue_states.sql");
    expect(files.some((f) => f.startsWith("0198_"))).toBe(true);
    expect(SQL199.startsWith("-- @notransaction")).toBe(true);
    expect(SQL199).toContain("-- @reversible: true");
    expect(SQL199).toContain("-- ROLLBACK-SQL-BEGIN");
    expect(SQL199).toContain("-- ROLLBACK-SQL-END");
    expect(SQL199).toContain("ADR-0200");
    expect(SQL199).not.toContain("REAL"); // ADR-0061
    const rb = rollback();
    expect(rb.guard).toContain("SELECT COUNT(*) FROM brownfield_eval_draft_run WHERE status IN");
    expect(rb.statements.findIndex((s) => s.startsWith("UPDATE"))).toBeLessThan(
      rb.statements.findIndex((s) => s.startsWith("DROP TABLE")),
    );
  });

  test("row parity: every legacy row is copied verbatim; foreign_key_check and integrity_check are clean", () => {
    const db = chainBefore199("parity");
    seed(db);
    const before = dump(db);
    apply199(db);
    const after = dump(db);
    expect(after).toHaveLength(LEGACY_STATES.length);
    expect(after).toEqual(before);
    expect(cols(db, "brownfield_eval_draft_run_item")).toEqual(Object.keys(before[0]));
    expect(cols(db, "brownfield_eval_draft_run_item")).toContain("apply_summary");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect((db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
  });

  test("shape: the CHECK widens by exactly two states; UNIQUE, FK cascade and both indexes hold", () => {
    const db = chainBefore199("shape");
    seed(db);
    apply199(db);
    const set = (state: string) =>
      db.run("UPDATE brownfield_eval_draft_run_item SET state = ? WHERE id = 'i0'", [state]);
    set("skipped_active");
    set("cancelled");
    expect(() => set("paused")).toThrow(/CHECK/);
    expect(() =>
      db.run("UPDATE brownfield_eval_draft_run_item SET apply_summary = 'not json' WHERE id = 'i0'"),
    ).toThrow(/CHECK/);
    expect(() =>
      db.run(
        "INSERT INTO brownfield_eval_draft_run_item (id, run_id, brownfield_target_id, seq, state, updated_at) VALUES ('dup', 'r1', 't0', 99, 'pending', ?)",
        [NOW],
      ),
    ).toThrow(/UNIQUE/);
    const idx = (
      db
        .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'brownfield_eval_draft_run_item'")
        .all() as Array<{ name: string }>
    ).map((i) => i.name);
    expect(idx).toEqual(expect.arrayContaining(["idx_bedri_run_state", "idx_bedri_target_state"]));
    const plan = db
      .query(
        "EXPLAIN QUERY PLAN SELECT run_id FROM brownfield_eval_draft_run_item WHERE brownfield_target_id = 't1' AND state NOT IN ('done', 'failed')",
      )
      .all() as Array<{ detail: string }>;
    expect(plan.some((p) => p.detail.includes("idx_bedri_target_state"))).toBe(true);
    db.run("PRAGMA foreign_keys = ON");
    db.run("DELETE FROM brownfield_target WHERE id = 't1'");
    expect(
      db.query("SELECT COUNT(*) AS n FROM brownfield_eval_draft_run_item WHERE brownfield_target_id = 't1'").get(),
    ).toEqual({ n: 0 });
  });

  test("rollback rehearsal: guard is 0 after a drain; new states are mapped; the 0197-era table is rebuilt with every row kept", () => {
    const db = chainBefore199("rollback");
    seed(db);
    apply199(db);
    db.run("UPDATE brownfield_eval_draft_run_item SET state = 'cancelled' WHERE id = 'i0'");
    db.run("UPDATE brownfield_eval_draft_run_item SET state = 'skipped_active' WHERE id = 'i1'");
    const rb = rollback();
    db.run("UPDATE brownfield_eval_draft_run SET status = 'running' WHERE id = 'r1'");
    expect((db.query(rb.guard).get() as Record<string, number>)["COUNT(*)"]).toBe(1); // an active run blocks the rollback
    db.run("UPDATE brownfield_eval_draft_run SET status = 'completed' WHERE id = 'r1'");
    expect((db.query(rb.guard).get() as Record<string, number>)["COUNT(*)"]).toBe(0);
    for (const s of rb.statements) db.run(s);
    const rows = dump(db);
    expect(rows).toHaveLength(LEGACY_STATES.length);
    expect(rows.find((r) => r.id === "i0")?.state).toBe("pending"); // cancelled -> pending
    expect(rows.find((r) => r.id === "i1")).toMatchObject({ state: "failed", error_message: "skipped_active" });
    expect(() => db.run("UPDATE brownfield_eval_draft_run_item SET state = 'cancelled' WHERE id = 'i2'")).toThrow(
      /CHECK/,
    );
    expect(cols(db, "brownfield_eval_draft_run_item")).toContain("apply_summary");
    const idx = (
      db
        .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'brownfield_eval_draft_run_item'")
        .all() as Array<{ name: string }>
    ).map((i) => i.name);
    expect(idx).toContain("idx_bedri_run_state");
    expect(idx).not.toContain("idx_bedri_target_state");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
