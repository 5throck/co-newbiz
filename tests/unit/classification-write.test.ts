/**
 * Unit tests for the classification repository's Decision-5a write asymmetry
 * (PR-5b) — design of record
 * docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md
 * Decision 5a/5b, ADR-0047 §1. Real scratch SQLite (certification-repository
 * test pattern) so the 0013 constraints (partial live index, enums) are
 * exercised by SQLite itself.
 *
 * LAYERING UNDER TEST (same two-layer proof as the certification tests):
 *   - the DB admits an approval-free internal-origin row via raw INSERT
 *     (0013 deliberately left the approver trio nullable) — proven once, so
 *     the block is known to live HERE, not in the schema;
 *   - the repository is the layer that prices validator-set-reducing origins
 *     at no less than a waiver: authority-checked approver_role, a DISTINCT
 *     member approver, approved_at — plus FR-SEC-08 membership, FR-SEC-06
 *     insider status, and write logging on every mutation.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  classify,
  supersede,
  getLiveClassification,
  CLASSIFICATION_APPROVER_AUTHORITY,
} from "../../db/repositories/classification.repository.ts";

const TEST_DB_PATH = "db/data/test-classification-write.sqlite";
const NOW = "2026-08-23T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;

/** user-001 author/member, user-002 approver/member, user-003 non-member everywhere. */
const U1 = "user-001";
const U2 = "user-002";
const U3 = "user-003";

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
  db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [
    projectId,
    userId,
    NOW,
    "test fixture enrollment",
  ]);
}

/** A plain (non-MNPI) project with U1+U2 as members. */
function plainProject(): string {
  const pid = insertProject(false);
  grantMember(pid, U1);
  grantMember(pid, U2);
  return pid;
}

const EXTERNAL = { project_id: "", case_type: "brownfield" as const, origin: "external" as const, classified_by: U1, rationale: "external acquisition — enlarges the validator set" };
const INTERNAL = { project_id: "", case_type: "brownfield" as const, origin: "internal" as const, classified_by: U1, rationale: "internal venture — narrows the validator set" };
const TRIO = { approver_role: "process-governance-manager", approved_by: U2, approved_at: NOW };

function writeLogCount(pid: string): number {
  return (db
    .query("SELECT COUNT(*) AS c FROM data_access_log WHERE table_key = 'project_case_classification' AND project_id = ? AND action = 'write'")
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
// Constraint 4 — the asymmetry itself
// ---------------------------------------------------------------------------

describe("Decision 5a: origin asymmetry", () => {
  test("origin=internal WITHOUT the approver trio → REJECTED, named error, no row", () => {
    const pid = plainProject();
    expect(() => classify({ ...INTERNAL, project_id: pid, now: NOW })).toThrow(
      /classification_write_rejected.*internal.*reduces the validator set.*approver_role.*missing/s,
    );
    expect(db.query("SELECT COUNT(*) AS c FROM project_case_classification WHERE project_id = ?").get(pid)).toEqual({ c: 0 });
  });

  test("partial trio (role + approver, no approved_at) → still REJECTED", () => {
    const pid = plainProject();
    expect(() =>
      classify({ ...INTERNAL, project_id: pid, approval: { approver_role: "process-governance-manager", approved_by: U2, approved_at: "" }, now: NOW }),
    ).toThrow(/approved_at.*missing/);
  });

  test("origin=internal WITH the full trio (distinct members, authority OK) → ACCEPTED", () => {
    const pid = plainProject();
    const row = classify({ ...INTERNAL, project_id: pid, approval: TRIO, now: NOW });
    expect(row.origin).toBe("internal");
    expect(row.approver_role).toBe("process-governance-manager");
    expect(row.approved_by).toBe(U2);
    expect(row.approved_at).toBe(NOW);
    expect(getLiveClassification(pid)?.id).toBe(row.id);
  });

  test("every authority-list role is accepted; a role outside the list is REJECTED", () => {
    for (const role of CLASSIFICATION_APPROVER_AUTHORITY) {
      const pid = plainProject();
      const row = classify({ ...INTERNAL, project_id: pid, approval: { ...TRIO, approver_role: role }, now: NOW });
      expect(row.approver_role).toBe(role);
    }
    const pid = plainProject();
    expect(() => classify({ ...INTERNAL, project_id: pid, approval: { ...TRIO, approver_role: "brownfield-agent" }, now: NOW })).toThrow(
      /approver_role 'brownfield-agent' lacks classification approval authority/,
    );
  });

  test("approved_by === classified_by → REJECTED (the two-party control is the point)", () => {
    const pid = plainProject();
    expect(() => classify({ ...INTERNAL, project_id: pid, approval: { ...TRIO, approved_by: U1 }, now: NOW })).toThrow(
      /approved_by must be a project_member DISTINCT from classified_by/,
    );
  });

  test("approved_by not an active member → REJECTED", () => {
    const pid = plainProject(); // U3 has no membership anywhere
    expect(() => classify({ ...INTERNAL, project_id: pid, approval: { ...TRIO, approved_by: U3 }, now: NOW })).toThrow(
      new RegExp(`'${U3}' is not an active project_member`),
    );
  });

  test("origin=external single-writer + rationale → ACCEPTED; without rationale → REJECTED", () => {
    const pid = plainProject();
    const row = classify({ ...EXTERNAL, project_id: pid, now: NOW });
    expect(row.origin).toBe("external");
    expect(row.approver_role).toBeNull(); // single-writer direction stores no approval noise

    const pid2 = plainProject();
    expect(() => classify({ ...EXTERNAL, project_id: pid2, rationale: "  ", now: NOW })).toThrow(
      /rationale is mandatory for every classification/,
    );
  });
});

// ---------------------------------------------------------------------------
// Constraint 5 — downgrade protection on supersede
// ---------------------------------------------------------------------------

describe("downgrade protection (external → internal supersede)", () => {
  test("superseding a live external row with origin=internal but no trio → REJECTED; the external row stays live", () => {
    const pid = plainProject();
    const first = classify({ ...EXTERNAL, project_id: pid, now: NOW });
    expect(() => supersede({ ...INTERNAL, project_id: pid, now: NOW })).toThrow(
      /reduces the validator set.*approver_role.*missing/s,
    );
    expect(getLiveClassification(pid)?.id).toBe(first.id); // untouched
  });

  test("with the full trio → ACCEPTED; history preserved, one live row", () => {
    const pid = plainProject();
    const first = classify({ ...EXTERNAL, project_id: pid, now: NOW });
    const second = supersede({ ...INTERNAL, project_id: pid, approval: TRIO, now: NOW });
    expect(second.superseded_by).toBeNull();
    expect(getLiveClassification(pid)?.id).toBe(second.id);
    expect((db.query("SELECT superseded_by FROM project_case_classification WHERE id = ?").get(first.id) as { superseded_by: string }).superseded_by).toBe(second.id);
    expect((db.query("SELECT COUNT(*) AS c FROM project_case_classification WHERE project_id = ?").get(pid) as { c: number }).c).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Constraint 6 — membership + MNPI on the classification writer
// ---------------------------------------------------------------------------

describe("membership + MNPI controls", () => {
  test("non-member classified_by → REJECTED", () => {
    const pid = plainProject(); // U3 is not a member
    expect(() => classify({ ...EXTERNAL, project_id: pid, classified_by: U3, now: NOW })).toThrow(
      new RegExp(`'${U3}' is not an active project_member`),
    );
  });

  test("revoked membership counts as non-member → REJECTED", () => {
    const pid = plainProject();
    db.run("UPDATE project_member SET revoked_at = ? WHERE project_id = ? AND user_id = ?", [NOW, pid, U1]);
    expect(() => classify({ ...EXTERNAL, project_id: pid, now: NOW })).toThrow(/not an active project_member/);
  });

  test("MNPI project, member not on the insider list → REJECTED", () => {
    const pid = insertProject(true);
    grantMember(pid, U1);
    grantMember(pid, U2);
    expect(() => classify({ ...EXTERNAL, project_id: pid, now: NOW })).toThrow(
      /MNPI project.*not on its active insider list/,
    );
  });

  test("MNPI project, member on the insider list → ACCEPTED", () => {
    const pid = insertProject(true);
    grantMember(pid, U1);
    enrollInsider(pid, U1);
    const row = classify({ ...EXTERNAL, project_id: pid, now: NOW });
    expect(row.origin).toBe("external");
  });

  test("MNPI project: reducing origin also requires the APPROVER to be an insider", () => {
    const pid = insertProject(true);
    grantMember(pid, U1);
    grantMember(pid, U2);
    enrollInsider(pid, U1); // U2 (approver) deliberately NOT enrolled
    expect(() => classify({ ...INTERNAL, project_id: pid, approval: TRIO, now: NOW })).toThrow(
      new RegExp(`'${U2}' is not on its active insider list`),
    );
    enrollInsider(pid, U2);
    expect(classify({ ...INTERNAL, project_id: pid, approval: TRIO, now: NOW }).origin).toBe("internal");
  });
});

// ---------------------------------------------------------------------------
// Constraint 3 — append-only discipline + the single legal supersede order
// ---------------------------------------------------------------------------

describe("append-only discipline", () => {
  test("classify() onto a project that already has a live row → REJECTED (supersede() is the only path)", () => {
    const pid = plainProject();
    classify({ ...EXTERNAL, project_id: pid, now: NOW });
    expect(() => classify({ ...EXTERNAL, project_id: pid, now: NOW })).toThrow(
      /already has a live classification.*supersede\(\) is the only legal re-classification path/s,
    );
  });

  test("supersede() with no live row to replace → REJECTED (classify() writes the first row)", () => {
    const pid = plainProject();
    expect(() => supersede({ ...EXTERNAL, project_id: pid, now: NOW })).toThrow(/no live classification to supersede/);
  });

  test("reversing the statement sequence trips the partial unique live index (raw SQL proof)", () => {
    const pid = plainProject();
    const first = classify({ ...EXTERNAL, project_id: pid, now: NOW });
    // successor born non-live (legal) …
    const second = ulid();
    db.run(
      "INSERT INTO project_case_classification (id, project_id, case_type, origin, classified_by, classified_at, rationale, superseded_by) VALUES (?,?,?,?,?,?,?,?)",
      [second, pid, "brownfield", "external", U1, NOW, "successor born non-live", first.id],
    );
    // … then going live BEFORE the predecessor retires trips the index —
    // the database rejects the reversed order, which is why the repository
    // hard-codes retire-then-live inside one transaction.
    expect(() => db.run("UPDATE project_case_classification SET superseded_by = NULL WHERE id = ?", [second])).toThrow(
      /UNIQUE constraint failed/,
    );
  });
});

// ---------------------------------------------------------------------------
// Constraint 6(b) — write logging on every mutation
// ---------------------------------------------------------------------------

describe("write logging", () => {
  test("every accepted classify/supersede writes exactly one data_access_log row (action=write)", () => {
    const pid = plainProject();
    const before = writeLogCount(pid);
    classify({ ...EXTERNAL, project_id: pid, now: NOW });
    expect(writeLogCount(pid)).toBe(before + 1);
    supersede({ ...INTERNAL, project_id: pid, approval: TRIO, now: NOW });
    expect(writeLogCount(pid)).toBe(before + 2);
  });

  test("a REJECTED write logs nothing", () => {
    const pid = plainProject();
    const before = writeLogCount(pid);
    expect(() => classify({ ...INTERNAL, project_id: pid, now: NOW })).toThrow();
    expect(writeLogCount(pid)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Layering proof — the block lives in the repository, not the schema
// ---------------------------------------------------------------------------

describe("layering proof", () => {
  test("a raw INSERT still lands an approval-free internal row — the DB's job is shape, the repository's is governance", () => {
    const pid = plainProject();
    db.run(
      "INSERT INTO project_case_classification (id, project_id, case_type, origin, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?)",
      [ulid(), pid, "brownfield", "internal", U1, NOW, "raw SQL bypass — 0013 leaves the trio nullable by design"],
    );
    const live = getLiveClassification(pid)!;
    expect(live.origin).toBe("internal");
    expect(live.approver_role).toBeNull();
    // If this ever fails with a CHECK error, the two-party control silently
    // moved into the DB and the repository tests above are enforcing nothing.
  });
});
