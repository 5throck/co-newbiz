/**
 * Unit tests for migration 0014 (routing variable seeds) — design of record
 * docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * Decision 5e (fact-based antitrust gating) and Decision 7 (applies_when
 * reuses the predicate language). PR-5a.
 *
 * Seed-only migration: no shape contract to pin beyond the rows themselves,
 * so the asserts here pin (a) the exact seed SET, (b) per-seed field values,
 * (c) the registry's own CHECKs still guard the enum domains, and (d) the
 * no-duplication guarantee. Counts are derived from the migrations DIRECTORY,
 * never hardcoded — the exact-count pins in migration-0013.test.ts were the
 * future-coupling hazard this file must not repeat (a 15th migration must
 * not break 0014's tests).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0014.sqlite";
const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/migrations");
const MIGRATION_FILE = "0014_routing_vars.sql";
const NOW = "2026-08-23T00:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;

/** Every .sql file that exists right now — the only honest migration count. */
function migrationCount(): number {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length;
}

/** The four routing var_keys 0014 owns (scoped since 0017 seeded the market scoring vars — this file pins ITS seed set, not the registry size). */
const ROUTING_KEYS = [
  "target.has_external_market_presence",
  "project.case_type",
  "project.origin",
  "project.technology_track",
] as const;

/** 0014's seed set, as var_key -> full row, in seed order (routing prefixes only). */
function seedRows(): { var_key: string; label_ko: string; value_type: string; unit: string | null; source_kind: string; requires_evidence_ref: number; max_age_days: number | null; created_at: string }[] {
  return db
    .query("SELECT var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, max_age_days, created_at FROM evidence_var WHERE (var_key LIKE 'target.%' OR var_key LIKE 'project.%') AND var_key NOT IN ('project.sub_track','project.site_required','project.establishment_mode') ORDER BY rowid") // 0136's two greenfield routing vars are 0136's to pin (tests/unit/greenfield-subtrack.test.ts)
    .all() as never[];
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  const { applied } = runMigrations(TEST_DB_PATH);
  expect(applied).toContain(MIGRATION_FILE); // applied, position-independent — 0015 broke the old "newest, applied last" pin, exactly the future-coupling this header forbids
  db = getDb(TEST_DB_PATH);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// Seed set — exactly the four routing facts, no more, no fewer
// ---------------------------------------------------------------------------

describe("0014 seed set", () => {
  test("evidence_var holds exactly the four routing var_keys under their prefixes (0012 created the table empty; the market scoring vars seeded by 0017 live under market.*/right_to_win.* and are 0017's to pin)", () => {
    expect(seedRows().map((r) => r.var_key)).toEqual([...ROUTING_KEYS]);
  });

  test("the asserted fact: boolean, asserted, requires evidence (Decision 5e's fact gate)", () => {
    const fact = seedRows().find((r) => r.var_key === "target.has_external_market_presence")!;
    expect(fact.value_type).toBe("boolean");
    expect(fact.source_kind).toBe("asserted");
    expect(fact.requires_evidence_ref).toBe(1);
    expect(fact.unit).toBeNull();
    expect(fact.label_ko.length).toBeGreaterThan(0);
  });

  test("the three classification vars: string, source_kind column, no evidence requirement", () => {
    for (const key of ["project.case_type", "project.origin", "project.technology_track"]) {
      const row = seedRows().find((r) => r.var_key === key)!;
      expect(row.value_type).toBe("string");
      expect(row.source_kind).toBe("column");
      expect(row.requires_evidence_ref).toBe(0);
      expect(row.label_ko.length).toBeGreaterThan(0);
    }
  });

  test("every seed's enum values are legal per the 0012 CHECKs (and the CHECKs still bite)", () => {
    for (const row of seedRows()) {
      expect(["number", "string", "boolean"]).toContain(row.value_type);
      expect(["column", "computed", "asserted"]).toContain(row.source_kind);
    }
    expect(() =>
      db.run(
        "INSERT INTO evidence_var (var_key, label_ko, value_type, source_kind, created_at) VALUES ('t.bad.type', 'x', 'float', 'asserted', ?)",
        [NOW]
      )
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.run(
        "INSERT INTO evidence_var (var_key, label_ko, value_type, source_kind, created_at) VALUES ('t.bad.kind', 'x', 'string', 'guessed', ?)",
        [NOW]
      )
    ).toThrow(/CHECK constraint failed/);
  });

  test("created_at is the fixed literal (deterministic seeds, ADR-0002 no-dynamic-dates)", () => {
    expect(new Set(seedRows().map((r) => r.created_at))).toEqual(new Set([NOW]));
  });

  test("label_ko survives the roundtrip as UTF-8 Korean (feeds renderKo's governance artifact)", () => {
    const fact = seedRows().find((r) => r.var_key === "target.has_external_market_presence")!;
    expect(fact.label_ko).toMatch(/[가-힣]/);
  });

  test("evidence_var is a leaf: the seeds reference nothing (no FK columns at all)", () => {
    const fks = db.query("PRAGMA foreign_key_list(evidence_var)").all();
    expect(fks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Idempotence — the runner is the mechanism; the PK is the no-duplication guard
// ---------------------------------------------------------------------------

describe("0014 idempotence", () => {
  test("re-running runMigrations applies nothing and skips every present migration", () => {
    const { applied, skipped } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect(skipped.length).toBe(migrationCount()); // directory-derived — 0015+ must not break this
    expect(skipped).toContain(MIGRATION_FILE);
  });

  test("seed row count is unchanged after the re-run", () => {
    const before = seedRows().length;
    runMigrations(TEST_DB_PATH);
    expect(seedRows().length).toBe(before); // before/after-relative — a later seed migration must not break this pin
  });

  test("re-executing the 0014 SQL duplicates nothing (bun multi-statement run silently no-ops; the PK is the hard guard)", () => {
    // bun 1.3.14 quirk, verified while writing this test: db.run() over a
    // multi-line statement followed by a trailing newline after ';' does
    // NOT raise the UNIQUE violation on duplicate rows — it reports
    // changes: 0. So the whole-file re-exec is asserted non-duplicating,
    // and the PK guard is proven separately with a single-statement INSERT
    // (which bun does let fail loudly).
    const before = seedRows().length;
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf-8");
    db.run(sql);
    expect(seedRows().length).toBe(before);
    expect(() =>
      db.run(
        "INSERT INTO evidence_var (var_key, label_ko, value_type, source_kind, created_at) VALUES ('target.has_external_market_presence', 'x', 'boolean', 'asserted', ?)",
        [NOW]
      )
    ).toThrow(/UNIQUE constraint failed/);
  });

  test("0014 is recorded in schema_migrations, once", () => {
    const rows = db.query("SELECT filename FROM schema_migrations WHERE filename = ?").all(MIGRATION_FILE) as { filename: string }[];
    expect(rows.length).toBe(1);
    expect(db.query("SELECT COUNT(*) AS c FROM schema_migrations").get()).toMatchObject({ c: migrationCount() });
  });
});
