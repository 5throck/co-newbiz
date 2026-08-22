// @version 1.1.0
/**
 * Unit tests for db/lib/validator-completeness.ts + the persist path in
 * db/repositories/compliance.repository.ts (PR-5c §2.2-§2.3) — the 3-number
 * record, the halt semantics (kill criterion surfaced, never a written
 * row), coverage counting, and the fail-closed corruption scenarios
 * (spec §3.2 / §3.5 / §3.6).
 *
 * STAGE 2 FORM (spec §5): the registry is ACTIVE (ADR-0048 vectors). These
 * tests classify every project brownfield/external — the all-six cell — so
 * they pin the ADR-0037 behavior for the typical M&A case: every missing
 * validator is applicable-missing and halts. The not_applicable-counts-as-
 * covered and skip-cell math live in compliance-not-applicable.test.ts,
 * where the registry legitimately says not-applicable (greenfield+internal).
 *
 * Real scratch SQLite (migration-0013 test pattern) so the 0013/0016
 * constraints and the partial live index are exercised by SQLite itself.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  evaluateValidatorCompleteness,
  SIX_VALIDATOR_GATE,
  SIX_VALIDATOR_HALT_CRITERION,
  detailField,
} from "../../db/lib/validator-completeness.ts";
import { resolveValidatorApplicability } from "../../db/lib/validator-applicability.ts";
import { persistCompletenessRecord } from "../../db/repositories/compliance.repository.ts";

const TEST_DB_PATH = "db/data/test-validator-completeness.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const FIXED_NOW = new Date(NOW);

type Db = ReturnType<typeof GetDb>;
let db: Db;

const U1 = "user-001"; // member everywhere
const U3 = "user-003"; // member nowhere

function insertUser(userId: string): void {
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), userId, "analyst", "active", "salt", "hash", 1, NOW],
  );
}

function insertProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [id, U1, "contributor", "admin", NOW, "test fixture basis"],
  );
  return id;
}

function insertRun(pid: string): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [id, pid, `hash-${id.slice(-6)}`, U1, NOW]);
  return id;
}

function classifyRaw(pid: string, origin: string, caseType = "brownfield", track = "none"): void {
  db.run(
    "INSERT INTO project_case_classification (id, project_id, case_type, origin, technology_track, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), pid, caseType, origin, track, U1, NOW, `test classification — origin ${origin}`],
  );
}

/** Write one coverage row for a validator, defaulting to the common shape. */
function writeValidatorRow(
  pid: string,
  key: string,
  result: "pass" | "blocked" | "reason_required" | "waived" | "not_applicable",
  opts: { detected_at?: string; detail?: string; invalidated_at?: string | null } = {}
): string {
  const id = ulid();
  db.run(
    "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, detected_at, invalidated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, pid, SIX_VALIDATOR_GATE, `ma-validator-${key}`, "procedure", result, opts.detail ?? `${key} ${result}`, opts.detected_at ?? NOW, opts.invalidated_at ?? null],
  );
  return id;
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  insertUser(U1);
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
// Spec §3.5 — an applicable validator missing → the halt condition fires
// ---------------------------------------------------------------------------

describe("halt semantics (kill-criterion path)", () => {
  test("no coverage rows at all → 6/6/0, halt triggered, all six missing, surfaced as the kill criterion — and the engine writes NO compliance row", () => {
    const pid = insertProject();
    classifyRaw(pid, "external");
    const before = (db.query("SELECT COUNT(*) AS c FROM compliance_check").get() as { c: number }).c;
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(ev.declared).toBe(6);
    expect(ev.applicable_count).toBe(6);
    expect(ev.completed_count).toBe(0);
    expect(ev.halt).toEqual({
      triggered: true,
      kill_criterion: SIX_VALIDATOR_HALT_CRITERION,
      missing: ["antitrust", "hr-comp", "customer", "incentive", "contingent-liability", "certification"],
    });
    expect(ev.validators.every((v) => v.status === "missing")).toBe(true);
    // the halt is a surfaced trigger, never a row (spec §2.3)
    const after = (db.query("SELECT COUNT(*) AS c FROM compliance_check").get() as { c: number }).c;
    expect(after).toBe(before);
  });

  test("two of six covered → 6/6/2, halt fires for exactly the four missing", () => {
    const pid = insertProject();
    classifyRaw(pid, "external");
    writeValidatorRow(pid, "antitrust", "pass");
    writeValidatorRow(pid, "certification", "blocked");
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect([ev.applicable_count, ev.completed_count]).toEqual([6, 2]);
    expect(ev.halt.triggered).toBe(true);
    expect(ev.halt.missing).toEqual(["hr-comp", "customer", "incentive", "contingent-liability"]);
  });

  test("all six covered → 6/6/6, halt NOT triggered", () => {
    const pid = insertProject();
    classifyRaw(pid, "external");
    for (const key of ["antitrust", "hr-comp", "customer", "incentive", "contingent-liability", "certification"]) {
      writeValidatorRow(pid, key, "pass");
    }
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect([ev.applicable_count, ev.completed_count]).toEqual([6, 6]);
    expect(ev.halt.triggered).toBe(false);
    expect(ev.halt.missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Spec §3.6 (stage-1 half) — coverage counting across the four run-results
// ---------------------------------------------------------------------------

describe("3-number math", () => {
  test("pass, blocked, reason_required, and waived rows ALL count as completed (constraint 2's list)", () => {
    const pid = insertProject();
    classifyRaw(pid, "external");
    writeValidatorRow(pid, "antitrust", "pass");
    writeValidatorRow(pid, "hr-comp", "blocked");
    writeValidatorRow(pid, "customer", "reason_required");
    writeValidatorRow(pid, "incentive", "waived");
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(ev.completed_count).toBe(4);
    expect(ev.validators.filter((v) => v.status === "completed").map((v) => v.key)).toEqual([
      "antitrust", "hr-comp", "customer", "incentive",
    ]);
  });

  test("the NEWEST row per rule key decides coverage (later row shadows the earlier)", () => {
    const pid = insertProject();
    classifyRaw(pid, "external");
    writeValidatorRow(pid, "antitrust", "pass", { detected_at: "2026-08-20T00:00:00Z" });
    writeValidatorRow(pid, "antitrust", "blocked", { detected_at: "2026-08-22T00:00:00Z" });
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    const antitrust = ev.validators.find((v) => v.key === "antitrust")!;
    expect(antitrust.status).toBe("completed"); // newest (blocked) still counts as ran
    expect(antitrust.compliance_check_id).not.toBeNull();
  });

  test("an invalidated not_applicable row is NO coverage while the registry says applicable (brownfield/external: no skip is justifiable under this classification)", () => {
    const pid = insertProject();
    classifyRaw(pid, "external");
    writeValidatorRow(pid, "hr-comp", "not_applicable", { detail: "classification: whatever\nskipped", invalidated_at: NOW });
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    const hrComp = ev.validators.find((v) => v.key === "hr-comp")!;
    expect(hrComp.status).toBe("missing"); // invalidated skip + applicable validator = missing
    expect(ev.halt.missing).toContain("hr-comp");
  });

  test("record header carries the live classification row; evaluated_at is injectable", () => {
    const pid = insertProject();
    classifyRaw(pid, "external");
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(ev.classification).toMatchObject({ case_type: "brownfield", origin: "external", technology_track: "none" });
    expect(ev.classification!.id).toBeTruthy();
    expect(ev.evaluated_at).toBe(NOW);
    expect(ev.gate).toBe("dd");
  });

  test("detailField reads the repository detail contract", () => {
    const detail = "not_applicable: hr-comp\n사유: 테스트\nclassification: 01ABC\nclassified_by: user-001";
    expect(detailField(detail, "classification")).toBe("01ABC");
    expect(detailField(detail, "classified_by")).toBe("user-001");
    expect(detailField(detail, "absent")).toBeNull();
    expect(detailField(null, "classification")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Spec §3.2 — corrupt-classification scenarios: fail-closed, no throw
// ---------------------------------------------------------------------------

describe("corrupt classification → ALL SIX applicable (fail-closed), engine never throws", () => {
  function corruptRow(pid: string, origin: string): void {
    // origin's enum is CHECK-constrained (0013); a corrupt row can only exist
    // if the constraint layer itself was bypassed — simulate exactly that (an
    // operator with sqlite3 and PRAGMA ignore_check_constraints), which is the
    // scenario the fail-closed default must survive. (A NULL origin is
    // unreachable at the row level: NOT NULL is enforced independently of
    // ignore_check_constraints — that scenario is pinned at the routing
    // boundary in the test below.)
    db.run("PRAGMA ignore_check_constraints = ON");
    db.run(
      "INSERT INTO project_case_classification (id, project_id, case_type, origin, technology_track, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), pid, "brownfield", origin, "none", U1, NOW, "corrupt row — constraint-bypass simulation"],
    );
    db.run("PRAGMA ignore_check_constraints = OFF");
  }

  test("no live classification row → all six applicable", () => {
    const pid = insertProject();
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(ev.classification).toBeNull();
    expect(ev.applicable_count).toBe(6);
    // The five skip-capable rows resolve fail-closed on unassessed routing
    // vars; certification's unconditional (at_least 0) predicate is
    // predicate-TRUE even with every routing var missing. Both roads lead
    // to applies — the ADR-0037 default survives the unclassified state.
    const byBasis = new Map(ev.validators.map((v) => [v.key, v.basis]));
    expect([...byBasis.values()].every((b) => b === "unassessed-fail-closed" || b === "predicate-true")).toBe(true);
    expect(byBasis.get("certification")).toBe("predicate-true");
    expect(byBasis.get("antitrust")).toBe("unassessed-fail-closed");
    expect(byBasis.get("contingent-liability")).toBe("unassessed-fail-closed");
  });

  test("present-but-NULL origin (routing boundary) → all six applicable, no throw", () => {
    // 0013 declares origin NOT NULL, so the row-level state cannot exist even
    // under constraint bypass. What WOULD flow through resolveRoutingVars is a
    // present snapshot with a null payload — pinned here directly: evalCmp
    // treats present-but-null as UNASSESSED, which the registry resolves
    // fail-closed to APPLIES.
    const snapshots: Record<string, { status: "present"; value: string | null }> = {
      "project.case_type": { status: "present", value: "brownfield" },
      "project.origin": { status: "present", value: null },
      "project.technology_track": { status: "present", value: "none" },
    };
    const decisions = resolveValidatorApplicability((k) => snapshots[k], { now: FIXED_NOW });
    expect([...decisions.values()].every((d) => d.applies)).toBe(true);
  });

  test("unknown enum origin value → all six applicable, no throw", () => {
    const pid = insertProject();
    corruptRow(pid, "purple");
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(ev.classification?.origin).toBe("purple");
    expect(ev.applicable_count).toBe(6);
    expect(ev.validators.every((v) => v.applies)).toBe(true);
    expect(ev.halt.missing).toHaveLength(6); // still a halt: nothing has run
  });
});

// ---------------------------------------------------------------------------
// The durable record — persistCompletenessRecord (spec §2.2)
// ---------------------------------------------------------------------------

describe("persistCompletenessRecord", () => {
  test("happy path: one validator_completeness_record row, 3 numbers + per-validator json + write log + audit", () => {
    const pid = insertProject();
    classifyRaw(pid, "external");
    writeValidatorRow(pid, "antitrust", "pass");
    const ev = evaluateValidatorCompleteness(pid, insertRun(pid), db, { now: FIXED_NOW });
    const record = persistCompletenessRecord({ evaluation: ev, recorded_by: U1, now: NOW });
    expect(record).toMatchObject({ project_id: pid, gate: "dd", declared: 6, applicable_count: 6, completed_count: 1 });
    expect(record.run_id).toBeTruthy();
    const stored = db.query("SELECT validator_rows, created_at FROM validator_completeness_record WHERE id = ?").get(record.id) as { validator_rows: string; created_at: string };
    const parsed = JSON.parse(stored.validator_rows) as { key: string; status: string; compliance_check_id: string | null }[];
    expect(parsed).toHaveLength(6);
    expect(parsed.find((r) => r.key === "antitrust")).toMatchObject({ status: "completed" });
    expect(parsed.find((r) => r.key === "certification")).toMatchObject({ status: "missing", compliance_check_id: null });
    expect(stored.created_at).toBe(NOW);
    const logCount = (db.query("SELECT COUNT(*) AS c FROM data_access_log WHERE table_key = 'validator_completeness_record' AND project_id = ?").get(pid) as { c: number }).c;
    expect(logCount).toBe(1);
    const audits = db.query("SELECT action, target FROM audit_log WHERE action = 'completeness_record_written' AND target LIKE ?").all(`${pid}:%`) as { action: string; target: string }[];
    expect(audits[0].target).toContain(":HALT"); // halt state is visible in the audit trail
  });

  test("an incoherent evaluation (counts disagree with rows) → REJECTED", () => {
    const pid = insertProject();
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(() =>
      persistCompletenessRecord({ evaluation: { ...ev, completed_count: 3 }, recorded_by: U1, now: NOW }),
    ).toThrow(/counts disagree with the per-validator rows/);
  });

  test("a non-six evaluation → REJECTED", () => {
    const pid = insertProject();
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(() =>
      persistCompletenessRecord({ evaluation: { ...ev, declared: 5 as 6, validators: ev.validators.slice(0, 5) }, recorded_by: U1, now: NOW }),
    ).toThrow(/the six-validator record is 6 declared/);
    const dupe = { ...ev, validators: [...ev.validators.slice(0, 5), ev.validators[0]] };
    expect(() => persistCompletenessRecord({ evaluation: dupe, recorded_by: U1, now: NOW })).toThrow(/duplicate or missing validator keys/);
  });

  test("non-member recorder → REJECTED (FR-SEC-08)", () => {
    const pid = insertProject();
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(() => persistCompletenessRecord({ evaluation: ev, recorded_by: U3, now: NOW })).toThrow(
      new RegExp(`'${U3}' is not an active project_member`),
    );
  });
});
