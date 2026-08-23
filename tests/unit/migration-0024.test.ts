/**
 * Unit tests for migration 0024 — the venture_scorecard table (ADR-0059 §1):
 * shape contract (columns, source_procedure/venture_class/section/status
 * CHECK vocabularies, the review_cycle GLOB shape, the target-required
 * CHECK, FKs, the run+procedure+section+measure uniqueness, both indexes)
 * and runner idempotence. The behavioral semantics (one record per
 * project+procedure+cycle, measure cap, evidence vocabulary, rollup
 * grouping) are covered in venture-scorecard.test.ts against the repository.
 */
import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0024.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const U1 = "user-001";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let runId: string;

const VALID_ROW = {
  source_procedure: "portfolio-venture-monitoring",
  review_cycle: "2026-Q4",
  venture_class: "driving",
  section: "financial",
  measure_key: "irr_vs_hurdle_spread",
  target_value: ">= 0pp",
  actual_value: "+3pp",
  status: "on_target",
  evidence_ref: "doc:cim-2026-001",
  observed_at: NOW,
};

function insertRow(overrides: Record<string, unknown> = {}): void {
  const v = { id: ulid(), run_id: runId, project_id: projectId, created_at: NOW, ...VALID_ROW, ...overrides };
  db.run(
    "INSERT INTO venture_scorecard (id, run_id, project_id, source_procedure, review_cycle, venture_class, section, measure_key, target_value, actual_value, status, evidence_ref, observed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [v.id, v.run_id, v.project_id, v.source_procedure, v.review_cycle, v.venture_class, v.section, v.measure_key, v.target_value, v.actual_value, v.status, v.evidence_ref, v.observed_at, v.created_at],
  );
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  db.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), U1, "analyst", "active", "salt", "hash", 1, NOW]);
  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, `NP-${projectId.slice(-6)}`, NOW]);
  runId = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [runId, projectId, `hash-${runId.slice(-6)}`, U1, NOW]);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (!existsSync(p)) continue;
    try {
      rmSync(p);
    } catch {
      // best-effort cleanup only
    }
  }
});

describe("migration 0024 — venture_scorecard shape", () => {
  test("table exists with the ADR-0059 column contract", () => {
    const cols = (db.query("PRAGMA table_info(venture_scorecard)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual([
      "id", "run_id", "project_id", "source_procedure", "review_cycle", "venture_class",
      "section", "measure_key", "target_value", "actual_value", "status", "evidence_ref",
      "observed_at", "created_at",
    ]);
  });

  test("a valid row inserts (the happy shape the repository writes)", () => {
    insertRow();
    expect((db.query("SELECT COUNT(*) AS n FROM venture_scorecard").get() as { n: number }).n).toBe(1);
  });

  test("source_procedure CHECK admits exactly the two producing procedures", () => {
    insertRow({ source_procedure: "jv-lifecycle-governance", measure_key: "jv-governance-dimension" });
    expect(() => insertRow({ source_procedure: "greenfield-screening", measure_key: "bad-proc" })).toThrow();
  });

  test("venture_class CHECK mirrors the CVC taxonomy plus jv", () => {
    for (const vc of ["driving", "enabling", "emergent", "passive", "jv"]) insertRow({ venture_class: vc, measure_key: `class-${vc}` });
    expect(() => insertRow({ venture_class: "incubator", measure_key: "bad-class" })).toThrow();
  });

  test("section CHECK admits exactly financial and strategic", () => {
    insertRow({ section: "strategic", measure_key: "strategic-shape" });
    expect(() => insertRow({ section: "operational", measure_key: "bad-section" })).toThrow();
  });

  test("status CHECK admits exactly the three scorecard statuses", () => {
    for (const s of ["on_target", "deviation", "insufficient_evidence"]) insertRow({ status: s, measure_key: `status-${s}` });
    expect(() => insertRow({ status: "green", measure_key: "bad-status" })).toThrow();
    expect(() => insertRow({ status: "ON_TARGET", measure_key: "bad-status-2" })).toThrow(); // case-sensitive
  });

  test("review_cycle GLOB CHECK pins the YYYY-Q[1-4] shape", () => {
    insertRow({ review_cycle: "2025-Q1", measure_key: "cycle-shape" });
    expect(() => insertRow({ review_cycle: "2026-Q5", measure_key: "bad-cycle-1" })).toThrow();
    expect(() => insertRow({ review_cycle: "2026Q4", measure_key: "bad-cycle-2" })).toThrow();
    expect(() => insertRow({ review_cycle: "2026-q4", measure_key: "bad-cycle-3" })).toThrow(); // GLOB is case-sensitive
    expect(() => insertRow({ review_cycle: "Q4-2026", measure_key: "bad-cycle-4" })).toThrow();
  });

  test("measure_key CHECK rejects the empty string", () => {
    expect(() => insertRow({ measure_key: "" })).toThrow();
  });

  test("target-required CHECK: NULL target legal only under insufficient_evidence", () => {
    insertRow({ measure_key: "no-evidence-shape", target_value: null, actual_value: null, status: "insufficient_evidence" });
    expect(() => insertRow({ measure_key: "bad-target-1", target_value: null, status: "on_target" })).toThrow();
    expect(() => insertRow({ measure_key: "bad-target-2", target_value: null, status: "deviation" })).toThrow();
  });

  test("FKs enforced: run_id → run, project_id → md_project", () => {
    expect(() => insertRow({ run_id: "no-such-run", measure_key: "bad-fk-1" })).toThrow();
    expect(() => insertRow({ project_id: "no-such-project", measure_key: "bad-fk-2" })).toThrow();
  });

  test("UNIQUE (run_id, source_procedure, section, measure_key): same quadruple rejected; other section or procedure legal", () => {
    expect(() => insertRow()).toThrow(); // duplicates the happy-shape row exactly
    insertRow({ section: "strategic" }); // same measure under the other section — legal
    insertRow({ source_procedure: "jv-lifecycle-governance" }); // same measure under the other procedure — legal
  });

  test("both indexes exist", () => {
    for (const idx of ["idx_venture_scorecard_project", "idx_venture_scorecard_rollup"]) {
      const sql = db.query("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(idx) as { sql: string };
      expect(sql?.sql).toBeTruthy();
    }
    const project = db.query("SELECT sql FROM sqlite_master WHERE name = 'idx_venture_scorecard_project'").get() as { sql: string };
    expect(project.sql).toContain("project_id, review_cycle");
    const rollup = db.query("SELECT sql FROM sqlite_master WHERE name = 'idx_venture_scorecard_rollup'").get() as { sql: string };
    expect(rollup.sql).toContain("review_cycle, section");
  });

  test("re-running the migration chain applies nothing (idempotence)", () => {
    const before = (db.query("SELECT COUNT(*) AS n FROM venture_scorecard").get() as { n: number }).n;
    const { applied } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect((db.query("SELECT COUNT(*) AS n FROM venture_scorecard").get() as { n: number }).n).toBe(before);
  });
});
