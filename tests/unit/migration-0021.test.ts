/**
 * Unit tests for migration 0021 (project_industry binding) — ADR-0054
 * (docs/adr/0054-project-industry-binding-for-fact-industry-resolution.md).
 * Real scratch SQLite (the migration-0017/0019/0020 pattern: runMigrations on
 * a temp WAL DB, resetDb in afterAll) so the FK graph, the append-only
 * supersede pattern, and the partial unique live index are exercised by
 * SQLite itself, not mocked.
 *
 * These tests pin five things:
 *   (a) the table's exact shape (column list) and both indexes exist;
 *   (b) FK enforcement — project_id → md_project, industry_id → md_industry,
 *       superseded_by → project_industry (self);
 *   (c) the live partial unique index — at most one LIVE row per (project,
 *       industry); superseded history rows never block re-binding;
 *   (d) multiple DISTINCT live industries per project are LEGAL (ADR-0054:
 *       multi-industry targets are real; the consequence is decided at read
 *       time by the filler, not banned at write time);
 *   (e) the NOT NULL set — a binding without bound_by/bound_at/rationale is
 *       not a binding (the 0013 rationale discipline).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0021.sqlite";
const NOW = "2026-08-23T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let industryA: string;
let industryB: string;

function insertBinding(projectId: string, industryId: string, opts: { supersededBy?: string | null; boundBy?: string | null; boundAt?: string | null; rationale?: string | null } = {}): void {
  db.run(
    "INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale, superseded_by) VALUES (?,?,?,?,?,?,?)",
    [ulid(), projectId, industryId, opts.boundBy === undefined ? "user-001" : opts.boundBy, opts.boundAt === undefined ? NOW : opts.boundAt, opts.rationale === undefined ? "target market per screening memo" : opts.rationale, opts.supersededBy ?? null],
  );
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, `NP-${projectId.slice(-6)}`, NOW]);
  industryA = ulid();
  industryB = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryA, "30110", "선박용 엔진", "Marine engines", NOW]);
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryB, "30111", "조선업", "Shipbuilding", NOW]);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (!existsSync(p)) continue;
    // Windows occasionally lags the handle release just past close(); the
    // artifact is throwaway and beforeAll removes any leftover next run
    try {
      rmSync(p);
    } catch {
      // best-effort cleanup only
    }
  }
});

// ---------------------------------------------------------------------------
// (a) Shape
// ---------------------------------------------------------------------------

describe("shape", () => {
  test("applies cleanly in the full chain — 0021 is recorded", () => {
    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows.map((r) => r.filename)).toContain("0021_project_industry_binding.sql");
  });

  test("exact column list (order included) — the 0013 classification pattern, no direction column", () => {
    const cols = db.query("PRAGMA table_info(project_industry)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual([
      "id", "project_id", "industry_id", "bound_by", "bound_at", "rationale", "superseded_by",
    ]);
  });

  test("both indexes exist — the live partial unique + the project history index", () => {
    const live = (db.query("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND tbl_name = 'project_industry' AND name = 'idx_project_industry_live'").get() as { c: number }).c;
    expect(live).toBe(1);
    const project = (db.query("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND tbl_name = 'project_industry' AND name = 'idx_project_industry_project'").get() as { c: number }).c;
    expect(project).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (b) FK enforcement
// ---------------------------------------------------------------------------

describe("foreign keys", () => {
  test("project_id must reference an existing md_project row", () => {
    expect(() => insertBinding("project-does-not-exist", industryA)).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("industry_id must reference an existing md_industry row", () => {
    expect(() => insertBinding(projectId, "industry-does-not-exist")).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("superseded_by must reference an existing project_industry row (self-FK)", () => {
    expect(() => insertBinding(projectId, industryA, { supersededBy: "binding-does-not-exist" })).toThrow(/FOREIGN KEY constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// (c) The live partial unique index — dedupe + append-only supersede
// ---------------------------------------------------------------------------

describe("live index", () => {
  test("a second LIVE binding of the SAME industry is rejected", () => {
    insertBinding(projectId, industryA);
    expect(() => insertBinding(projectId, industryA)).toThrow(/UNIQUE constraint failed/);
  });

  test("append-only supersede frees the slot: supersede, then re-bind the same industry succeeds; history is kept", () => {
    // The repository flip pattern (dimension-input.repository.ts assert): the
    // successor is born NON-live to satisfy the live index, then the pointers
    // swap — old.superseded_by = new.id, new goes live.
    const original = db.query("SELECT id FROM project_industry WHERE project_id = ? AND industry_id = ? AND superseded_by IS NULL").get(projectId, industryA) as { id: string };
    const successor = ulid();
    db.run("INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale, superseded_by) VALUES (?,?,?,?,?,?,?)", [
      successor, projectId, industryA, "user-002", NOW, "re-affirmed after screening memo v2", original.id,
    ]);
    db.run("UPDATE project_industry SET superseded_by = ? WHERE id = ?", [successor, original.id]);
    db.run("UPDATE project_industry SET superseded_by = NULL WHERE id = ?", [successor]);
    // Still exactly ONE live row for (project, industry)...
    const live = db.query("SELECT COUNT(*) AS n FROM project_industry WHERE project_id = ? AND industry_id = ? AND superseded_by IS NULL").get(projectId, industryA) as { n: number };
    expect(live.n).toBe(1);
    // ...and the superseded history row survived (append-only, never deleted).
    const history = db.query("SELECT COUNT(*) AS n FROM project_industry WHERE project_id = ? AND industry_id = ? AND superseded_by IS NOT NULL").get(projectId, industryA) as { n: number };
    expect(history.n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (d) Multiple DISTINCT live industries are legal
// ---------------------------------------------------------------------------

describe("multi-industry", () => {
  test("two live bindings of DISTINCT industries are both accepted", () => {
    expect(() => insertBinding(projectId, industryB)).not.toThrow();
    const live = db.query("SELECT industry_id FROM project_industry WHERE project_id = ? AND superseded_by IS NULL ORDER BY industry_id").all(projectId) as { industry_id: string }[];
    expect(live.map((r) => r.industry_id).sort()).toEqual([industryA, industryB].sort());
  });
});

// ---------------------------------------------------------------------------
// (e) NOT NULL set — the judgement-claim discipline
// ---------------------------------------------------------------------------

describe("NOT NULL columns", () => {
  test("bound_by, bound_at, and rationale are all mandatory", () => {
    const pid = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [pid, `NP-${pid.slice(-6)}`, NOW]);
    expect(() => insertBinding(pid, industryA, { boundBy: null })).toThrow(/NOT NULL constraint failed/);
    expect(() => insertBinding(pid, industryA, { boundAt: null })).toThrow(/NOT NULL constraint failed/);
    expect(() => insertBinding(pid, industryA, { rationale: null })).toThrow(/NOT NULL constraint failed/);
  });
});
