/**
 * Unit tests for setMnpiFlag() (PR-5b, spec constraint 7) — the retroactive
 * enrollment fix for PR-4's surveyed gap: members granted BEFORE an
 * mnpi_flag upgrade were never enrolled onto the insider list, so the
 * flag-flip path itself must enroll every then-active member in the SAME
 * transaction. Real scratch SQLite (security.test.ts pattern — this file
 * exercises the same engine those tests cover).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { setMnpiFlag, requireInsiderIfMnpi } from "../../db/lib/access-control.ts";

const TEST_DB_PATH = "db/data/test-mnpi-flag-flip.sqlite";
const T0 = "2026-08-23T09:00:00Z"; // members granted before the flip
const T1 = "2026-08-23T12:00:00Z"; // the 0→1 flip
const T2 = "2026-08-23T18:00:00Z"; // the 1→0 downgrade + second 0→1

type Db = ReturnType<typeof GetDb>;
let db: Db;

const ADMIN = "user-admin"; // the flag-setter (member of every fixture project)
const U1 = "user-001";
const U2 = "user-002";
const U3 = "user-003";

function insertUser(userId: string): void {
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), userId, "analyst", "active", "salt", "hash", 1, T0],
  );
}

/** A project with a project_classification row (mnpi_flag=0) and the given members. */
function classifiedProject(members: string[], opts: { revoked?: string[] } = {}): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, T0]);
  db.run(
    "INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)",
    [id, "confidential", 0, "legal", T0],
  );
  for (const m of [ADMIN, ...members]) {
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [id, m, "member", "admin", T0, "test fixture basis"],
    );
  }
  for (const r of opts.revoked ?? []) {
    db.run("UPDATE project_member SET revoked_at = ? WHERE project_id = ? AND user_id = ?", [T0, id, r]);
  }
  return id;
}

function insiderRows(pid: string): { user_id: string; added_at: string; removed_at: string | null }[] {
  return db
    .query("SELECT user_id, added_at, removed_at FROM insider_list WHERE project_id = ? ORDER BY user_id")
    .all(pid) as never[];
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  for (const u of [ADMIN, U1, U2, U3]) insertUser(u);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// Input gates
// ---------------------------------------------------------------------------

describe("input gates", () => {
  test("no project_classification row → REJECTED (mnpi_flag has no standalone life)", () => {
    const pid = ulid();
    db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [pid, `NP-${pid.slice(-6)}`, T0]);
    expect(() => setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: ADMIN, reason: "r", now: T1 })).toThrow(
      /No project_classification row/,
    );
  });

  test("empty reason → REJECTED (an unexplained sensitivity flip is unauditable)", () => {
    const pid = classifiedProject([]);
    expect(() => setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: ADMIN, reason: " ", now: T1 })).toThrow(/non-empty reason/);
  });

  test("non-member setBy → REJECTED (a project-scope governance write needs membership)", () => {
    const pid = classifiedProject([U1]); // U3 is not a member
    expect(() => setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: U3, reason: "r", now: T1 })).toThrow(
      new RegExp(`'${U3}' is not an active project_member`),
    );
  });
});

// ---------------------------------------------------------------------------
// The surveyed gap — retroactive enrollment on 0→1
// ---------------------------------------------------------------------------

describe("retroactive enrollment (0→1)", () => {
  test("every then-active member lands on the insider list in the SAME transaction, enrollment date = flip date; revoked members do NOT", () => {
    const pid = classifiedProject([U1, U2, U3], { revoked: [U3] });
    expect(insiderRows(pid)).toEqual([]); // pre-flip: nobody enrolled (the surveyed gap)

    setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: ADMIN, reason: "target disclosed earnings pre-close", now: T1 });

    const rows = insiderRows(pid);
    expect(rows.map((r) => r.user_id).sort()).toEqual([ADMIN, U1, U2].sort()); // U3 revoked → not enrolled
    for (const r of rows) {
      expect(r.added_at).toBe(T1); // enrollment-date = flag-flip date
      expect(r.removed_at).toBeNull();
    }
    // The flip is atomic from the write-path's perspective: immediately after,
    // the insider guard passes for enrolled members and rejects a non-member.
    expect(() => requireInsiderIfMnpi(db, pid, U1)).not.toThrow();
    const outsider = ulid();
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [pid, outsider, "member", "admin", T1, "post-flip grant without enrollment"],
    );
    expect(() => requireInsiderIfMnpi(db, pid, outsider)).toThrow(/MNPI project.*not on its active insider list/);
  });

  test("the flip is audited and logged as a write", () => {
    const pid = classifiedProject([U1]);
    setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: ADMIN, reason: "board memo flags MNPI", now: T1 });
    const audit = db
      .query("SELECT actor_user_id, action, target FROM audit_log WHERE action = 'mnpi_flag_set' AND target = ?")
      .get(`${pid}:1`) as { actor_user_id: string };
    expect(audit.actor_user_id).toBe(ADMIN);
    const log = db
      .query("SELECT user_id, action FROM data_access_log WHERE table_key = 'project_classification' AND record_ref = ?")
      .get(`${pid}:mnpi_flag=1`) as { user_id: string; action: string };
    expect(log).toEqual({ user_id: ADMIN, action: "write" });
  });
});

// ---------------------------------------------------------------------------
// Downgrade + re-flip — the roster is a record, not a mirror of the flag
// ---------------------------------------------------------------------------

describe("downgrade (1→0) and second flip (0→1)", () => {
  test("1→0 downgrades the flag but leaves the insider roster intact (the record of who HELD access survives)", () => {
    const pid = classifiedProject([U1]);
    setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: ADMIN, reason: "flag up", now: T1 });
    setMnpiFlag(db, { projectId: pid, mnpiFlag: 0, setBy: ADMIN, reason: "deal abandoned — disclosure moot", now: T2 });
    expect((db.query("SELECT mnpi_flag FROM project_classification WHERE project_id = ?").get(pid) as { mnpi_flag: number }).mnpi_flag).toBe(0);
    expect(insiderRows(pid)).toHaveLength(2); // ADMIN + U1 still recorded
    // flag 0 → the guard no longer enforces insider status
    expect(() => requireInsiderIfMnpi(db, pid, U1)).not.toThrow();
  });

  test("second 0→1 flip NO-OPS the enrollment of already-listed members (added_at preserved)", () => {
    const pid = classifiedProject([U1]);
    setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: ADMIN, reason: "first flip", now: T1 });
    const before = insiderRows(pid);
    setMnpiFlag(db, { projectId: pid, mnpiFlag: 0, setBy: ADMIN, reason: "down", now: T2 });
    setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: ADMIN, reason: "second flip", now: T2 });
    const after = insiderRows(pid);
    expect(after).toEqual(before); // identical rows — added_at NOT rewritten by the second flip
  });

  test("a member whose insider row was closed (but membership still active) is RE-ACTIVATED with the original enrollment date", () => {
    const pid = classifiedProject([U1]);
    setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: ADMIN, reason: "first flip", now: T1 });
    db.run("UPDATE insider_list SET removed_at = ? WHERE project_id = ? AND user_id = ?", [T1, pid, U1]); // e.g. manual delisting
    setMnpiFlag(db, { projectId: pid, mnpiFlag: 1, setBy: ADMIN, reason: "re-flip after delisting", now: T2 });
    const row = db.query("SELECT added_at, removed_at FROM insider_list WHERE project_id = ? AND user_id = ?").get(pid, U1) as { added_at: string; removed_at: string | null };
    expect(row.removed_at).toBeNull(); // re-activated
    expect(row.added_at).toBe(T1); // original enrollment date preserved — never laundered
  });
});
