/**
 * Unit tests for migration 0023 — the kill_criteria_evaluation table
 * (ADR-0058 §1): shape contract (columns, complete-ledger outcome CHECK,
 * actions vocabulary CHECK, the run+procedure+criterion uniqueness, FKs,
 * the project recency index) and runner idempotence. The behavioral
 * semantics (complete ledger, anchors snapshotted, second-record throw)
 * are covered in kill-criteria.test.ts against the repository.
 */
import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0023.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const U1 = "user-001";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let runId: string;

const VALID_ROW = {
  procedure_key: "brownfield-dd",
  criterion_id: "covenant_breach_with_coc_acceleration_under_downside",
  action: "halt",
  outcome: "triggered",
  predicate_json: '{"op":"count","var":"risk.covenants_breached","cmp":"gte","value":1}',
  policy_id: "gd-0022-risk-thresholds",
  thresholds_source: "docs/decisions/risk-thresholds.md",
};

function insertRow(overrides: Record<string, unknown> = {}): void {
  const v = { id: ulid(), run_id: runId, project_id: projectId, evaluated_at: NOW, evaluated_by: U1, ...VALID_ROW, ...overrides };
  db.run(
    "INSERT INTO kill_criteria_evaluation (id, run_id, project_id, procedure_key, criterion_id, action, outcome, predicate_json, policy_id, thresholds_source, evaluated_at, evaluated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [v.id, v.run_id, v.project_id, v.procedure_key, v.criterion_id, v.action, v.outcome, v.predicate_json, v.policy_id, v.thresholds_source, v.evaluated_at, v.evaluated_by],
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

describe("migration 0023 — kill_criteria_evaluation shape", () => {
  test("table exists with the ADR-0058 column contract", () => {
    const cols = (db.query("PRAGMA table_info(kill_criteria_evaluation)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual([
      "id", "run_id", "project_id", "procedure_key", "criterion_id", "action", "outcome",
      "predicate_json", "policy_id", "thresholds_source", "evaluated_at", "evaluated_by",
    ]);
  });

  test("a valid triggered row inserts (the happy shape the recorder writes)", () => {
    insertRow();
    expect((db.query("SELECT COUNT(*) AS n FROM kill_criteria_evaluation").get() as { n: number }).n).toBe(1);
  });

  test("outcome CHECK admits exactly the complete-ledger members", () => {
    for (const outcome of ["triggered", "false", "unassessed"]) insertRow({ criterion_id: `shape-${outcome}`, outcome });
    expect(() => insertRow({ criterion_id: "shape-bad-outcome", outcome: "pass" })).toThrow();
    expect(() => insertRow({ criterion_id: "shape-bad-outcome2", outcome: "TRUE" })).toThrow(); // case-sensitive
  });

  test("action CHECK mirrors the registry actions vocabulary", () => {
    for (const action of ["halt", "mark_conditional", "escalate_to_risk_officer"]) insertRow({ criterion_id: `action-${action}`, action });
    expect(() => insertRow({ criterion_id: "action-bad", action: "maybe_halt" })).toThrow();
  });

  test("UNIQUE (run_id, procedure_key, criterion_id): same triple rejected, same criterion under another procedure legal", () => {
    expect(() => insertRow()).toThrow(); // duplicates the happy-shape row exactly
    insertRow({ procedure_key: "greenfield-screening" }); // same criterion, other procedure — legal
  });

  test("FKs enforced: run_id → run, project_id → md_project", () => {
    expect(() => insertRow({ run_id: "no-such-run" })).toThrow();
    expect(() => insertRow({ project_id: "no-such-project" })).toThrow();
  });

  test("the project recency index exists", () => {
    const sql = db.query("SELECT sql FROM sqlite_master WHERE name = 'idx_kill_criteria_eval_project'").get() as { sql: string };
    expect(sql.sql).toContain("project_id, evaluated_at DESC");
  });

  test("re-running the migration chain applies nothing (idempotence)", () => {
    const before = (db.query("SELECT COUNT(*) AS n FROM kill_criteria_evaluation").get() as { n: number }).n;
    const { applied } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect((db.query("SELECT COUNT(*) AS n FROM kill_criteria_evaluation").get() as { n: number }).n).toBe(before);
  });
});
