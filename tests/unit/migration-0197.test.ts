// @version 1.0.0
/**
 * Migration 0197 (verdict origin) — ADR-0200, spec 2026-11-17-s6-direct-ai-verdict §3.3, test TA1. Applies the chain up
 * to 0196 on a scratch SQLite, seeds pre-0197 verdicts (some carrying an ADR-0199 confirmed_from_version_id link), applies
 * 0197, and proves:
 *   - filename/header: next after 0196, @reversible + ROLLBACK-SQL markers (ADR-0014), no REAL money column (ADR-0061);
 *   - backfill: every existing row is 'human'; source_version_id equals confirmed_from_version_id on every row;
 *     foreign_key_check returns 0 rows and integrity_check returns ok (the dba health-after checks);
 *   - shape: the two columns, the FK, the CHECKs (verdict_source vocabulary, apply_summary json_valid), the two partial
 *     indexes, and that the "unreviewed" query uses the partial index;
 *   - rollback rehearsal: the ROLLBACK-SQL block resets non-human verdicts to pending BEFORE verdict_source is dropped,
 *     and runs cleanly in its stated order.
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
const F197 = files.find((f) => f.startsWith("0197_")) ?? "";
const SQL197 = readFileSync(join(DIR, F197), "utf-8");
const NOW = "2026-11-17T00:00:00Z";

const TMP = mkdtempSync(join(tmpdir(), "migration-0197-"));
process.env.CO_NEWBIZ_DB_PATH = join(TMP, "boot.sqlite");
const { runMigrations } = await import("../../db/migrate.ts");
const { getDb, resetDb } = await import("../../db/client.ts");

/** Every migration before 0197 through the real runner; 0197 is applied by `apply197`. */
function chainBefore197(name: string): Database {
  const path = join(TMP, `${name}.sqlite`);
  resetDb();
  const db = getDb(path);
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)",
  );
  for (const f of files.filter((x) => x >= F197)) db.run("INSERT INTO schema_migrations VALUES (?, ?, ?)", [f, f, NOW]);
  runMigrations(path);
  return db;
}
function apply197(db: Database): void {
  db.transaction(() => {
    for (const s of splitSqlStatements(SQL197)) db.run(s);
  })();
}
/** ROLLBACK-SQL statements in their stated order (the parenthesised rebuild note is not a statement). */
function rollbackStatements(): string[] {
  const block = SQL197.split("-- ROLLBACK-SQL-BEGIN")[1]?.split("-- ROLLBACK-SQL-END")[0] ?? "";
  return block
    .split("\n")
    .map((l) => l.replace(/^--\s*/, "").trim())
    .filter((l) => /^(UPDATE|DROP INDEX|ALTER TABLE) /.test(l))
    .map((l) => l.replace(/;$/, ""));
}

const cols = (db: Database, table: string) =>
  (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

function seed(db: Database): void {
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES ('opp1','o','s','identified','u',?)",
    [NOW],
  );
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, created_at, updated_at) VALUES ('t1','opp1','c1',?,?)",
    [NOW, NOW],
  );
  for (const [id, cat] of [
    ["c1", "financial"],
    ["c2", "financial"],
    ["c3", "technical"],
  ]) {
    db.run(
      "INSERT INTO brownfield_eval_criterion (id, opportunity_id, category, source, label, created_by, created_at) VALUES (?, 'opp1', ?, 'custom', ?, 'u', ?)",
      [id, cat, `label ${id}`, NOW],
    );
  }
  db.run(
    `INSERT INTO brownfield_eval_draft_version (id, brownfield_target_id, category, version_no, proposed_count, unverified_count,
       evidence_grade, input_hash, payload, created_by, created_at) VALUES ('v1', 't1', 'financial', 1, 1, 0, 'A', 'h', '{}', 'u', ?)`,
    [NOW],
  );
  const ins = db.prepare(
    "INSERT INTO brownfield_target_eval_state (id, brownfield_target_id, criterion_id, status, note, assessed_by, assessed_at, confirmed_from_version_id) VALUES (?, 't1', ?, ?, ?, 'u', ?, ?)",
  );
  ins.run("s1", "c1", "pass", "confirmed from v1", NOW, "v1");
  ins.run("s2", "c2", "fail", "typed by a person", NOW, null);
  ins.run("s3", "c3", "pending", null, NOW, null);
}

describe("migration 0197 (ADR-0200)", () => {
  test("filename follows 0196 and the header carries the ADR-0014 markers with the reset step first", () => {
    expect(F197).toBe("0197_eval_state_verdict_source.sql");
    expect(files.some((f) => f.startsWith("0196_"))).toBe(true);
    expect(SQL197.startsWith("-- @reversible: true")).toBe(true);
    expect(SQL197).toContain("-- ROLLBACK-SQL-BEGIN");
    expect(SQL197).toContain("-- ROLLBACK-SQL-END");
    expect(SQL197).toContain("ADR-0200");
    expect(SQL197).not.toContain("REAL"); // ADR-0061
    const rb = rollbackStatements();
    expect(rb[0]).toMatch(/^UPDATE brownfield_target_eval_state SET status = 'pending'/);
    const dropSource = rb.findIndex((s) => s.includes("DROP COLUMN verdict_source"));
    expect(dropSource).toBeGreaterThan(0);
    expect(rb.findIndex((s) => s.startsWith("UPDATE"))).toBeLessThan(dropSource);
  });

  test("TA1: backfill leaves every existing row human and copies the 0194 link; health checks clean", () => {
    const db = chainBefore197("backfill");
    seed(db);
    apply197(db);
    const rows = db
      .query(
        "SELECT id, verdict_source, source_version_id, confirmed_from_version_id, status, note FROM brownfield_target_eval_state ORDER BY id",
      )
      .all() as Array<Record<string, string | null>>;
    expect(rows.map((r) => r.verdict_source)).toEqual(["human", "human", "human"]);
    expect(rows.find((r) => r.id === "s1")).toMatchObject({ source_version_id: "v1", confirmed_from_version_id: "v1" });
    expect(rows.find((r) => r.id === "s2")?.source_version_id).toBeNull();
    // verdicts themselves are untouched
    expect(rows.map((r) => [r.status, r.note])).toEqual([
      ["pass", "confirmed from v1"],
      ["fail", "typed by a person"],
      ["pending", null],
    ]);
    expect(
      (
        db.query("SELECT COUNT(*) AS n FROM brownfield_target_eval_state WHERE verdict_source <> 'human'").get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
    expect(
      (
        db
          .query(
            "SELECT COUNT(*) AS n FROM brownfield_target_eval_state WHERE confirmed_from_version_id IS NOT source_version_id",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect((db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
  });

  test("shape: columns, FK, CHECKs and partial indexes as designed", () => {
    const db = chainBefore197("shape");
    seed(db);
    apply197(db);
    expect(cols(db, "brownfield_target_eval_state")).toEqual(
      expect.arrayContaining(["verdict_source", "source_version_id", "confirmed_from_version_id"]),
    );
    expect(cols(db, "brownfield_eval_draft_run_item")).toContain("apply_summary");
    const fks = db.query("PRAGMA foreign_key_list(brownfield_target_eval_state)").all() as Array<{
      table: string;
      from: string;
    }>;
    expect(fks.some((f) => f.table === "brownfield_eval_draft_version" && f.from === "source_version_id")).toBe(true);
    const idx = db
      .query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'brownfield_target_eval_state'")
      .all() as Array<{ name: string; sql: string | null }>;
    const byName = new Map(idx.map((i) => [i.name, i.sql ?? ""]));
    expect(byName.get("idx_bf_target_eval_state_source_version")).toContain("WHERE source_version_id IS NOT NULL");
    expect(byName.get("idx_bf_target_eval_state_unreviewed")).toContain(
      "WHERE verdict_source <> 'human' AND status <> 'pending'",
    );
    expect(byName.has("idx_bf_target_eval_state_from_version")).toBe(true); // 0194 index kept for the frozen column
    const plan = db
      .query(
        "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM brownfield_target_eval_state WHERE brownfield_target_id = 't1' AND verdict_source <> 'human' AND status <> 'pending'",
      )
      .all() as Array<{ detail: string }>;
    expect(plan.some((p) => p.detail.includes("idx_bf_target_eval_state_unreviewed"))).toBe(true);
    expect(() => db.run("UPDATE brownfield_target_eval_state SET verdict_source = 'agent' WHERE id = 's1'")).toThrow(
      /CHECK/,
    );
    db.run(
      `INSERT INTO brownfield_eval_draft_run (id, opportunity_id, categories, status, total_targets, started_by, started_via, started_at, heartbeat_at)
       VALUES ('r1', 'opp1', 'both', 'running', 1, 'u', 'web', ?, ?)`,
      [NOW, NOW],
    );
    db.run(
      "INSERT INTO brownfield_eval_draft_run_item (id, run_id, brownfield_target_id, seq, state, updated_at) VALUES ('i1', 'r1', 't1', 0, 'pending', ?)",
      [NOW],
    );
    expect(() =>
      db.run("UPDATE brownfield_eval_draft_run_item SET apply_summary = 'not json' WHERE id = 'i1'"),
    ).toThrow(/CHECK/);
    db.run(`UPDATE brownfield_eval_draft_run_item SET apply_summary = '{"financial":{"applied":1}}' WHERE id = 'i1'`);
  });

  test("TA1 rollback rehearsal: non-human verdicts are reset to pending before verdict_source is dropped", () => {
    const db = chainBefore197("rollback");
    seed(db);
    apply197(db);
    db.run(
      "UPDATE brownfield_target_eval_state SET verdict_source = 'auto_rule', source_version_id = 'v1', confirmed_from_version_id = 'v1', note = 'AI', evidence_ref = 'v1' WHERE id = 's2'",
    );
    db.run("UPDATE brownfield_target_eval_state SET verdict_source = 'ai_draft' WHERE id = 's3'"); // pending: untouched
    const stmts = rollbackStatements();
    expect(stmts).toHaveLength(6);
    expect(stmts[1]).toContain("SET confirmed_from_version_id = NULL");
    db.transaction(() => {
      db.run(stmts[0]); // step 1: the reset, while verdict_source still exists
      const s2 = db
        .query("SELECT status, note, evidence_ref, verdict_source FROM brownfield_target_eval_state WHERE id = 's2'")
        .get();
      expect(s2).toEqual({ status: "pending", note: null, evidence_ref: null, verdict_source: "auto_rule" });
      for (const s of stmts.slice(1)) db.run(s);
      // the frozen 0194 link of a non-human row must not survive the rollback as a "confirmation"
      expect(
        (
          db.query("SELECT confirmed_from_version_id f FROM brownfield_target_eval_state WHERE id = 's2'").get() as {
            f: string | null;
          }
        ).f,
      ).toBeNull();
    })();
    expect(cols(db, "brownfield_target_eval_state")).not.toContain("verdict_source");
    expect(cols(db, "brownfield_eval_draft_run_item")).not.toContain("apply_summary");
    // human verdicts survive the rollback unchanged; no AI verdict survives looking human
    const left = db.query("SELECT id, status, note FROM brownfield_target_eval_state ORDER BY id").all() as Array<{
      id: string;
      status: string;
      note: string | null;
    }>;
    expect(left).toEqual([
      { id: "s1", status: "pass", note: "confirmed from v1" },
      { id: "s2", status: "pending", note: null },
      { id: "s3", status: "pending", note: null },
    ]);
    expect((db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
  });
});
