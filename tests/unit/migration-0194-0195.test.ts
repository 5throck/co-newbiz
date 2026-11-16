// @version 1.0.0
/**
 * Migrations 0194 (S6 bulk AI-eval draft versions) and 0195 (DART evidence cache) — ADR-0199, spec
 * 2026-11-16-s6-bulk-ai-eval-versioning §3.2/§3.5/§11. Applies the full chain to a scratch SQLite and proves:
 *   - filenames follow 0193 and both headers carry @reversible + ROLLBACK-SQL markers (ADR-0014);
 *   - the six tables, the confirmed_from_version_id FK, indexes, and CHECK vocabularies exist as designed;
 *   - T2: UPDATE on a version aborts, a direct DELETE aborts while the candidate exists, a candidate delete cascades
 *     its versions and run items in one statement (foreign_key_check clean afterwards);
 *   - T13 (DB part): multiple active runs per opportunity are allowed since migration 0196
 *     (per-candidate engines, cap enforced in code); terminal runs are unaffected;
 *   - T19 (trigger part): UPDATE on dart_disclosure aborts; length CHECKs pin DART's code system;
 *   - T25 (schema part): the 0195 tables carry no opportunity/user/candidate/verdict column, and a candidate delete
 *     leaves cache rows intact;
 *   - 0195 is independent of 0194 (applies first, rolls back alone).
 */
import { test, expect, describe } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const F194 = files.find((f) => f.startsWith("0194_")) ?? "";
const F195 = files.find((f) => f.startsWith("0195_")) ?? "";
const SQL194 = readFileSync(join(DIR, F194), "utf-8");
const SQL195 = readFileSync(join(DIR, F195), "utf-8");
const NOW = "2026-11-16T00:00:00Z";

const TMP = mkdtempSync(join(tmpdir(), "migration-0194-0195-"));
process.env.CO_NEWBIZ_DB_PATH = join(TMP, "boot.sqlite");
const { runMigrations } = await import("../../db/migrate.ts");
const { getDb, resetDb } = await import("../../db/client.ts");

/** Full chain through the real runner (handles @notransaction files), on a fresh file DB. */
function fullChain(name: string): Database {
  const path = join(TMP, `${name}.sqlite`);
  resetDb();
  runMigrations(path);
  return getDb(path);
}

/** Apply every migration before 0194 through the runner, then the given files manually in the given order. */
function chainThen(name: string, order: string[]): Database {
  const path = join(TMP, `${name}.sqlite`);
  resetDb();
  const db = getDb(path);
  db.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)",
  );
  // Pre-mark 0194+ as applied so the runner stops after 0193.
  for (const f of files.filter((x) => x >= F194)) db.run("INSERT INTO schema_migrations VALUES (?, ?, ?)", [f, f, NOW]);
  runMigrations(path);
  for (const f of order) {
    db.transaction(() => {
      for (const s of splitSqlStatements(readFileSync(join(DIR, f), "utf-8"))) db.run(s);
    })();
  }
  return db;
}

function rollbackStatements(sql: string): string[] {
  const block = sql.split("-- ROLLBACK-SQL-BEGIN")[1]?.split("-- ROLLBACK-SQL-END")[0] ?? "";
  return block
    .split("\n")
    .map((l) => l.replace(/^--\s*/, "").trim())
    .filter((l) => /^DROP (TABLE|TRIGGER) /.test(l));
}

const cols = (db: Database, table: string) =>
  (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
const objects = (db: Database, type: string) =>
  (db.query("SELECT name FROM sqlite_master WHERE type = ?").all(type) as Array<{ name: string }>).map((r) => r.name);

function seed(db: Database) {
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES ('opp1','o','s','identified','u',?)",
    [NOW],
  );
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, created_at, updated_at) VALUES ('t1','opp1','c1',?,?)",
    [NOW, NOW],
  );
  db.run(
    "INSERT INTO brownfield_target (id, opportunity_id, company_name, created_at, updated_at) VALUES ('t2','opp1','c2',?,?)",
    [NOW, NOW],
  );
}
const insertRun = (db: Database, id: string, status: string) =>
  db.run(
    `INSERT INTO brownfield_eval_draft_run (id, opportunity_id, categories, status, total_targets, started_by, started_via, started_at, heartbeat_at)
     VALUES (?, 'opp1', 'both', ?, 2, 'u', 'web', ?, ?)`,
    [id, status, NOW, NOW],
  );
const insertVersion = (db: Database, id: string, target: string, no: number, runId: string | null = "r1") =>
  db.run(
    `INSERT INTO brownfield_eval_draft_version (id, brownfield_target_id, category, version_no, run_id, proposed_count, unverified_count,
       evidence_grade, input_hash, payload, created_by, created_at) VALUES (?, ?, 'financial', ?, ?, 0, 0, 'A', 'h', '{}', 'u', ?)`,
    [id, target, no, runId, NOW],
  );

describe("migrations 0194 + 0195 (ADR-0199)", () => {
  test("filenames are the next two after 0193 and headers carry the ADR-0014 markers", () => {
    expect(F194).toBe("0194_brownfield_eval_draft_versions.sql");
    expect(F195).toBe("0195_dart_evidence_cache.sql");
    expect(files.some((f) => f.startsWith("0193_"))).toBe(true);
    for (const sql of [SQL194, SQL195]) {
      expect(sql.startsWith("-- @reversible: true")).toBe(true);
      expect(sql).toContain("-- ROLLBACK-SQL-BEGIN");
      expect(sql).toContain("-- ROLLBACK-SQL-END");
      expect(sql).toContain("ADR-0199");
    }
    expect(SQL194).not.toContain("REAL"); // ADR-0061: no floating money column
    expect(SQL195).not.toContain("REAL");
  });

  test("0194 tables, column, indexes, and triggers exist; health checks clean", () => {
    const db = fullChain("shape194");
    expect(cols(db, "brownfield_eval_draft_run")).toEqual([
      "id",
      "opportunity_id",
      "categories",
      "web_evidence",
      "force_refresh",
      "status",
      "total_targets",
      "started_by",
      "started_via",
      "resumed_by",
      "started_at",
      "heartbeat_at",
      "finished_at",
      "pause_reason",
      "error_message",
    ]);
    expect(cols(db, "brownfield_eval_draft_run_item")).toContain("dart_calls");
    expect(cols(db, "brownfield_eval_draft_version")).toContain("input_hash");
    const evalCols = cols(db, "brownfield_target_eval_state");
    expect(evalCols[evalCols.length - 1]).toBe("confirmed_from_version_id");
    const fks = db.query("PRAGMA foreign_key_list(brownfield_target_eval_state)").all() as Array<{
      table: string;
      from: string;
    }>;
    expect(fks.some((f) => f.table === "brownfield_eval_draft_version" && f.from === "confirmed_from_version_id")).toBe(
      true,
    );
    const idx = objects(db, "index");
    for (const n of [
      "idx_bedr_opp_started",
      "idx_bedri_run_state",
      "idx_bedv_run",
      "idx_bf_target_eval_state_from_version",
    ]) {
      expect(idx).toContain(n);
    }
    const trg = objects(db, "trigger");
    expect(trg).toContain("trg_bedv_no_update");
    expect(trg).toContain("trg_bedv_no_orphan_delete");
    expect(db.query("PRAGMA foreign_key_check").all()).toHaveLength(0);
    expect((db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
  });

  test("CHECK vocabularies reject unknown values; web_evidence/force_refresh default to 0", () => {
    const db = fullChain("checks194");
    seed(db);
    insertRun(db, "r1", "running");
    const run = db
      .query("SELECT web_evidence, force_refresh FROM brownfield_eval_draft_run WHERE id='r1'")
      .get() as Record<string, number>;
    expect(run).toEqual({ web_evidence: 0, force_refresh: 0 });
    expect(() => insertRun(db, "rX", "paused")).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO brownfield_eval_draft_run_item (id, run_id, brownfield_target_id, seq, state, updated_at) VALUES ('i','r1','t1',0,'bogus',?)",
        [NOW],
      ),
    ).toThrow();
    expect(() =>
      db.run(
        `INSERT INTO brownfield_eval_draft_version (id, brownfield_target_id, category, version_no, proposed_count, unverified_count,
           evidence_grade, input_hash, payload, created_by, created_at) VALUES ('v','t1','financial',1,0,0,'Z','h','{}','u',?)`,
        [NOW],
      ),
    ).toThrow();
    expect(() =>
      db.run(
        `INSERT INTO brownfield_eval_draft_version (id, brownfield_target_id, category, version_no, proposed_count, unverified_count,
           evidence_grade, input_hash, payload, created_by, created_at) VALUES ('v','t1','financial',1,0,0,'A','h','not json','u',?)`,
        [NOW],
      ),
    ).toThrow();
  });

  test("T13: parallel active runs are allowed (0196 dropped the one-active-run index); terminal runs unaffected", () => {
    const db = fullChain("active194");
    seed(db);
    insertRun(db, "r1", "running");
    insertRun(db, "r2", "paused_budget");
    insertRun(db, "r3", "interrupted");
    insertRun(db, "r4", "completed");
    expect((db.query("SELECT COUNT(*) AS n FROM brownfield_eval_draft_run").get() as { n: number }).n).toBe(4);
  });

  test("T2: versions are immutable, deletable only through the candidate cascade", () => {
    const db = fullChain("immut194");
    seed(db);
    insertRun(db, "r1", "running");
    insertVersion(db, "v1", "t1", 1);
    insertVersion(db, "v2", "t1", 2);
    insertVersion(db, "v3", "t2", 1);
    db.run(
      "INSERT INTO brownfield_eval_draft_run_item (id, run_id, brownfield_target_id, seq, state, financial_outcome, financial_version_id, updated_at) VALUES ('i1','r1','t1',0,'done','versioned','v2',?)",
      [NOW],
    );
    expect(() => db.run("UPDATE brownfield_eval_draft_version SET payload = '{\"x\":1}' WHERE id = 'v1'")).toThrow(
      /immutable/,
    );
    expect(() => db.run("DELETE FROM brownfield_eval_draft_version WHERE id = 'v1'")).toThrow(
      /only with their candidate/,
    );
    expect(() => insertVersion(db, "dup", "t1", 2)).toThrow(); // UNIQUE (target, category, version_no)

    db.run("DELETE FROM brownfield_target WHERE id = 't1'");
    const left = db.query("SELECT id FROM brownfield_eval_draft_version ORDER BY id").all() as Array<{ id: string }>;
    expect(left.map((r) => r.id)).toEqual(["v3"]);
    expect((db.query("SELECT COUNT(*) AS n FROM brownfield_eval_draft_run_item").get() as { n: number }).n).toBe(0);
    expect(db.query("PRAGMA foreign_key_check").all()).toHaveLength(0);
  });

  test("confirmed_from_version_id is FK-enforced", () => {
    const db = fullChain("fk194");
    seed(db);
    insertRun(db, "r1", "running");
    insertVersion(db, "v1", "t1", 1);
    db.run(
      `INSERT INTO brownfield_eval_criterion (id, opportunity_id, category, label, source, created_by, created_at)
       VALUES ('c1','opp1','financial','매출','custom','u',?)`,
      [NOW],
    );
    db.run(
      `INSERT INTO brownfield_target_eval_state (id, brownfield_target_id, criterion_id, status, assessed_by, assessed_at, confirmed_from_version_id)
       VALUES ('s1','t1','c1','pass','u',?,'v1')`,
      [NOW],
    );
    expect(() =>
      db.run(
        `INSERT INTO brownfield_target_eval_state (id, brownfield_target_id, criterion_id, status, assessed_by, assessed_at, confirmed_from_version_id)
         VALUES ('s2','t2','c1','pass','u',?,'nope')`,
        [NOW],
      ),
    ).toThrow();
  });

  test("0195 tables: immutable disclosures, DART code-system CHECKs, cache isolation (T19/T25 schema parts)", () => {
    const db = fullChain("shape195");
    for (const t of ["dart_disclosure", "dart_business_report_extract", "dart_corp_sync_state"]) {
      for (const c of cols(db, t))
        expect(c).not.toMatch(/opportunity|user|target|candidate|verdict|assessed|created_by|status_by/);
    }
    db.run(
      "INSERT INTO dart_disclosure (rcept_no, corp_code, corp_name, report_nm, rcept_dt, fetched_at) VALUES ('20250314000123','00123456','회사','사업보고서 (2024.12)','20250314',?)",
      [NOW],
    );
    expect(() => db.run("UPDATE dart_disclosure SET report_nm = 'x'")).toThrow(/immutable/);
    expect(() =>
      db.run(
        "INSERT INTO dart_disclosure (rcept_no, corp_code, corp_name, report_nm, rcept_dt, fetched_at) VALUES ('123','00123456','c','r','20250314',?)",
        [NOW],
      ),
    ).toThrow();
    expect(() => db.run("INSERT INTO dart_corp_sync_state (corp_code, updated_at) VALUES ('123', ?)", [NOW])).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO dart_business_report_extract (rcept_no, extractor_version, status, source_chars, fetched_at) VALUES ('20250314000123','v1','http_error',0,?)",
        [NOW],
      ),
    ).toThrow();
    expect(() =>
      db.run(
        "INSERT INTO dart_business_report_extract (rcept_no, extractor_version, status, source_chars, fetched_at) VALUES ('99999999999999','v1','not_zip',0,?)",
        [NOW],
      ),
    ).toThrow(); // FK to a cached disclosure row

    // A candidate delete leaves the shared cache untouched (no link back to the candidate).
    seed(db);
    db.run("DELETE FROM brownfield_target WHERE id = 't1'");
    expect((db.query("SELECT COUNT(*) AS n FROM dart_disclosure").get() as { n: number }).n).toBe(1);
  });

  test("0195 is independent of 0194: applies first, and its ROLLBACK-SQL drops only its own objects", () => {
    const db = chainThen("order", [F195, F194]);
    expect(objects(db, "table")).toContain("dart_disclosure");
    expect(objects(db, "table")).toContain("brownfield_eval_draft_version");
    const stmts = rollbackStatements(SQL195);
    expect(stmts).toHaveLength(4);
    db.transaction(() => {
      for (const s of stmts) db.run(s);
    })();
    const tables = objects(db, "table");
    for (const t of ["dart_disclosure", "dart_business_report_extract", "dart_corp_sync_state"])
      expect(tables).not.toContain(t);
    expect(tables).toContain("brownfield_eval_draft_version");
    expect(db.query("PRAGMA foreign_key_check").all()).toHaveLength(0);
  });

  test("0194 ROLLBACK-SQL: triggers and run items drop cleanly before the documented eval-state rebuild", () => {
    const db = fullChain("rollback194");
    const stmts = rollbackStatements(SQL194);
    expect(stmts).toEqual([
      "DROP TRIGGER trg_bedv_no_update;",
      "DROP TRIGGER trg_bedv_no_orphan_delete;",
      "DROP TABLE brownfield_eval_draft_run_item;",
      "DROP TABLE brownfield_eval_draft_version;",
      "DROP TABLE brownfield_eval_draft_run;",
    ]);
    // The first three run without the column rebuild; the version table must wait for it (FK from eval state).
    db.transaction(() => {
      for (const s of stmts.slice(0, 3)) db.run(s);
    })();
    expect(objects(db, "trigger")).not.toContain("trg_bedv_no_update");
    expect(objects(db, "table")).not.toContain("brownfield_eval_draft_run_item");
  });
});

process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));
