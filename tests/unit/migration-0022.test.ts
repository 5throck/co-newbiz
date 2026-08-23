/**
 * Unit tests for migration 0022 (PR-9 rule activation) — the three APPROVED
 * threshold records' activation values pinned verbatim:
 *   docs/decisions/market-thresholds.md              D-M-MKT-11.3 (the exact
 *     thresholds_source literal), D-M-MKT-10.1/11.2 (right-to-win re-graded
 *     green but cap-deferred)
 *   docs/decisions/risk-thresholds.md                header literal, D-M-RISK-5
 *   docs/decisions/technical-execution-thresholds.md D-M-TE-1..8, and the
 *     D-M-TE-5 double-counting guard the record mandates verifying "at PR-9
 *     activation review via the rag_rule_variable join rows".
 * Real scratch SQLite (the migration-0013+ pattern: runMigrations on a temp
 * WAL DB through the FULL chain, resetDb in afterAll) so the 0012
 * enabled-CHECK, the governance_doc FK, and the join table are exercised by
 * SQLite itself, not mocked.
 *
 * These tests pin five things:
 *   (a) the three governance_doc seeds — the doc of record IS the record
 *       file, so every anchor resolves to a real row a reviewer can open;
 *   (b) all 18 activated rows carry their record's exact policy_id and
 *       thresholds_source (the test constants are transcribed verbatim from
 *       the records — this file is the oracle, not a restatement);
 *   (c) the GREEN CAP GUARD: no enabled rule of grade green exists in
 *       market/technical_execution/risk — right-to-win stays disabled until
 *       calibration lifts Decision 9 (D-M-MKT-11.2);
 *   (d) the D-M-TE-5 join-row guard: the two permit critical-path vars are
 *       joined by technical_execution rules ONLY, and no technical rule
 *       reads any permit.status-derived var or antitrust_finding;
 *   (e) idempotence.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";

const TEST_DB_PATH = "db/data/test-migration-0022.sqlite";
const MIGRATIONS_DIR = join(import.meta.dirname, "../../db/migrations");
const EFFECTIVE_FROM = "2026-08-23T00:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;

// ---------------------------------------------------------------------------
// The records' activation values, transcribed verbatim — the test oracle
// ---------------------------------------------------------------------------

/** D-M-MKT-11.3's proposed thresholds_source literal, character for character. */
const MARKET_SOURCE =
  "D-M-MKT-1..11, market thresholds meeting 2026-08-23 (market-intelligence-agent, industry-lead, risk-officer, chair process-governance-manager) — docs/decisions/market-thresholds.md, supersedes docs/decisions/open/market-thresholds.md";

/** The risk record header's thresholds_source literal, character for character. */
const RISK_SOURCE =
  "docs/decisions/risk-thresholds.md — D-M-RISK-1..7, meeting 2026-08-23 (risk-officer, valuation-agent, legal-counsel, process-governance-manager chair)";

/** The technical record's citation (D-M-TE-1..8, "thresholds_source = this record"). */
const TECH_SOURCE = "docs/decisions/technical-execution-thresholds.md — D-M-TE-1..8, meeting 2026-08-23";

const GOVERNANCE_DOCS = [
  {
    id: "gd-0022-market-thresholds",
    layer: "policy",
    key: "market-thresholds",
    title: "Decision Record — Market Dimension Thresholds",
    version: "v1.0",
    enforceability: "mandatory",
    owner_agent: "process-governance-manager",
    doc_path: "docs/decisions/market-thresholds.md",
    effective_from: EFFECTIVE_FROM,
  },
  {
    id: "gd-0022-technical-execution-thresholds",
    layer: "policy",
    key: "technical-execution-thresholds",
    title: "Decision Record — Technical Execution Dimension Thresholds",
    version: "v1.0",
    enforceability: "mandatory",
    owner_agent: "process-governance-manager",
    doc_path: "docs/decisions/technical-execution-thresholds.md",
    effective_from: EFFECTIVE_FROM,
  },
  {
    id: "gd-0022-risk-thresholds",
    layer: "policy",
    key: "risk-thresholds",
    title: "Decision Record — Risk Dimension Thresholds",
    version: "v1.0",
    enforceability: "mandatory",
    owner_agent: "process-governance-manager",
    doc_path: "docs/decisions/risk-thresholds.md",
    effective_from: EFFECTIVE_FROM,
  },
] as const;

const ACTIVATION: Record<string, { policyId: string; source: string }> = {
  // market — the 7 non-green rows (D-M-MKT-11.3)
  "market-dd-bargaining-power": { policyId: "gd-0022-market-thresholds", source: MARKET_SOURCE },
  "market-dd-competitive-demerit": { policyId: "gd-0022-market-thresholds", source: MARKET_SOURCE },
  "market-dd-switching-cost": { policyId: "gd-0022-market-thresholds", source: MARKET_SOURCE },
  "market-dd-tam-growth": { policyId: "gd-0022-market-thresholds", source: MARKET_SOURCE },
  "market-screening-tam-growth": { policyId: "gd-0022-market-thresholds", source: MARKET_SOURCE },
  "market-pre-fs-tam-growth": { policyId: "gd-0022-market-thresholds", source: MARKET_SOURCE },
  "market-dd-right-to-win-absent": { policyId: "gd-0022-market-thresholds", source: MARKET_SOURCE },
  // technical_execution — all 7 (D-M-TE-8)
  "tech-dd-trl-pre-validation": { policyId: "gd-0022-technical-execution-thresholds", source: TECH_SOURCE },
  "tech-dd-trl-grade": { policyId: "gd-0022-technical-execution-thresholds", source: TECH_SOURCE },
  "tech-dd-ip-disputed": { policyId: "gd-0022-technical-execution-thresholds", source: TECH_SOURCE },
  "tech-dd-ip-clarity": { policyId: "gd-0022-technical-execution-thresholds", source: TECH_SOURCE },
  "tech-dd-cert-load-bearing-loss": { policyId: "gd-0022-technical-execution-thresholds", source: TECH_SOURCE },
  "tech-dd-cert-transferability": { policyId: "gd-0022-technical-execution-thresholds", source: TECH_SOURCE },
  "tech-dd-permit-critical-path": { policyId: "gd-0022-technical-execution-thresholds", source: TECH_SOURCE },
  // risk — all 4 (record header)
  "risk-dd-covenant-breach": { policyId: "gd-0022-risk-thresholds", source: RISK_SOURCE },
  "risk-dd-contingent-expected-value": { policyId: "gd-0022-risk-thresholds", source: RISK_SOURCE },
  "risk-dd-contingent-two-factor": { policyId: "gd-0022-risk-thresholds", source: RISK_SOURCE },
  "risk-dd-partner-sourcing": { policyId: "gd-0022-risk-thresholds", source: RISK_SOURCE },
};

interface RuleRow {
  id: string;
  rule_key: string;
  dimension: string;
  grade: string;
  enabled: number;
  policy_id: string | null;
  thresholds_source: string | null;
}

function ruleRow(ruleKey: string): RuleRow {
  return db
    .query("SELECT id, rule_key, dimension, grade, enabled, policy_id, thresholds_source FROM rag_rule WHERE rule_key = ?")
    .get(ruleKey) as never;
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (!existsSync(p)) continue;
    // Windows occasionally lags the handle release just past close(); the
    // artifact is throwaway and beforeAll removes any leftover next run
    try {
      rmSync(p);
    } catch {
      // best-effort cleanup only
    }
  }
});

// ---------------------------------------------------------------------------
// (a) governance_doc seeds
// ---------------------------------------------------------------------------

describe("governance_doc seeds — the records anchor the rules they authorize", () => {
  test("0022 is recorded in the full migration chain", () => {
    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows.map((r) => r.filename)).toContain("0022_rule_activation.sql");
  });

  test("exactly three rows land, each field verbatim — the doc of record IS the decision record file", () => {
    // 0025 later adds gd-0024-class-c-decisions — scope this assertion to
    // THIS migration's own seeds (the verbatim contract is per-seed).
    expect((db.query("SELECT COUNT(*) AS c FROM governance_doc WHERE id LIKE 'gd-0022-%'").get() as { c: number }).c).toBe(3);
    for (const expected of GOVERNANCE_DOCS) {
      const row = db
        .query("SELECT id, layer, key, title, version, enforceability, owner_agent, doc_path, effective_from FROM governance_doc WHERE id = ?")
        .get(expected.id) as never;
      expect(row, expected.id).toEqual({ ...expected });
    }
  });

  test("the (layer, key) uniqueness index discipline holds — three distinct keys", () => {
    const keys = (db.query("SELECT key FROM governance_doc WHERE id LIKE 'gd-0022-%' ORDER BY key").all() as { key: string }[]).map((r) => r.key);
    expect(keys).toEqual(["market-thresholds", "risk-thresholds", "technical-execution-thresholds"]);
  });
});

// ---------------------------------------------------------------------------
// (b) Activation values — 18 rows, verbatim
// ---------------------------------------------------------------------------

describe("rag_rule activation — the records' values, character for character", () => {
  test("exactly 18 rows are enabled: 7 market + 7 technical_execution + 4 risk", () => {
    expect(Object.keys(ACTIVATION)).toHaveLength(18);
    expect((db.query("SELECT COUNT(*) AS c FROM rag_rule WHERE enabled = 1").get() as { c: number }).c).toBe(18);
    const byDim = db
      .query("SELECT dimension, COUNT(*) AS c FROM rag_rule WHERE enabled = 1 GROUP BY dimension ORDER BY dimension")
      .all() as { dimension: string; c: number }[];
    expect(byDim).toEqual([
      { dimension: "market", c: 7 },
      { dimension: "risk", c: 4 },
      { dimension: "technical_execution", c: 7 },
    ]);
  });

  test("every activated row carries its record's exact policy_id and thresholds_source literal", () => {
    for (const [ruleKey, expected] of Object.entries(ACTIVATION)) {
      const row = ruleRow(ruleKey);
      expect(row, ruleKey).toBeDefined();
      expect(row.enabled, ruleKey).toBe(1);
      expect(row.policy_id, ruleKey).toBe(expected.policyId);
      expect(row.thresholds_source, ruleKey).toBe(expected.source); // exact string — no drift from the record
    }
  });

  test("every enabled row's policy_id resolves to a seeded governance_doc row (the 0012 anchor is real)", () => {
    const dangling = db
      .query(
        "SELECT r.rule_key FROM rag_rule r LEFT JOIN governance_doc g ON g.id = r.policy_id WHERE r.enabled = 1 AND g.id IS NULL",
      )
      .all() as { rule_key: string }[];
    expect(dangling).toEqual([]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("market-dd-right-to-win stays enabled=0, grade green, both anchors NULL (D-M-MKT-10.1 cap deferral)", () => {
    const row = ruleRow("market-dd-right-to-win");
    expect(row.enabled).toBe(0);
    expect(row.grade).toBe("green");
    expect(row.policy_id).toBeNull();
    expect(row.thresholds_source).toBeNull();
  });

  test("no rule outside the three records' dimensions was touched (financial/data_confidence/regulatory_permit/overall untouched)", () => {
    const untouched = db
      .query("SELECT COUNT(*) AS c FROM rag_rule WHERE dimension NOT IN ('market','technical_execution','risk')")
      .get() as { c: number };
    expect(untouched.c).toBe(0); // none exist today — the assertion keeps it that way
  });
});

// ---------------------------------------------------------------------------
// (c) GREEN CAP GUARD (Decision 9 / D-M-MKT-11.2)
// ---------------------------------------------------------------------------

describe("green cap guard", () => {
  test("GREEN CAP GUARD (Decision 9 / D-M-MKT-11.2): no enabled rule of grade green exists in market/technical_execution/risk — enabling one requires the calibration exercise first (ADR-0049 §4), under a new dated record", () => {
    const offenders = db
      .query("SELECT rule_key FROM rag_rule WHERE enabled = 1 AND grade = 'green' AND dimension IN ('market','technical_execution','risk')")
      .all() as { rule_key: string }[];
    // If this fails: an uncalibrated green rule is enabled. Decision 9 (RAG
    // formalization design) caps uncalibrated dimensions at Amber/Red;
    // D-M-MKT-11.2 states the 2026-08-23 records do NOT lift the cap. Disable
    // the row until the calibration dry-run lands a record that lifts it.
    expect(offenders, "Decision 9 Green cap violated — uncalibrated green rule(s) enabled pre-calibration (D-M-MKT-11.2); requires calibration exercise under a new dated record before any green rule may be enabled").toEqual([]);
  });

  test("the 0012 CHECK still forces both anchors on any future enablement (anti-tamper staging survives activation)", () => {
    expect(() => db.run("UPDATE rag_rule SET enabled = 1 WHERE rule_key = 'market-dd-right-to-win'")).toThrow(/CHECK constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// (d) D-M-TE-5 double-counting join guard — verified at activation review
// ---------------------------------------------------------------------------

describe("D-M-TE-5 double-counting guard (join rows)", () => {
  const PERMIT_SCHEDULE_VARS = ["permit.critical_path_duration", "permit.unresolved_on_critical_path"] as const;

  function joinersOf(varKey: string): Array<{ rule_id: string; rule_key: string; dimension: string; enabled: number }> {
    return db
      .query(
        "SELECT r.id AS rule_id, r.rule_key, r.dimension, r.enabled FROM rag_rule_variable j JOIN rag_rule r ON r.id = j.rule_id WHERE j.var_key = ? ORDER BY r.rule_key",
      )
      .all(varKey) as never;
  }

  test("D-M-TE-5 join guard: the two permit critical-path vars are joined by technical_execution rules ONLY — no regulatory_permit rule may join them", () => {
    for (const varKey of PERMIT_SCHEDULE_VARS) {
      const joiners = joinersOf(varKey);
      expect(joiners.length, varKey).toBeGreaterThan(0); // the technical rule exists and is wired
      for (const j of joiners) {
        expect(j.dimension, `${varKey} joined by non-technical rule ${j.rule_key}`).toBe("technical_execution");
      }
      // and the one joining rule is the record's own: tech-dd-permit-critical-path
      expect(joiners.map((j) => j.rule_key), varKey).toEqual(["tech-dd-permit-critical-path"]);
    }
  });

  test("D-M-TE-5 join guard: no technical_execution rule reads any permit.status-derived var or antitrust_finding", () => {
    const techRules = db
      .query("SELECT id, rule_key FROM rag_rule WHERE dimension = 'technical_execution'")
      .all() as Array<{ id: string; rule_key: string }>;
    expect(techRules).toHaveLength(7);
    for (const rule of techRules) {
      const vars = (db.query("SELECT var_key FROM rag_rule_variable WHERE rule_id = ?").all(rule.id) as { var_key: string }[]).map((r) => r.var_key);
      const forbidden = vars.filter((v) => v.startsWith("permit.status") || v.startsWith("antitrust"));
      expect(forbidden, `${rule.rule_key} reads forbidden var(s) ${forbidden.join(", ")} — permit.status outcomes and antitrust_finding belong to regulatory_permit only (D-M-TE-5)`).toEqual([]);
      // and conversely: a technical rule's permit-family vars are exactly the
      // two schedule vars, never an obtainability var
      const permitVars = vars.filter((v) => v.startsWith("permit."));
      for (const v of permitVars) {
        expect(PERMIT_SCHEDULE_VARS.includes(v as (typeof PERMIT_SCHEDULE_VARS)[number]), `${rule.rule_key} reads non-schedule permit var ${v}`).toBe(true);
      }
    }
  });

  test("premise lock history: the 0018 antitrust exclusion held at activation; ADR-0062 later reversed it to exactly ONE tripwire var", () => {
    const antitrust = (db.query("SELECT var_key FROM evidence_var WHERE var_key LIKE 'antitrust%'").all() as { var_key: string }[]).map((r) => r.var_key);
    expect(antitrust).toEqual(["antitrust.presumption_screens_triggered"]);
  });
});

// ---------------------------------------------------------------------------
// (e) Idempotence
// ---------------------------------------------------------------------------

describe("migration idempotence", () => {
  test("re-running runMigrations applies nothing; the activated seed state survives untouched", () => {
    const { applied, skipped } = runMigrations(TEST_DB_PATH);
    expect(applied).toEqual([]);
    expect(skipped.length).toBe(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length);

    expect((db.query("SELECT COUNT(*) AS c FROM rag_rule WHERE enabled = 1").get() as { c: number }).c).toBe(18);
    // 0022's three + 0025's gd-0024-class-c-decisions
    expect((db.query("SELECT COUNT(*) AS c FROM governance_doc").get() as { c: number }).c).toBe(4);
    expect(ruleRow("market-dd-right-to-win").enabled).toBe(0);
  });
});
