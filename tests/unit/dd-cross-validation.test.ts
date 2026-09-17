// @version 1.0.0
/**
 * Unit tests for db/lib/dd-cross-validation.ts (PR-5c spec §3 rows 8-9;
 * design Decisions 5f/5g, ADR-0048) — the classification-INDEPENDENT primary
 * signals (certification CoC positions, antitrust_finding rows, legal-DD CoC
 * contract-scan findings), the Decision-5g conditional block on weak
 * provenance, the non-blocking correction path with re-run bookkeeping, and
 * the demoted origin-vs-rbd_source advisory that can never touch the verdict.
 *
 * Real scratch SQLite (migration-0013 test pattern).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  crossValidateClassification,
  RATIONALE_SUBSTANCE_FLOOR_CHARS,
} from "../../db/lib/dd-cross-validation.ts";
import { evaluateValidatorCompleteness } from "../../db/lib/validator-completeness.ts";
import { classify, supersede } from "../../db/repositories/classification.repository.ts";
import { recordNotApplicable } from "../../db/repositories/compliance.repository.ts";

const TEST_DB_PATH = "db/data/test-dd-cross-validation.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const FIXED_NOW = new Date(NOW);

type Db = ReturnType<typeof GetDb>;
let db: Db;

const U1 = "user-001"; // member everywhere
const U2 = "user-002"; // approver — member everywhere, distinct from U1
const U3 = "user-003"; // member nowhere

const TRIO = {
  approver_role: "process-governance-manager",
  approved_by: U2,
  approved_at: NOW,
};

const WEAK_RATIONALE = "internal venture"; // 17 chars — under the substance floor
const STRONG_RATIONALE =
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

function classifyInternal(pid: string, rationale: string): void {
  classify(
    { project_id: pid, case_type: "greenfield", origin: "internal", classified_by: U1, rationale, approval: TRIO, now: NOW },
    db,
  );
}

/** certification row carrying a change-of-control transferability position (0012 columns). */
function insertCertCoc(pid: string): void {
  db.run(
    "INSERT INTO certification (id, project_id, name, status, transferability_basis, transferable_on_coc) VALUES (?,?,?,?,?,?)",
    [ulid(), pid, "ISO 9001", "active", "verified", "no"],
  );
}

function insertAntitrustFinding(pid: string): void {
  db.run(
    "INSERT INTO antitrust_finding (id, project_id, market_definition, remedy_type, created_at) VALUES (?,?,?,?,?)",
    [ulid(), pid, "Hydrogen mobility refueling — Korea", "none", NOW],
  );
}

function insertDdFinding(pid: string, opts: { category: string; description: string; rbd_source?: string }): void {
  db.run(
    "INSERT INTO dd_finding (id, project_id, category, description, rbd_source, created_at) VALUES (?,?,?,?,?,?)",
    [ulid(), pid, opts.category, opts.description, opts.rbd_source ?? null, NOW],
  );
}

/** A live dimension_input row — the evidence_ref-bearing linkage that rescues a short rationale. */
function insertLiveDimensionInput(pid: string): void {
  const runId = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [runId, pid, `hash-${runId.slice(-6)}`, U1, NOW]);
  db.run(
    "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, evidence_ref, asserted_by, rationale, observed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [ulid(), runId, pid, "target.has_external_market_presence", "bool", "false", "doc://partner-sourcing-memo", U1, "carve-out competes only inside the parent group", NOW],
  );
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  for (const u of [U1, U2, U3]) insertUser(u);
}, 60000);

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

// ---------------------------------------------------------------------------
// Spec §3 row 8 — 5f primary signals + 5g conditional block
// ---------------------------------------------------------------------------

describe("Decision 5f primary signals (classification-independent)", () => {
  test("each of the three signal families is detected on its own", () => {
    const byKey: Record<string, string> = {
      certification_coc: "",
      antitrust_finding: "",
      legal_coc_scan: "",
    };

    const p1 = insertProject();
    classifyInternal(p1, STRONG_RATIONALE);
    insertCertCoc(p1);
    byKey.certification_coc = p1;

    const p2 = insertProject();
    classifyInternal(p2, STRONG_RATIONALE);
    insertAntitrustFinding(p2);
    byKey.antitrust_finding = p2;

    const p3 = insertProject();
    classifyInternal(p3, STRONG_RATIONALE);
    insertDdFinding(p3, { category: "legal", description: "Top-20 contract scan: change-of-control consent clause found in 6 contracts" });
    byKey.legal_coc_scan = p3;

    for (const [key, pid] of Object.entries(byKey)) {
      const report = crossValidateClassification(pid, U1, { now: FIXED_NOW, db });
      expect(report.primary.mismatched).toBe(true);
      expect(report.primary.contradicted_origin).toBe("internal");
      const signal = report.primary.signals.find((s) => s.key === key)!;
      expect(signal.row_count).toBe(1);
      expect(signal.evidence_ids).toHaveLength(1);
    }
  });

  test("a legal dd_finding that is NOT a CoC scan does not fire the signal (pattern discipline)", () => {
    const pid = insertProject();
    classifyInternal(pid, STRONG_RATIONALE);
    insertDdFinding(pid, { category: "legal", description: "Employment law review of the transfer regime" });
    const report = crossValidateClassification(pid, U1, { now: FIXED_NOW, db });
    expect(report.primary.signals.find((s) => s.key === "legal_coc_scan")!.row_count).toBe(0);
    expect(report.primary.mismatched).toBe(false);
    expect(report.verdict.severity).toBe("clear");
  });

  test("external origin cannot be contradicted — acquisition evidence is consistent with it", () => {
    const pid = insertProject();
    classify(
      { project_id: pid, case_type: "brownfield", origin: "external", classified_by: U1, rationale: STRONG_RATIONALE, now: NOW },
      db,
    );
    insertCertCoc(pid);
    insertAntitrustFinding(pid);
    const report = crossValidateClassification(pid, U1, { now: FIXED_NOW, db });
    expect(report.primary.mismatched).toBe(false);
    expect(report.verdict.severity).toBe("clear");
  });
});

describe("Decision 5g — conditional block on weak provenance", () => {
  test("internal origin + CoC evidence + WEAK provenance (short rationale, no evidence linkage) → BLOCKS", () => {
    const pid = insertProject();
    classifyInternal(pid, WEAK_RATIONALE);
    insertCertCoc(pid);

    const report = crossValidateClassification(pid, U1, { now: FIXED_NOW, db });
    expect(report.provenance!.weak).toBe(true);
    expect(report.provenance!.rationale_chars).toBeLessThan(RATIONALE_SUBSTANCE_FLOOR_CHARS);
    expect(report.provenance!.has_evidence_linkage).toBe(false);
    expect(report.verdict.blocked).toBe(true);
    expect(report.verdict.severity).toBe("block");
    expect(report.verdict.correction).toBeNull();
    expect(report.verdict.message_en).toContain("blocked until the project is reclassified");
  });

  test("short rationale RESCUED by live evidence linkage is not weak", () => {
    const pid = insertProject();
    classifyInternal(pid, WEAK_RATIONALE);
    insertLiveDimensionInput(pid);
    insertCertCoc(pid);

    const report = crossValidateClassification(pid, U1, { now: FIXED_NOW, db });
    expect(report.provenance!.has_evidence_linkage).toBe(true);
    expect(report.provenance!.weak).toBe(false);
    expect(report.verdict.severity).toBe("correction");
  });
});

describe("Decision 5g — non-blocking correction path with re-run bookkeeping", () => {
  test("strong provenance honestly overturned → correction object enumerates the live skips; completing the correction re-requires exactly those validators", () => {
    const pid = insertProject();
    classifyInternal(pid, STRONG_RATIONALE);
    // two live skips under the internal classification; the other four validators
    // ran and passed (so post-correction completeness isolates the re-run set)
    recordNotApplicable({ validator_key: "antitrust", project_id: pid, recorded_by: U1, now: NOW }, db);
    recordNotApplicable({ validator_key: "hr-comp", project_id: pid, recorded_by: U1, now: NOW }, db);
    for (const key of ["customer", "incentive", "contingent-liability", "certification"] as const) {
      db.run(
        "INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, detected_at) VALUES (?,?,?,?,?,?,?,?)",
        [ulid(), pid, "DD", `ma-validator-${key}`, "procedure", "pass", `${key} pass`, NOW],
      );
    }
    insertCertCoc(pid); // DD evidence contradicts the internal story

    const report = crossValidateClassification(pid, U1, { now: FIXED_NOW, db });
    expect(report.verdict.blocked).toBe(false);
    expect(report.verdict.severity).toBe("correction");
    expect(report.verdict.correction!.reclassify).toBe(true);
    expect(report.verdict.correction!.re_run_validators.sort()).toEqual(["antitrust", "hr-comp"]);

    // the correction path: supersede() (full Decision-5a asymmetry on the reducing
    // side is already proven in classification-write tests) retires the skips in
    // the same transaction, and the engine shows exactly those two re-required
    supersede(
      { project_id: pid, case_type: "brownfield", origin: "external", classified_by: U1, rationale: STRONG_RATIONALE, now: NOW },
      db,
    );
    const ev = evaluateValidatorCompleteness(pid, null, db, { now: FIXED_NOW });
    expect(ev.halt.triggered).toBe(true);
    expect(ev.halt.missing.sort()).toEqual(["antitrust", "hr-comp"]); // the re-run set, and nothing else missing
    expect(ev.applicable_count).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Spec §3 row 9 — the demoted secondary signal: advisory, never blocks
// ---------------------------------------------------------------------------

describe("origin vs rbd_source — advisory only", () => {
  test("a contradictory rbd_source with NO primary signals logs an advisory and stays clear — even under weak provenance", () => {
    const pid = insertProject();
    classifyInternal(pid, WEAK_RATIONALE); // weak provenance must not matter: the advisory never blocks
    insertDdFinding(pid, {
      category: "rbd",
      description: "Partnered accelerator program sourcing assessment",
      rbd_source: "external_technology_acquisition",
    });

    const report = crossValidateClassification(pid, U1, { now: FIXED_NOW, db });
    expect(report.primary.mismatched).toBe(false);
    expect(report.verdict.blocked).toBe(false);
    expect(report.verdict.severity).toBe("clear");
    expect(report.advisories).toHaveLength(1);
    expect(report.advisories[0].kind).toBe("origin_vs_rbd_source");
    expect(report.advisories[0].rbd_source).toBe("external_technology_acquisition");
    expect(report.advisories[0].detail_en).toContain("secondary signal, logged only");
  });

  test("a CONSISTENT rbd_source produces no advisory", () => {
    const pid = insertProject();
    classifyInternal(pid, STRONG_RATIONALE);
    insertDdFinding(pid, { category: "rbd", description: "Internal spin-out assessment", rbd_source: "internal_only" });
    const report = crossValidateClassification(pid, U1, { now: FIXED_NOW, db });
    expect(report.advisories).toHaveLength(0);
  });
});

describe("actor guards + audit", () => {
  test("non-member actor → REJECTED (FR-SEC-08)", () => {
    const pid = insertProject();
    classifyInternal(pid, STRONG_RATIONALE);
    expect(() => crossValidateClassification(pid, U3, { now: FIXED_NOW, db })).toThrow(/not an active project_member/);
  });

  test("every run writes exactly one dd_cross_validation audit row recording the outcome", () => {
    const pid = insertProject();
    classifyInternal(pid, WEAK_RATIONALE);
    insertCertCoc(pid);
    crossValidateClassification(pid, U1, { now: FIXED_NOW, db });

    const rows = db
      .query("SELECT actor_user_id, action, target FROM audit_log WHERE action = 'dd_cross_validation' AND target LIKE ?")
      .all(`${pid}%`) as { actor_user_id: string; action: string; target: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(U1);
    expect(rows[0].target).toContain(":block");
    expect(rows[0].target).toContain("signals=certification_coc");
  });
});
