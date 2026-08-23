/**
 * Unit tests for the dimension-input repository (PR-5b) — design of record
 * Decision 3 (cross-domain review before routing use), migration 0013's
 * shape, and the PR-5b spec constraints 6/8. Real scratch SQLite
 * (certification-repository test pattern).
 *
 * What feeds db/lib/applies-when.ts is exactly what these writes produce:
 * an assertion drives routing only while BOTH live (superseded_by IS NULL)
 * AND reviewed (reviewed_by IS NOT NULL) — so the supersede-inside-the-
 * transaction and review-is-a-separate-act semantics below are upstream
 * dependencies of PR-5a's resolver, not just table hygiene.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { assert, review, getLiveAssertion, getAssertionHistory } from "../../db/repositories/dimension-input.repository.ts";

const TEST_DB_PATH = "db/data/test-dimension-input-write.sqlite";
const NOW = "2026-08-23T10:00:00Z";
/** Seeded by migration 0014: asserted, boolean, requires_evidence_ref=1. */
const SEEDED_BOOL_VAR = "target.has_external_market_presence";

type Db = ReturnType<typeof GetDb>;
let db: Db;

const U1 = "user-001"; // asserter, member
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
    [projectId, userId, "contributor", "admin", NOW, "test fixture basis"],
  );
}

function enrollInsider(projectId: string, userId: string): void {
  db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [projectId, userId, NOW, "test fixture enrollment"]);
}

/** A plain (non-MNPI) project with U1+U2 members and one run. Returns [pid, runId]. */
function plainProjectWithRun(): [string, string] {
  const pid = insertProject(false);
  grantMember(pid, U1);
  grantMember(pid, U2);
  const runId = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [runId, pid, `hash-${runId.slice(-6)}`, U1, NOW]);
  return [pid, runId];
}

function writeLogCount(pid: string): number {
  return (db
    .query("SELECT COUNT(*) AS c FROM data_access_log WHERE table_key = 'dimension_input' AND project_id = ? AND action = 'write'")
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
// Constraint 8 — assert(): registry coherence, run scoping, shape gates
// ---------------------------------------------------------------------------

describe("assert(): registry coherence", () => {
  test("boolean var asserted with kind=bool + evidence_ref → ACCEPTED, born unreviewed (the flag)", () => {
    const [pid, runId] = plainProjectWithRun();
    const row = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:cim-p12", asserted_by: U1, rationale: "carve-out sells to external customers", now: NOW });
    expect(row.value_text).toBe("true");
    expect(row.reviewed_by).toBeNull(); // unreviewed insert OK but flagged — review is a separate act
    expect(getLiveAssertion(pid, SEEDED_BOOL_VAR)?.id).toBe(row.id);
  });

  test("value_kind incoherent with the registry → REJECTED (num payload on a boolean var)", () => {
    const [pid, runId] = plainProjectWithRun();
    expect(() =>
      assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "num", value: 1 }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW }),
    ).toThrow(/incoherent with the registry.*boolean.*'bool'/s);
  });

  test("requires_evidence_ref var asserted with an empty evidence_ref → REJECTED", () => {
    const [pid, runId] = plainProjectWithRun();
    expect(() =>
      assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: false }, evidence_ref: "  ", asserted_by: U1, rationale: "r", now: NOW }),
    ).toThrow(/requires an evidence_ref.*unsupported claim/s);
  });

  test("unknown var_key → REJECTED (only registered variables are assertable)", () => {
    const [pid, runId] = plainProjectWithRun();
    expect(() =>
      assert({ project_id: pid, run_id: runId, var_key: "no.such.var", value: { kind: "text", value: "x" }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW }),
    ).toThrow(/not in the evidence registry/);
  });

  test("empty rationale → REJECTED", () => {
    const [pid, runId] = plainProjectWithRun();
    expect(() =>
      assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "", now: NOW }),
    ).toThrow(/rationale is mandatory/);
  });

  test("num/text coherence against freshly registered vars; unit snapshots from the registry", () => {
    const [pid, runId] = plainProjectWithRun();
    db.run("INSERT INTO evidence_var (var_key, label_ko, value_type, unit, source_kind, requires_evidence_ref, created_at) VALUES (?,?,?,?,?,?,?)", [
      "t.hhi_after", "심사 후 HHI", "number", "ratio", "asserted", 0, NOW,
    ]);
    db.run("INSERT INTO evidence_var (var_key, label_ko, value_type, source_kind, requires_evidence_ref, created_at) VALUES (?,?,?,?,?,?)", [
      "t.entry_barrier_grade", "진입장벽 등급", "string", "asserted", 0, NOW,
    ]);

    const num = assert({ project_id: pid, run_id: runId, var_key: "t.hhi_after", value: { kind: "num", value: 2450 }, evidence_ref: "market-study.pdf#p4", asserted_by: U1, rationale: "post-combination HHI", now: NOW });
    expect(num.value_num).toBe(2450);
    expect(num.value_text).toBeNull();
    expect(num.unit).toBe("ratio"); // registry unit snapshotted at assertion time

    const text = assert({ project_id: pid, run_id: runId, var_key: "t.entry_barrier_grade", value: { kind: "text", value: "high" }, evidence_ref: "expert-interview-3", asserted_by: U1, rationale: "three incumbents hold patents", now: NOW });
    expect(text.value_text).toBe("high");

    expect(() =>
      assert({ project_id: pid, run_id: runId, var_key: "t.entry_barrier_grade", value: { kind: "num", value: 3 }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW }),
    ).toThrow(/incoherent with the registry.*string.*'text'/s);
  });
});

describe("assert(): evidence_ref citation vocabulary (v1.1, ADR-0058 §2)", () => {
  test("each vocabulary shape is ACCEPTED for a requires_evidence_ref=1 var", () => {
    const [pid, runId] = plainProjectWithRun();
    // three distinct runs so each assert has its own snapshot scope — vars are
    // (project, var) live-slot keyed, and re-asserting supersedes; distinct
    // var keys would need registry rows, so reuse runs of the same project.
    for (const ref of ["doc:cim-2026-08-01", "src:KIS-2025", "https://example.com/cim#p12"]) {
      const row = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: ref, asserted_by: U1, rationale: "vocabulary member", now: NOW });
      expect(row.evidence_ref).toBe(ref);
    }
  });

  test("free-text citations → REJECTED for a requires_evidence_ref=1 var (the shapes v1.1 retires)", () => {
    const [pid, runId] = plainProjectWithRun();
    for (const ref of ["cim.pdf#p12", "expert-interview-3", "x", "doc:", "src:", "https://", "http://example.com/cim", "doc:a b", "src:KIS 2025"]) {
      expect(() =>
        assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: ref, asserted_by: U1, rationale: "r", now: NOW }),
      ).toThrow(/not in the citation vocabulary.*ADR-0058/s);
    }
  });

  test("requires_evidence_ref=0 vars keep format-free refs (enforcement is scoped to flagged vars)", () => {
    const [pid, runId] = plainProjectWithRun();
    db.run("INSERT INTO evidence_var (var_key, label_ko, value_type, source_kind, requires_evidence_ref, created_at) VALUES (?,?,?,?,?,?)", [
      "t.freeform_note", "자유 인용 허용 변수", "string", "asserted", 0, NOW,
    ]);
    const row = assert({ project_id: pid, run_id: runId, var_key: "t.freeform_note", value: { kind: "text", value: "note" }, evidence_ref: "cim.pdf#p12", asserted_by: U1, rationale: "unflagged vars are out of v1.1 scope", now: NOW });
    expect(row.evidence_ref).toBe("cim.pdf#p12");
  });
});

describe("assert(): run scoping", () => {
  test("phantom run → REJECTED", () => {
    const [pid] = plainProjectWithRun();
    expect(() =>
      assert({ project_id: pid, run_id: "01NOSUCHRUN000000002", var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW }),
    ).toThrow(/run.*does not exist.*run-scoped/s);
  });

  test("another project's run → REJECTED", () => {
    const [pid] = plainProjectWithRun();
    const [otherPid, otherRun] = plainProjectWithRun();
    expect(() =>
      assert({ project_id: pid, run_id: otherRun, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW }),
    ).toThrow(/belongs to project.*not/s);
    expect(otherPid).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Constraint 6 — membership + MNPI on the asserter
// ---------------------------------------------------------------------------

describe("assert(): membership + MNPI", () => {
  test("non-member asserter → REJECTED", () => {
    const [pid, runId] = plainProjectWithRun();
    expect(() =>
      assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U3, rationale: "r", now: NOW }),
    ).toThrow(new RegExp(`'${U3}' is not an active project_member`));
  });

  test("MNPI project, member not on the insider list → REJECTED; enrolled → ACCEPTED", () => {
    const pid = insertProject(true);
    grantMember(pid, U1);
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [runId, pid, `hash-${runId.slice(-6)}`, U1, NOW]);
    expect(() =>
      assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW }),
    ).toThrow(/MNPI project.*not on its active insider list/);
    enrollInsider(pid, U1);
    expect(
      assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW }).value_text,
    ).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Live-row semantics — supersede within the same transaction
// ---------------------------------------------------------------------------

describe("live-row semantics", () => {
  test("a second assertion for the same (project, var) supersedes the live row in the SAME transaction and resets the review state", () => {
    const [pid, runId] = plainProjectWithRun();
    const first = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:a-1", asserted_by: U1, rationale: "first read", now: NOW });
    review({ input_id: first.id, reviewed_by: U2, now: NOW }); // reviewed → would drive routing

    const second = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: false }, evidence_ref: "doc:a-2", asserted_by: U1, rationale: "corrected after re-reading the CIM", now: NOW });
    expect(second.superseded_by).toBeNull();
    expect(second.reviewed_by).toBeNull(); // re-assertion RESETS review — routing drops the var until re-reviewed
    expect((db.query("SELECT superseded_by FROM dimension_input WHERE id = ?").get(first.id) as { superseded_by: string }).superseded_by).toBe(second.id);
    expect(getLiveAssertion(pid, SEEDED_BOOL_VAR)?.id).toBe(second.id);
    expect(getAssertionHistory(pid, SEEDED_BOOL_VAR)).toHaveLength(2); // history intact
  });

  test("reversing the supersede statement order trips the partial unique live index (raw SQL proof)", () => {
    const [pid, runId] = plainProjectWithRun();
    const first = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:a-1", asserted_by: U1, rationale: "first", now: NOW });
    const second = ulid();
    db.run(
      "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, evidence_ref, asserted_by, rationale, observed_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [second, runId, pid, SEEDED_BOOL_VAR, "bool", "false", "a#2", U1, "successor born non-live", NOW, first.id],
    );
    expect(() => db.run("UPDATE dimension_input SET superseded_by = NULL WHERE id = ?", [second])).toThrow(/UNIQUE constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// Constraint 8 — review(): the separate, later, different-person act
// ---------------------------------------------------------------------------

describe("review()", () => {
  test("review by the asserter themselves → REJECTED", () => {
    const [pid, runId] = plainProjectWithRun();
    const row = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW });
    expect(() => review({ input_id: row.id, reviewed_by: U1, now: NOW })).toThrow(
      /reviewed_by must differ from asserted_by.*cross-domain second review/s,
    );
  });

  test("review by a non-member → REJECTED", () => {
    const [pid, runId] = plainProjectWithRun();
    const row = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW });
    expect(() => review({ input_id: row.id, reviewed_by: U3, now: NOW })).toThrow(new RegExp(`'${U3}' is not an active project_member`));
  });

  test("cross-domain review by a different member → ACCEPTED; the row then reads live+reviewed (routing-grade)", () => {
    const [pid, runId] = plainProjectWithRun();
    const row = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW });
    const reviewed = review({ input_id: row.id, reviewed_by: U2, now: NOW });
    expect(reviewed.reviewed_by).toBe(U2);
    const live = getLiveAssertion(pid, SEEDED_BOOL_VAR)!;
    expect(live.reviewed_by).toBe(U2);
  });

  test("second review of an already-reviewed assertion → REJECTED", () => {
    const [pid, runId] = plainProjectWithRun();
    const row = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW });
    review({ input_id: row.id, reviewed_by: U2, now: NOW });
    expect(() => review({ input_id: row.id, reviewed_by: U2, now: NOW })).toThrow(/already reviewed/);
  });

  test("reviewing a superseded (history) row → REJECTED", () => {
    const [pid, runId] = plainProjectWithRun();
    const first = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW });
    assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: false }, evidence_ref: "doc:y", asserted_by: U1, rationale: "r2", now: NOW });
    expect(() => review({ input_id: first.id, reviewed_by: U2, now: NOW })).toThrow(/superseded \(history\)/);
  });

  test("MNPI project: reviewer must be on the insider list too", () => {
    const pid = insertProject(true);
    grantMember(pid, U1);
    grantMember(pid, U2);
    enrollInsider(pid, U1); // asserter yes, reviewer no
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [runId, pid, `hash-${runId.slice(-6)}`, U1, NOW]);
    const row = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW });
    expect(() => review({ input_id: row.id, reviewed_by: U2, now: NOW })).toThrow(/MNPI project.*not on its active insider list/);
  });
});

// ---------------------------------------------------------------------------
// Constraint 6(b) — write logging on every mutation
// ---------------------------------------------------------------------------

describe("write logging", () => {
  test("assert and review each log a write; a rejected assert logs nothing", () => {
    const [pid, runId] = plainProjectWithRun();
    const before = writeLogCount(pid);
    const row = assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "bool", value: true }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW });
    expect(writeLogCount(pid)).toBe(before + 1);
    review({ input_id: row.id, reviewed_by: U2, now: NOW });
    expect(writeLogCount(pid)).toBe(before + 2);
    expect(() =>
      assert({ project_id: pid, run_id: runId, var_key: SEEDED_BOOL_VAR, value: { kind: "num", value: 1 }, evidence_ref: "doc:x", asserted_by: U1, rationale: "r", now: NOW }),
    ).toThrow();
    expect(writeLogCount(pid)).toBe(before + 2);
  });
});
