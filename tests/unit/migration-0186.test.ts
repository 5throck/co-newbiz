// @version 1.0.0
/**
 * Migration 0186 (ADR-0189 phase P5, data-architect review 2026-11-01): md_statute natural-key idempotency at
 * the DB layer — the partial unique index idx_md_statute_code on (korea_statute_id), mirroring
 * idx_md_company_dart (0033), plus the upsertCatalog ON CONFLICT DO NOTHING behavior that absorbs
 * intra-batch duplicates. Everything runs against a scratch SQLite under the OS temp dir - never the
 * dev (7748) or prod (7749) DB.
 */
import { test, expect, describe, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "migration-0186-"));
const TEST_DB_PATH = join(TMP, "migration-0186.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

const MIGRATION_FILE = join(import.meta.dirname, "..", "..", "db", "migrations", "0186_md_statute_unique_code.sql");

const addStatute = (id: string, statuteId: string | null, name: string | null = "상법") =>
  db.run("INSERT INTO md_statute (id, korea_statute_id, foreign_framework_key, created_at) VALUES (?,?,?,?)", [
    id,
    statuteId,
    name,
    "2026-11-01T00:00:00.000Z",
  ]);

describe("migration 0186: header and index", () => {
  test("carries the reversible metadata header (ADR-0014) and ROLLBACK-SQL block", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("@reversible:");
    expect(sql).toContain("ROLLBACK-SQL-BEGIN");
    expect(sql).toContain("ROLLBACK-SQL-END");
    expect(sql).toContain("DROP INDEX IF EXISTS idx_md_statute_code");
  });

  test("creates the partial unique index mirroring idx_md_company_dart (0033)", () => {
    const idx = db
      .query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'md_statute'")
      .all() as Array<{ name: string; sql: string }>;
    const found = idx.find((i) => i.name === "idx_md_statute_code");
    expect(found).toBeTruthy();
    expect(found!.sql).toContain("CREATE UNIQUE INDEX idx_md_statute_code ON md_statute(korea_statute_id) WHERE korea_statute_id IS NOT NULL");
  });

  test("duplicate non-null korea_statute_id is rejected; NULLs are distinct (partial index)", () => {
    addStatute("st-1", "130000");
    expect(() => addStatute("st-2", "130000")).toThrow(); // same natural key
    addStatute("st-null-1", null);
    addStatute("st-null-2", null); // NULLs never collide
    expect((db.query("SELECT COUNT(*) AS c FROM md_statute WHERE korea_statute_id IS NULL").get() as any).c).toBe(2);
    addStatute("st-3", "184000"); // a different statute coexists
    expect((db.query("SELECT COUNT(*) AS c FROM md_statute WHERE korea_statute_id = '130000'").get() as any).c).toBe(1);
  });
});

describe("migration 0186: upsertCatalog conflict handling (collect.law path)", () => {
  const { upsertCatalog } = require("../../scripts/co-newbiz/source-adapters.ts") as {
    upsertCatalog: typeof import("../../scripts/co-newbiz/source-adapters.ts").upsertCatalog;
  };
  const statute = (koreaId: string) => ({
    table: "md_statute" as const,
    naturalKey: { korea_statute_id: koreaId },
    values: { foreign_framework_key: "상법" },
  });

  test("an intra-batch duplicate counts as existing, never as a phantom insert (ON CONFLICT DO NOTHING)", () => {
    const first = upsertCatalog(db, [statute("001000"), statute("001000"), statute("002000")]);
    expect(first).toEqual({ inserted: 2, existing: 1 });
    const second = upsertCatalog(db, [statute("001000"), statute("002000")]);
    expect(second).toEqual({ inserted: 0, existing: 2 });
    expect((db.query("SELECT COUNT(*) AS c FROM md_statute WHERE korea_statute_id IN ('001000','002000')").get() as any).c).toBe(2);
  });
});
