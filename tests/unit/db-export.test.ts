/**
 * Unit tests for db-export.ts (ADR-0002's portability verification
 * mechanism) — real scratch SQLite built by the full migration set, then
 * exported and asserted on as text. The export is the artifact ADR-0002
 * promises ("a data-export/import exercise, not a rewrite"); these tests pin
 * its fidelity contract: type mapping, GLOB warnings, internal-table
 * skipping, and round-trippable INSERT quoting.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { runDbExport } from "../../scripts/co-newbiz/db-export.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-db-export.sqlite";

let result: ReturnType<typeof runDbExport>;

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
  resetDb();
  const db = getDb(TEST_DB_PATH);
  runMigrations(TEST_DB_PATH);

  // One seeded row with a quote in text — proves INSERT escaping survives.
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, "NP-EXP-TES'T", "2026-08-24T00:00:00Z"]);

  resetDb();
  result = runDbExport({ dbPath: TEST_DB_PATH });
});

afterAll(() => {
  resetDb();
});

test("export skips internal tables but keeps every migrated user table", () => {
  expect(result.sql).not.toContain('CREATE TABLE IF NOT EXISTS "schema_migrations"');
  expect(result.sql).not.toContain('"schema_migrations" (');
  expect(result.tableCount).toBeGreaterThanOrEqual(60); // migrations 0001-0024 land ~70 tables
});

test("SQLite storage classes map to Postgres dialect types", () => {
  // REAL money columns (recorded schema debt) surface honestly as DOUBLE PRECISION.
  expect(result.sql).toMatch(/DOUBLE PRECISION/);
  // INTEGER PKs / years map to BIGINT.
  expect(result.sql).toMatch(/\bBIGINT\b/);
  // No bare SQLite-only trailing clauses survive.
  expect(result.sql).not.toMatch(/WITHOUT ROWID/i);
  expect(result.sql).not.toMatch(/\bSTRICT\s*;/i);
});

test("GLOB CHECK constraints are flagged in warnings, not silently emitted", () => {
  // Migration 0024's review_cycle GLOB is the known occurrence.
  expect(result.warnings.some((w) => w.includes("GLOB"))).toBe(true);
});

test("seeded row exports as a quoted, escaped INSERT", () => {
  expect(result.rowCount).toBeGreaterThan(0);
  expect(result.sql).toContain("INSERT INTO \"md_project\"");
  expect(result.sql).toContain("'NP-EXP-TES''T'");
});

test("data section disables FK triggers for cross-table insert order safety", () => {
  expect(result.sql).toContain("SET session_replication_role = replica;");
  expect(result.sql).toContain("RESET session_replication_role;");
});
