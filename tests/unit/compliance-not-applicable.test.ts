// @version 1.0.0
/**
 * Unit tests for the not_applicable writer + invalidation sweep (PR-5c spec
 * §3 rows 3, 4, 6, 7; ADR-0048 §2-§3/§5) — db/repositories/compliance.repository.ts
 * recordNotApplicable/invalidateNotApplicable, wired through the REAL
 * classification.repository supersede() (the same-transaction sweep), and the
 * skip-cell completeness math they produce in db/lib/validator-completeness.ts.
 *
 * The skip-legitimate cell is greenfield/internal/track=none (registry: five
 * not-applicable, certification always applies) — classifications are written
 * through the repository's classify()/supersede() so the approver trio exists
 * exactly when Decision 5a demands it, the same path production takes.
 *
 * Real scratch SQLite (migration-0013 test pattern) so the 0013/0016
 * constraints and the partial live indexes are exercised by SQLite itself.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  evaluateValidatorCompleteness,
  SIX_VALIDATOR_GATE,
} from "../../db/lib/validator-completeness.ts";
import {
  classify,
  supersede,
  getLiveClassification,
} from "../../db/repositories/classification.repository.ts";
import { recordNotApplicable } from "../../db/repositories/compliance.repository.ts";

const TEST_DB_PATH = "db/data/test-compliance-not-applicable.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;

const U1 = "user-001"; // classified_by / recorded_by — member everywhere
const U2 = "user-002"; // approver — member everywhere, distinct from U1
const U3 = "user-003"; // member nowhere

const TRIO = {
  approver_role: "process-governance-manager",
  approved_by: U2,
  approved_at: NOW,
};

const LONG_RATIONALE =
  "Pure internal venture spun out of the R&BD organization — no external market presence, no acquired workforce, no acquired contracts; classification reviewed against the partner-sourcing memo and the carve-out boundary analysis.";

function insertUser(userId: string): void {
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), userId, "analyst", "active", "salt", "hash", 1, NOW],
  );
}

function insertProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  for (const user of [U1, U2]) {
    db.run(
      "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
      [id, user, "member", "admin", NOW, "test fixture basis"],
    );
  }
  return id;
}

/** A skip-legitimate classification through the REAL repository path (trio included). */
function classifyGreenfieldInternal(pid: string, rationale = LONG_RATIONALE): void {
  classify(
    { project_id: pid, case_type: "greenfield", origin: "internal", classified_by: U1, rationale, approval: TRIO, now: NOW },
    db,
  );
}

/** A raw greenfield/internal row WITHOUT the approver trio (the weak-provenance shape). */
function classifyRawNoTrio(pid: string): void {
  db.run(
    "INSERT INTO project_case_classification (id, project_id, case_type, origin, technology_track, classified_by, classified_at, rationale) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), pid, "greenfield", "internal", "none", U1, NOW, "internal venture"],
  );
}

function writePassRow(pid: string, key: string): string {
  const id = ulid();
  db.run(
    "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, detected_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, pid, SIX_VALIDATOR_GATE, `ma-validator-${key}`, "procedure", "pass", `${key} pass`, NOW],
  );
  return id;
}

/** The five registry-skip validators under greenfield/internal/none. */
const SKIPPABLE = ["antitrust", "hr-comp", "customer", "incentive", "contingent-liability"] as const;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  for (const u of [U1, U2, U3]) insertUser(u);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// Spec §3 row 3 — a skipped validator is recorded not_applicable, NEVER pass,
// with the rendered sentence + classification id + approver trace
// ---------------------------------------------------------------------------

describe("recordNotApplicable — the skip row and its detail contract", () => {
  test("greenfield/internal (full trio): skip row is not_applicable with ko+en reason, classification id, classified_by AND approver trace", () => {
    const pid = insertProject();
    classifyGreenfieldInternal(pid);
    const classification = getLiveClassification(pid, db)!;
    expect(classification.origin).toBe("internal");

    const row = recordNotApplicable({ validator_key: "antitrust", project_id: pid, recorded_by: U1, now: NOW }, db);

    expect(row.result).toBe("not_applicable");
    expect(row.rule_key).toBe("ma-validator-antitrust");
    expect(row.gate).toBe(SIX_VALIDATOR_GATE);
    expect(row.detail).toContain("not_applicable: antitrust (shared-brownfield-dd step 6)");
    expect(row.detail).toContain("reason (renderKo):");
    expect(row.detail).toContain("reason (english mirror):");
    expect(row.detail).toContain(`classification: ${classification.id}`);
    expect(row.detail).toContain(`classified_by: ${U1}`);
    expect(row.detail).toContain("approver_role: process-governance-manager");
    expect(row.detail).toContain(`approved_by: ${U2}`);

    const persisted = db
      .query("SELECT result FROM compliance_check WHERE id = ?")
      .get(row.id) as { result: string };
    expect(persisted.result).toBe("not_applicable"); // never 'pass' — the audit trail states the truth
  });

  test("certification can NEVER be skipped — applies in every cell", () => {
    const pid = insertProject();
    classifyGreenfieldInternal(pid);
    expect(() => recordNotApplicable({ validator_key: "certification", project_id: pid, recorded_by: U1, now: NOW }, db)).toThrow(
      /is APPLICABLE under the live classification/,
    );
  });
});

// ---------------------------------------------------------------------------
// Spec §3 row 4 — a skip row without its full justification is REJECTED
// ---------------------------------------------------------------------------

describe("recordNotApplicable — rejections (all before the transaction opens)", () => {
  test("unknown validator key", () => {
    const pid = insertProject();
    classifyGreenfieldInternal(pid);
    expect(() =>
      recordNotApplicable({ validator_key: "synergy" as never, project_id: pid, recorded_by: U1, now: NOW }, db),
    ).toThrow(/not one of the six M&A validators/);
  });

  test("no live classification row — nothing justifies a skip (fail-closed)", () => {
    const pid = insertProject();
    expect(() => recordNotApplicable({ validator_key: "antitrust", project_id: pid, recorded_by: U1, now: NOW }, db)).toThrow(
      /no live classification row/,
    );
  });

  test("registry says APPLICABLE (typical M&A cell) — a skip is unwritable there", () => {
    const pid = insertProject();
    classify(
      { project_id: pid, case_type: "brownfield", origin: "external", classified_by: U1, rationale: LONG_RATIONALE, now: NOW },
      db,
    );
    expect(() => recordNotApplicable({ validator_key: "antitrust", project_id: pid, recorded_by: U1, now: NOW }, db)).toThrow(
      /is APPLICABLE under the live classification/,
    );
  });

  test("reducing origin WITHOUT its approver trace — a skip cheaper than its waiver is refused", () => {
    const pid = insertProject();
    classifyRawNoTrio(pid);
    expect(() => recordNotApplicable({ validator_key: "antitrust", project_id: pid, recorded_by: U1, now: NOW }, db)).toThrow(
      /lacks its approver trace/,
    );
  });

  test("a live skip row already exists for the validator — skips never stack", () => {
    const pid = insertProject();
    classifyGreenfieldInternal(pid);
    recordNotApplicable({ validator_key: "antitrust", project_id: pid, recorded_by: U1, now: NOW }, db);
    expect(() => recordNotApplicable({ validator_key: "antitrust", project_id: pid, recorded_by: U1, now: NOW }, db)).toThrow(
      /already exists/,
    );
  });

  test("non-member recorder → REJECTED (FR-SEC-08)", () => {
    const pid = insertProject();
    classifyGreenfieldInternal(pid);
    expect(() => recordNotApplicable({ validator_key: "antitrust", project_id: pid, recorded_by: U3, now: NOW }, db)).toThrow(
      /not an active project_member/,
    );
  });
});

// ---------------------------------------------------------------------------
// Spec §3 rows 6-7 — the 3-number math with skips, and reclassification
// invalidation: a skip never outlives its classification
// ---------------------------------------------------------------------------

describe("skip-cell completeness math (greenfield/internal/none)", () => {
  test("no rows at all: 6 declared / 1 applicable / 0 completed — the ONE applicable missing validator halts; the five absent skips are undocumented, never halting", () => {
    const pid = insertProject();
    classifyGreenfieldInternal(pid);

    const ev = evaluateValidatorCompleteness(pid, null, db, { now: new Date(NOW) });
    expect(ev.declared).toBe(6);
    expect(ev.applicable_count).toBe(1);
    expect(ev.completed_count).toBe(0);
    expect(ev.halt.triggered).toBe(true);
    expect(ev.halt.missing).toEqual(["certification"]);
    expect(ev.halt.kill_criterion).toBe("any_of_six_ma_validators_missing_at_dd_exit");
    expect([...ev.undocumented_skips].sort()).toEqual([...SKIPPABLE].sort());
  });

  test("all five skips recorded + certification pass → 6/1/6: skips are covered-with-reason, halt NOT triggered", () => {
    const pid = insertProject();
    classifyGreenfieldInternal(pid);
    for (const key of SKIPPABLE) {
      recordNotApplicable({ validator_key: key, project_id: pid, recorded_by: U1, now: NOW }, db);
    }
    writePassRow(pid, "certification");

    const ev = evaluateValidatorCompleteness(pid, null, db, { now: new Date(NOW) });
    expect(ev.applicable_count).toBe(1);
    expect(ev.completed_count).toBe(6); // five covered-with-reason + one completed
    expect(ev.halt.triggered).toBe(false);
    expect(ev.undocumented_skips).toEqual([]);
    const certRow = ev.validators.find((v) => v.key === "certification")!;
    expect(certRow.status).toBe("completed");
    expect(certRow.applies).toBe(true);
    for (const key of SKIPPABLE) {
      const row = ev.validators.find((v) => v.key === key)!;
      expect(row.status).toBe("not_applicable");
      expect(row.rendered_reason_ko).toBeTruthy();
    }
  });

  test("an absent skip row does not halt but stays honestly undocumented until written", () => {
    const pid = insertProject();
    classifyGreenfieldInternal(pid);
    for (const key of ["antitrust", "hr-comp", "customer"] as const) {
      recordNotApplicable({ validator_key: key, project_id: pid, recorded_by: U1, now: NOW }, db);
    }
    writePassRow(pid, "certification");

    const ev = evaluateValidatorCompleteness(pid, null, db, { now: new Date(NOW) });
    expect(ev.halt.triggered).toBe(false); // the one applicable validator is covered
    expect(ev.completed_count).toBe(4);
    expect(ev.undocumented_skips.sort()).toEqual(["contingent-liability", "incentive"]);
  });
});

describe("reclassification invalidation (spec row 7) — via the REAL supersede()", () => {
  test("supersede greenfield/internal → brownfield/external: the same transaction invalidates every live skip; M drops 6→1 and the five validators re-enter the required set", () => {
    const pid = insertProject();
    classifyGreenfieldInternal(pid);
    for (const key of SKIPPABLE) {
      recordNotApplicable({ validator_key: key, project_id: pid, recorded_by: U1, now: NOW }, db);
    }
    writePassRow(pid, "certification");

    const before = evaluateValidatorCompleteness(pid, null, db, { now: new Date(NOW) });
    expect(before.halt.triggered).toBe(false);
    expect(before.completed_count).toBe(6);

    const successor = supersede(
      { project_id: pid, case_type: "brownfield", origin: "external", classified_by: U1, rationale: LONG_RATIONALE, now: NOW },
      db,
    );

    // every skip row is stamped with the superseding classification, never deleted
    const invalidated = db
      .query(
        "SELECT invalidated_at, invalidated_by_classification FROM compliance_check WHERE project_id = ? AND result = 'not_applicable' AND invalidated_at IS NOT NULL",
      )
      .all(pid) as { invalidated_at: string; invalidated_by_classification: string }[];
    expect(invalidated).toHaveLength(5);
    for (const row of invalidated) {
      expect(row.invalidated_at).toBe(NOW);
      expect(row.invalidated_by_classification).toBe(successor.id);
    }
    expect(db.query("SELECT COUNT(*) AS c FROM compliance_check WHERE project_id = ? AND result = 'not_applicable'").get(pid)).toEqual({ c: 5 });

    // the invalidated skips are NO coverage: all six applicable, five missing, halt fires
    const after = evaluateValidatorCompleteness(pid, null, db, { now: new Date(NOW) });
    expect(after.applicable_count).toBe(6);
    expect(after.completed_count).toBe(1); // only the certification pass row survives as coverage
    expect(after.halt.triggered).toBe(true);
    expect(after.halt.missing.sort()).toEqual([...SKIPPABLE].sort());

    // and a NEW skip is unwritable under the external classification (registry applies)
    expect(() => recordNotApplicable({ validator_key: "antitrust", project_id: pid, recorded_by: U1, now: NOW }, db)).toThrow(
      /is APPLICABLE under the live classification/,
    );
  });
});
