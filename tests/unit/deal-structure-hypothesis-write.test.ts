/**
 * Unit tests for the deal-structure-hypothesis repository (PR-5b, spec
 * constraint 9) — ADR-0045's four mandatory axes, migration 0013's shape.
 * Real scratch SQLite (certification-repository test pattern).
 *
 * The core property under test is the NO-NAKED-FLAG-WRITES rule:
 * four_axis_review_completed has exactly one repository setter
 * (completeFourAxisReview) and it requires the reviewer identity plus a
 * reference to the deal_structure_review artifact. The module-surface pin
 * below makes a future generic update() an audible test failure, and the
 * audit-trail assertion proves the artifact reference is recorded where a
 * deliberate governance act belongs.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import * as hypothesisRepo from "../../db/repositories/deal-structure-hypothesis.repository.ts";

const TEST_DB_PATH = "db/data/test-deal-structure-hypothesis-write.sqlite";
const NOW = "2026-08-23T10:00:00Z";
const ARTIFACT = "deliverables/reports/P012-brownfield-fs-deal-structure-review.pdf";
// 2026-10-21: completion now requires all four ADR-0045 axis notes — fixtures
// that complete a hypothesis carry them.
const NOTES = { tax_structure_note: "절세", liability_isolation_note: "책임격리", financing_leverage_note: "레버리지", exit_structure_note: "엑싯" };

type Db = ReturnType<typeof GetDb>;
let db: Db;

const U1 = "user-001"; // author, member
const U2 = "user-002"; // reviewer, member
const U3 = "user-003"; // non-member everywhere

function insertUser(userId: string): void {
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), userId, "analyst", "active", "salt", "hash", 1, NOW],
  );
}

function insertProject(mnpi = false): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  if (mnpi) {
    db.run(
      "INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)",
      [id, "restricted", 1, "legal", NOW],
    );
  }
  return id;
}

function grantMember(projectId: string, userId: string): void {
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, userId, "member", "admin", NOW, "test fixture basis"],
  );
}

function enrollInsider(projectId: string, userId: string): void {
  db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [projectId, userId, NOW, "test fixture enrollment"]);
}

function plainProject(): string {
  const pid = insertProject(false);
  grantMember(pid, U1);
  grantMember(pid, U2);
  return pid;
}

function writeLogCount(pid: string): number {
  return (db
    .query("SELECT COUNT(*) AS c FROM data_access_log WHERE table_key = 'deal_structure_hypothesis' AND project_id = ? AND action = 'write'")
    .get(pid) as { c: number }).c;
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  insertUser(U1);
  insertUser(U2);
  insertUser(U3);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// hypothesize()
// ---------------------------------------------------------------------------

describe("hypothesize()", () => {
  test("minimal row (all five axis enums omitted) inserts with four_axis_review_completed=0", () => {
    const pid = plainProject();
    const row = hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U1, rationale: "early shape hypothesis — vehicle undecided", now: NOW });
    expect(row.asset_or_stock).toBeNull();
    expect(row.vehicle).toBeNull();
    expect(row.four_axis_review_completed).toBe(0);
    expect(hypothesisRepo.getHypotheses(pid)).toHaveLength(1);
  });

  test("full ADR-0045/FR-RBD-07/12 axes insert; run_id nullable-but-valid attaches", () => {
    const pid = plainProject();
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [runId, pid, `hash-${runId.slice(-6)}`, U1, NOW]);
    const row = hypothesisRepo.hypothesize({
      project_id: pid,
      run_id: runId,
      asset_or_stock: "mixed",
      stake_type: "joint_control",
      instrument_mix: "mixed",
      vehicle: "internal_venture_spinoff",
      commercialization_path: "minority_venture_investment",
      tax_structure_note: "holdco step-up preserves K-ISMS R&D credit",
      liability_isolation_note: "SPV ring-fences environmental legacy",
      financing_leverage_note: "3.5x EBITDA target",
      exit_structure_note: "tag-along + 5y put",
      hypothesized_by: U1,
      rationale: "carve-out with JV partner",
      now: NOW,
    });
    expect(row.vehicle).toBe("internal_venture_spinoff");
    expect(row.run_id).toBe(runId);
  });

  test("empty rationale → REJECTED", () => {
    const pid = plainProject();
    expect(() => hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U1, rationale: " ", now: NOW })).toThrow(/rationale is mandatory/);
  });

  test("phantom run → REJECTED; another project's run → REJECTED", () => {
    const pid = plainProject();
    expect(() => hypothesisRepo.hypothesize({ project_id: pid, run_id: "01NOSUCHRUN000000003", hypothesized_by: U1, rationale: "r", now: NOW })).toThrow(/does not exist/);
    const other = plainProject();
    const otherRun = ulid();
    db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [otherRun, other, `hash-${otherRun.slice(-6)}`, U1, NOW]);
    expect(() => hypothesisRepo.hypothesize({ project_id: pid, run_id: otherRun, hypothesized_by: U1, rationale: "r", now: NOW })).toThrow(/belongs to project/);
  });

  test("non-member hypothesized_by → REJECTED; MNPI non-insider member → REJECTED, insider → ACCEPTED", () => {
    const pid = plainProject();
    expect(() => hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U3, rationale: "r", now: NOW })).toThrow(new RegExp(`'${U3}' is not an active project_member`));

    const mnpiPid = insertProject(true);
    grantMember(mnpiPid, U1);
    expect(() => hypothesisRepo.hypothesize({ project_id: mnpiPid, hypothesized_by: U1, rationale: "r", now: NOW })).toThrow(/MNPI project.*not on its active insider list/);
    enrollInsider(mnpiPid, U1);
    expect(hypothesisRepo.hypothesize({ project_id: mnpiPid, hypothesized_by: U1, rationale: "r", now: NOW }).four_axis_review_completed).toBe(0);
  });

  test("every accepted hypothesize logs a write", () => {
    const pid = plainProject();
    const before = writeLogCount(pid);
    hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U1, rationale: "r", now: NOW });
    expect(writeLogCount(pid)).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// completeFourAxisReview() — the only flag setter
// ---------------------------------------------------------------------------

describe("completeFourAxisReview()", () => {
  test("without an artifact_ref → REJECTED (a completed review without its artifact is an unsupported claim)", () => {
    const pid = plainProject();
    const row = hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U1, rationale: "r", now: NOW });
    expect(() => hypothesisRepo.completeFourAxisReview({ hypothesis_id: row.id, reviewed_by: U2, artifact_ref: "", now: NOW })).toThrow(
      /requires a deal_structure_review artifact_ref.*unsupported claim/s,
    );
    expect((db.query("SELECT four_axis_review_completed FROM deal_structure_hypothesis WHERE id = ?").get(row.id) as { four_axis_review_completed: number }).four_axis_review_completed).toBe(0);
  });

  test("with reviewer identity + artifact_ref → sets 0→1 and records the artifact in the append-only audit trail", () => {
    const pid = plainProject();
    const row = hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U1, rationale: "r", ...NOTES, now: NOW });
    const completed = hypothesisRepo.completeFourAxisReview({ hypothesis_id: row.id, reviewed_by: U2, artifact_ref: ARTIFACT, now: NOW });
    expect(completed.four_axis_review_completed).toBe(1);
    const audit = db
      .query("SELECT actor_user_id, action, target FROM audit_log WHERE action = 'four_axis_review_completed' AND target LIKE ?")
      .get(`${row.id}:%`) as { actor_user_id: string; action: string; target: string };
    expect(audit.actor_user_id).toBe(U2);
    expect(audit.target).toBe(`${row.id}:${ARTIFACT}`);
  });

  test("an empty axis note → REJECTED (a four-axis review with an unwritten axis is not a review of four axes)", () => {
    const pid = plainProject();
    const row = hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U1, rationale: "r", ...NOTES, exit_structure_note: "", now: NOW });
    expect(() => hypothesisRepo.completeFourAxisReview({ hypothesis_id: row.id, reviewed_by: U2, artifact_ref: ARTIFACT, now: NOW })).toThrow(/four_axis_note_missing:exit_structure_note/);
    expect((db.query("SELECT four_axis_review_completed FROM deal_structure_hypothesis WHERE id = ?").get(row.id) as { four_axis_review_completed: number }).four_axis_review_completed).toBe(0);
  });

  test("second completion of the same hypothesis → REJECTED", () => {
    const pid = plainProject();
    const row = hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U1, rationale: "r", ...NOTES, now: NOW });
    hypothesisRepo.completeFourAxisReview({ hypothesis_id: row.id, reviewed_by: U2, artifact_ref: ARTIFACT, now: NOW });
    expect(() => hypothesisRepo.completeFourAxisReview({ hypothesis_id: row.id, reviewed_by: U2, artifact_ref: "another.pdf", now: NOW })).toThrow(/already has four_axis_review_completed=1/);
  });

  test("non-member reviewer → REJECTED; MNPI non-insider reviewer → REJECTED", () => {
    const pid = plainProject();
    const row = hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U1, rationale: "r", ...NOTES, now: NOW });
    expect(() => hypothesisRepo.completeFourAxisReview({ hypothesis_id: row.id, reviewed_by: U3, artifact_ref: ARTIFACT, now: NOW })).toThrow(new RegExp(`'${U3}' is not an active project_member`));

    const mnpiPid = insertProject(true);
    grantMember(mnpiPid, U1);
    grantMember(mnpiPid, U2);
    enrollInsider(mnpiPid, U1); // author yes, reviewer no
    const mrow = hypothesisRepo.hypothesize({ project_id: mnpiPid, hypothesized_by: U1, rationale: "r", ...NOTES, now: NOW });
    expect(() => hypothesisRepo.completeFourAxisReview({ hypothesis_id: mrow.id, reviewed_by: U2, artifact_ref: ARTIFACT, now: NOW })).toThrow(/MNPI project.*not on its active insider list/);
  });

  test("completion logs a write", () => {
    const pid = plainProject();
    const row = hypothesisRepo.hypothesize({ project_id: pid, hypothesized_by: U1, rationale: "r", ...NOTES, now: NOW });
    const before = writeLogCount(pid);
    hypothesisRepo.completeFourAxisReview({ hypothesis_id: row.id, reviewed_by: U2, artifact_ref: ARTIFACT, now: NOW });
    expect(writeLogCount(pid)).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// No naked flag writes — the repository surface is pinned
// ---------------------------------------------------------------------------

describe("no naked flag writes", () => {
  test("the module exports exactly hypothesize/getHypotheses/completeFourAxisReview (+ the axis-note predicate constants) — no generic update exists", () => {
    expect(Object.keys(hypothesisRepo).sort()).toEqual(["FOUR_AXIS_NOTE_FIELDS", "completeFourAxisReview", "getHypotheses", "hypothesize", "missingFourAxisNotes"]);
  });

  test("hypothesize() input carries no four_axis_review_completed field — the flag cannot ride along on an insert", () => {
    const pid = plainProject();
    const row = hypothesisRepo.hypothesize({
      project_id: pid,
      hypothesized_by: U1,
      rationale: "r",
      now: NOW,
      // @ts-expect-error — deliberately absent from HypothesizeInput; if this
      // ever stops erroring, the flag became insertable and constraint 9 broke.
      four_axis_review_completed: 1,
    });
    expect(row.four_axis_review_completed).toBe(0); // the stray field is ignored, never written
  });
});
