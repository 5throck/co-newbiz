// @version 1.0.0
/**
 * D6 (B-3) — killEvalStates: the board-level kill-evaluation aggregate
 * (design 2026-11-11-admin-security-and-board-fixes §8).
 *
 * Real scratch SQLite through the FULL migration chain. Pins:
 *   - the dominance order: any triggered row → "triggered"; else any
 *     unassessed row → "unassessed"; else all-false rows → "false";
 *   - the honesty rule: NO ledger rows → NO map entry (the route renders
 *     null → "—") — absence of the ledger is never a pass;
 *   - the MNPI guard: mnpi_flag=1 projects are suppressed for actors off
 *     the ACTIVE insider list (removed_at IS NULL), shown for insiders,
 *     and unaffected by the flag when it is 0 — the same live-list
 *     semantics as requireInsiderIfMnpi (db/lib/access-control.ts);
 *   - no data_access_log rows: the aggregate is a count summary over
 *     already-visible projects, deliberately unlike getRecordedEvaluation
 *     (deviation recorded in DEC-20261111-02).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-kill-eval-aggregate.sqlite";
const NOW = "2026-11-11T00:00:00Z";
// CO_NEWBIZ_DB_PATH must be set BEFORE the db client module loads.
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { killEvalStates } = await import("../../app/web-next/lib/gate-aging.ts");

type Db = ReturnType<typeof getDb>;
let db: Db;
let viewer: string;
let insider: string;

beforeAll(() => {
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  viewer = "eval-viewer";
  insider = "eval-insider";
  for (const u of [viewer, insider]) {
    db.run(
      "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), u, "analyst", "active", "salt", "hash", 1, NOW],
    );
  }
}, 60000);

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function insertProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  return id;
}

function insertMnpiProject(): string {
  const id = insertProject();
  db.run(
    "INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)",
    [id, "restricted", 1, "legal", NOW],
  );
  return id;
}

function enrollInsider(projectId: string, userId: string): void {
  db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [
    projectId,
    userId,
    NOW,
    "test fixture enrollment",
  ]);
}

function insertRun(projectId: string): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [
    id,
    projectId,
    `hash-${id.slice(-6)}`,
    viewer,
    NOW,
  ]);
  return id;
}

function insertEval(
  projectId: string,
  outcome: "triggered" | "false" | "unassessed",
  over: { runId?: string; criterion?: string; procedure?: string } = {},
): void {
  const runId = over.runId ?? insertRun(projectId);
  const criterion = over.criterion ?? `crit-${ulid().slice(-6)}`;
  const procedure = over.procedure ?? "brownfield-dd";
  db.run(
    "INSERT INTO kill_criteria_evaluation (id, run_id, project_id, procedure_key, criterion_id, action, outcome, predicate_json, policy_id, thresholds_source, evaluated_at, evaluated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [ulid(), runId, projectId, procedure, criterion, "halt", outcome, "{}", "policy", "thresholds", NOW, viewer],
  );
}

describe("killEvalStates — the aggregate state machine", () => {
  test("empty ledger → no map entry (the board renders a non-claim, never a pass)", () => {
    const projectId = insertProject();
    const map = killEvalStates(db, { projectIds: [projectId], viewerId: viewer });
    expect(map.has(projectId)).toBe(false);
    expect(map.get(projectId)).toBeUndefined();
  });

  test("all-false ledger → 'false'", () => {
    const projectId = insertProject();
    insertEval(projectId, "false", { criterion: "c1" });
    insertEval(projectId, "false", { criterion: "c2" });
    expect(killEvalStates(db, { projectIds: [projectId], viewerId: viewer }).get(projectId)).toBe("false");
  });

  test("any unassessed row dominates a false one → 'unassessed'", () => {
    const projectId = insertProject();
    insertEval(projectId, "false", { criterion: "c1" });
    insertEval(projectId, "unassessed", { criterion: "c2" });
    expect(killEvalStates(db, { projectIds: [projectId], viewerId: viewer }).get(projectId)).toBe("unassessed");
  });

  test("any triggered row dominates everything → 'triggered'", () => {
    const projectId = insertProject();
    insertEval(projectId, "unassessed", { criterion: "c1" });
    insertEval(projectId, "false", { criterion: "c2" });
    insertEval(projectId, "triggered", { criterion: "c3" });
    expect(killEvalStates(db, { projectIds: [projectId], viewerId: viewer }).get(projectId)).toBe("triggered");
  });

  test("one aggregate query serves many projects; duplicate/blank ids are tolerated", () => {
    const p1 = insertProject();
    const p2 = insertProject();
    insertEval(p1, "triggered", { criterion: "c1" });
    insertEval(p2, "false", { criterion: "c1" });
    const map = killEvalStates(db, { projectIds: [p1, p2, p1, "", p2], viewerId: viewer });
    expect(map.get(p1)).toBe("triggered");
    expect(map.get(p2)).toBe("false");
  });

  test("empty id list → no query at all, empty map", () => {
    expect(killEvalStates(db, { projectIds: [], viewerId: viewer }).size).toBe(0);
  });
});

describe("killEvalStates — MNPI suppression (FR-SEC-06 semantics)", () => {
  test("MNPI project, actor off the insider list → suppressed (removed from the map → null on the board)", () => {
    const projectId = insertMnpiProject();
    insertEval(projectId, "triggered", { criterion: "c1" });
    const map = killEvalStates(db, { projectIds: [projectId], viewerId: viewer });
    expect(map.has(projectId)).toBe(false);
  });

  test("MNPI project, actor on the ACTIVE insider list → state shown", () => {
    const projectId = insertMnpiProject();
    enrollInsider(projectId, insider);
    insertEval(projectId, "triggered", { criterion: "c1" });
    expect(killEvalStates(db, { projectIds: [projectId], viewerId: insider }).get(projectId)).toBe("triggered");
  });

  test("a REMOVED insider loses visibility (removed_at IS NULL is the live-list predicate)", () => {
    const projectId = insertMnpiProject();
    enrollInsider(projectId, insider);
    db.run("UPDATE insider_list SET removed_at = ? WHERE project_id = ? AND user_id = ?", [NOW, projectId, insider]);
    insertEval(projectId, "false", { criterion: "c1" });
    const map = killEvalStates(db, { projectIds: [projectId], viewerId: insider });
    expect(map.has(projectId)).toBe(false);
  });

  test("mnpi_flag=0 projects are never suppressed, insider or not", () => {
    const projectId = insertProject();
    insertEval(projectId, "false", { criterion: "c1" });
    expect(killEvalStates(db, { projectIds: [projectId], viewerId: viewer }).get(projectId)).toBe("false");
  });
});

describe("killEvalStates — no audit noise (DEC-20261111-02 deviation)", () => {
  test("the aggregate writes no data_access_log rows (unlike getRecordedEvaluation)", () => {
    const before = (
      db.query("SELECT COUNT(*) AS n FROM data_access_log WHERE table_key = 'kill_criteria_evaluation'").get() as {
        n: number;
      }
    ).n;
    const projectId = insertMnpiProject();
    enrollInsider(projectId, insider);
    insertEval(projectId, "triggered", { criterion: "c1" });
    killEvalStates(db, { projectIds: [projectId], viewerId: insider });
    const after = (
      db.query("SELECT COUNT(*) AS n FROM data_access_log WHERE table_key = 'kill_criteria_evaluation'").get() as {
        n: number;
      }
    ).n;
    expect(after).toBe(before);
  });
});
