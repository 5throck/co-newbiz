/**
 * Unit tests for db/lib/rule-assessment.ts — the PR-9 per-run rule-evaluation
 * consumer: fillSnapshot (1.1.0) → ADR-0046 predicate evaluation of the stage
 * gate's ENABLED rag_rule rows → per-dimension rag_assessment rows under the
 * D-M-RISK-5 pinned combination rule (first TRUE by priority; UNASSESSED
 * rules skipped; no TRUE + any UNASSESSED ⇒ dimension UNASSESSED, no row; all
 * FALSE ⇒ Amber under the Decision 9 Green cap).
 *
 * Real scratch SQLite through the FULL migration chain (0022 activated), so
 * the enabled rule set under test is the real one — not a hand-inserted
 * approximation. Every behavioral expectation traces to a record:
 *   market    D-M-MKT-9 (tam-growth any_of TRUE-dominates), D-M-MKT-10.1
 *             (green rule cap-deferred), D-M-MKT-11.2 (cap not lifted)
 *   risk      D-M-RISK-3 (partner gate pre_fs), D-M-RISK-4 layer 2 (covenant
 *             Red priority 5 precedes the Amber rules), D-M-RISK-5 (the
 *             pinned combination rule itself)
 *   technical D-M-TE-2 (TRL bands), D-M-TE-3 (is_null fires Amber at DD)
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { assessRulesForRun } from "../../db/lib/rule-assessment.ts";

const TEST_DB_PATH = "db/data/test-rule-assessment.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const ASSESSED_AT = "2026-08-23T10:00:00Z";
const U1 = "user-001";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let industryA: string;
let industryB: string;
let sourceA: string;

// ---------------------------------------------------------------------------
// Fixtures (the snapshot-filler.test.ts helper set, trimmed to what these
// scenarios exercise)
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  db.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), U1, "analyst", "active", "salt", "hash", 1, NOW]);

  industryA = ulid();
  industryB = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryA, "30110", "선박용 엔진", "Marine engines", NOW]);
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryB, "30111", "조선업", "Shipbuilding", NOW]);

  sourceA = ulid();
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceA, "KIS-2025", "A", NOW]);
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

function insertProject(): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `NP-${id.slice(-6)}`, NOW]);
  return id;
}

function insertRun(projectId: string): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [id, projectId, `hash-${id.slice(-6)}`, U1, NOW]);
  return id;
}

function bindIndustry(projectId: string, industryId: string): void {
  db.run("INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale, superseded_by) VALUES (?,?,?,?,?,?,?)", [
    ulid(), projectId, industryId, U1, NOW, "test binding rationale", null,
  ]);
}

function insertAnnualPeriod(): string {
  const id = ulid();
  db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", [id, "year", "2025-01-01", "2025-12-31", 2025, NOW]);
  return id;
}

function insertFact(industryId: string, periodId: string, metricKey: string, value: number): void {
  db.run("INSERT INTO fact_industry (id, industry_id, period_id, metric_key, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)", [
    ulid(), industryId, periodId, metricKey, value, 1, sourceA, NOW,
  ]);
}

function insertLink(projectId: string, opts: { hhi?: number | null; grade?: string | null; r2?: number | null } = {}): void {
  db.run(
    "INSERT INTO value_chain_link (id, project_id, from_industry_id, to_industry_id, direction, concentration_hhi, switching_cost_grade, r2, assessed_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), projectId, industryA, industryB, "upstream", opts.hhi ?? null, opts.grade ?? null, opts.r2 ?? null, NOW],
  );
}

function insertAssertion(projectId: string, varKey: string, kind: "num" | "text", value: number | string): void {
  const runId = insertRun(projectId);
  db.run(
    "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, value_num, evidence_ref, asserted_by, reviewed_by, rationale, observed_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [ulid(), runId, projectId, varKey, kind, kind === "text" ? String(value) : null, kind === "num" ? Number(value) : null, "doc://test-evidence", U1, U1, "test rationale", NOW, null],
  );
}

function insertDdFinding(projectId: string, opts: { trl?: string | null; ip?: string | null } = {}): void {
  db.run("INSERT INTO dd_finding (id, project_id, category, description, trl_grade, ip_ownership_status, created_at) VALUES (?,?,?,?,?,?,?)", [
    ulid(), projectId, "technical", "Test finding", opts.trl ?? null, opts.ip ?? null, NOW,
  ]);
}

function insertContingent(projectId: string, probability: number, amountExpected: number): void {
  db.run("INSERT INTO contingent_liability (id, project_id, category, probability, amount_low, amount_expected, amount_high, expected_timing_year) VALUES (?,?,?,?,?,?,?,?)", [
    ulid(), projectId, "litigation", probability, amountExpected, amountExpected, amountExpected, 0,
  ]);
}

function insertSimulationWithBreach(projectId: string): void {
  const runId = insertRun(projectId);
  const simId = ulid();
  db.run("INSERT INTO simulation (id, run_id, seed, iterations, discount_rate, created_at) VALUES (?,?,?,?,?,?)", [simId, runId, 42, 100, 0.08, NOW]);
  db.run("INSERT INTO covenant_test (simulation_id, period_id, covenant_key, threshold, projected_value, breached) VALUES (?,?,?,?,?,?)", [simId, "p1", "dscr", 1.25, 1.0, 1]);
}

function insertPartner(projectId: string, opts: { status?: string; dependency?: string | null } = {}): void {
  db.run("INSERT INTO partner_candidate (id, project_id, name, partner_type, dependency_risk, status) VALUES (?,?,?,?,?,?)", [
    ulid(), projectId, "Acme", "supplier", opts.dependency ?? null, opts.status ?? "sourcing",
  ]);
}

function insertHypothesis(projectId: string, vehicle: string | null): void {
  db.run("INSERT INTO deal_structure_hypothesis (id, project_id, vehicle, hypothesized_by, hypothesized_at, rationale) VALUES (?,?,?,?,?,?)", [
    ulid(), projectId, vehicle, U1, NOW, "test rationale",
  ]);
}

function assessmentRows(runId: string): Array<{ dimension: string; grade: string; triggered_rules: string; rationale: string }> {
  return db
    .query("SELECT dimension, grade, triggered_rules, rationale FROM rag_assessment WHERE run_id = ? ORDER BY dimension")
    .all(runId) as never;
}

function assess(projectId: string, runId: string, stageGate: "screening" | "pre_fs" | "fs" | "dd" | "entity_ic" | "group_ic") {
  return assessRulesForRun(db, { runId, projectId, stageGate, now: ASSESSED_AT });
}

// ---------------------------------------------------------------------------
// market — fires, UNASSESSED propagation, the Green cap
// ---------------------------------------------------------------------------

describe("market dimension", () => {
  test("tam-growth fires at screening on a too-small TAM alone (D-M-MKT-9: any_of TRUE dominates an unknown growth rate)", () => {
    const projectId = insertProject();
    bindIndustry(projectId, industryA);
    const periodId = insertAnnualPeriod();
    insertFact(industryA, periodId, "market_tam_krw", 50_000_000_000); // < 1e11 floor; growth var stays missing
    const runId = insertRun(projectId);

    const result = assess(projectId, runId, "screening");
    expect(result.snapshotVarCount).toBe(41); // the filler's completeness invariant (0025 added the antitrust tripwire)
    expect(result.outcomes.map((o) => o.dimension)).toEqual(["market"]); // no technical/risk rules live at screening
    const market = result.outcomes[0];
    expect(market.assessed).toBe(true);
    expect(market.grade).toBe("amber");
    expect(market.triggeredRuleIds).toEqual(["rule-0019-market-screening-tam-growth"]);
    expect(market.rationale).toContain("market-screening-tam-growth");
    expect(market.rationale).toContain("D-M-MKT-1..11"); // the record literal rides along

    const rows = assessmentRows(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dimension: "market", grade: "amber" });
    expect(JSON.parse(rows[0].triggered_rules)).toEqual(["rule-0019-market-screening-tam-growth"]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("UNASSESSED propagates: TAM above the floor with growth unknown leaves market UNASSESSED — no row written (ADR-0046 §2)", () => {
    const projectId = insertProject();
    bindIndustry(projectId, industryA);
    const periodId = insertAnnualPeriod();
    insertFact(industryA, periodId, "market_tam_krw", 200_000_000_000); // >= floor → cmp FALSE; growth missing → any_of(F, U) = U
    const runId = insertRun(projectId);

    const result = assess(projectId, runId, "pre_fs");
    const market = result.outcomes.find((o) => o.dimension === "market");
    expect(market?.assessed).toBe(false);
    const risk = result.outcomes.find((o) => o.dimension === "risk");
    expect(risk?.assessed).toBe(false); // partner vars missing (no hypothesis) — skipped, not matched
    expect(result.outcomes.find((o) => o.dimension === "technical_execution")).toBeUndefined(); // no technical rules at pre_fs
    expect(assessmentRows(runId)).toEqual([]); // UNASSESSED dimensions write NO rows
  });

  test("all rules determinately FALSE ⇒ Amber under the Decision 9 Green cap — never Green (D-M-RISK-5 / D-M-MKT-11.2)", () => {
    const projectId = insertProject();
    bindIndustry(projectId, industryA);
    const periodId = insertAnnualPeriod();
    insertFact(industryA, periodId, "market_tam_krw", 200_000_000_000); // tam-growth conjunct FALSE
    insertFact(industryA, periodId, "market_growth_yoy_ratio", 0.08); // 8% — above both growth cuts
    insertFact(industryA, periodId, "market_top3_share_ratio", 0.3); // demerit conjunct FALSE
    insertLink(projectId, { hhi: 0.1, r2: 0.8, grade: "moderate" }); // bargaining FALSE (0.1 < 0.25); switching FALSE (moderate not in {negligible,low})
    insertAssertion(projectId, "market.entry_barrier", "text", "moderate"); // demerit conjunct FALSE
    insertAssertion(projectId, "right_to_win.customer_overlap", "num", 3); // absent-rule conjuncts FALSE
    insertAssertion(projectId, "right_to_win.tech_overlap", "num", 3);
    insertAssertion(projectId, "right_to_win.brand_transferability", "num", 3);
    const runId = insertRun(projectId);

    const result = assess(projectId, runId, "dd");
    const market = result.outcomes.find((o) => o.dimension === "market");
    expect(market?.assessed).toBe(true);
    expect(market?.grade).toBe("amber"); // would-be Green, capped — the cap is the ONLY thing between FALSE-everywhere and Green
    expect(market?.triggeredRuleIds).toEqual([]);
    expect(market?.rationale).toContain("Decision 9 Green cap");
    // the disabled green right-to-win rule must not have been evaluated at all
    expect(market?.rationale).not.toContain("right-to-win'");
    expect(JSON.parse(assessmentRows(runId).find((r) => r.dimension === "market")?.triggered_rules ?? "null")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// technical_execution — Red priority, the deliberate is_null Amber
// ---------------------------------------------------------------------------

describe("technical_execution dimension", () => {
  test("empty DD evidence grades Amber via ip-clarity's is_null (D-M-TE-3: absent IP status at DD IS the signal)", () => {
    const projectId = insertProject();
    const runId = insertRun(projectId);

    const result = assess(projectId, runId, "dd");
    const tech = result.outcomes.find((o) => o.dimension === "technical_execution");
    expect(tech?.assessed).toBe(true);
    expect(tech?.grade).toBe("amber");
    expect(tech?.triggeredRuleIds).toEqual(["rule-0018-tech-dd-ip-clarity"]);
    // market/risk stay UNASSESSED on zero evidence — no defaulted rows
    expect(result.outcomes.find((o) => o.dimension === "market")?.assessed).toBe(false);
    expect(result.outcomes.find((o) => o.dimension === "risk")?.assessed).toBe(false);
    expect(assessmentRows(runId).map((r) => r.dimension)).toEqual(["technical_execution"]);
  });

  test("TRL1-3 Red (priority 1) wins over the IP Amber that also fires (D-M-TE-2 / D-M-TE-8 priority order)", () => {
    const projectId = insertProject();
    insertDdFinding(projectId, { trl: "TRL2", ip: "licensed_in" }); // trl-pre-validation TRUE (red, prio 1); ip-clarity TRUE (amber, prio 4)
    const runId = insertRun(projectId);

    const tech = assess(projectId, runId, "dd").outcomes.find((o) => o.dimension === "technical_execution");
    expect(tech?.grade).toBe("red");
    expect(tech?.triggeredRuleIds).toEqual(["rule-0019-tech-dd-trl-pre-validation", "rule-0018-tech-dd-ip-clarity"]); // priority order, both recorded
    expect(tech?.rationale).toContain("tech-dd-trl-pre-validation");
  });
});

// ---------------------------------------------------------------------------
// risk — Red-before-Amber priority, the pre_fs partner gate
// ---------------------------------------------------------------------------

describe("risk dimension", () => {
  test("covenant Red (priority 5) is not masked by the contingent Amber (priority 6) that also fires (D-M-RISK-4 layer 2)", () => {
    const projectId = insertProject();
    insertSimulationWithBreach(projectId); // covenants_breached present >= 1 → covenant rule TRUE (red, prio 5)
    insertContingent(projectId, 1.0, 20_000); // storage M -> filler x1e6: EV 2e10 raw-won >= 1e10 → expected-value rule TRUE (amber, prio 6)
    const runId = insertRun(projectId);

    const risk = assess(projectId, runId, "dd").outcomes.find((o) => o.dimension === "risk");
    expect(risk?.assessed).toBe(true);
    expect(risk?.grade).toBe("red"); // first-match-wins with Red restated first — the staged-priority defect D-M-RISK-4 fixed
    expect(risk?.triggeredRuleIds).toEqual(["rule-0018-risk-dd-covenant-breach", "rule-0018-risk-dd-contingent-expected-value"]);
    expect(risk?.rationale).toContain("risk-dd-covenant-breach");
  });

  test("partner-sourcing fires at pre_fs — the D-M-RISK-3 gate restatement (signal before DD spend, ADR-0031)", () => {
    const projectId = insertProject();
    insertHypothesis(projectId, "jv");
    insertPartner(projectId, { status: "contacted", dependency: "high" }); // active pool = 1 (lte 1 TRUE) AND dependency high TRUE
    const runId = insertRun(projectId);

    const result = assess(projectId, runId, "pre_fs");
    const risk = result.outcomes.find((o) => o.dimension === "risk");
    expect(risk?.assessed).toBe(true);
    expect(risk?.grade).toBe("amber");
    expect(risk?.triggeredRuleIds).toEqual(["rule-0018-risk-dd-partner-sourcing"]);
    expect(assessmentRows(runId).map((r) => r.dimension)).toEqual(["risk"]); // contingent/covenant are dd-gated — not in scope here
  });
});

// ---------------------------------------------------------------------------
// Runtime guards — the Decision 9 cap and run immutability
// ---------------------------------------------------------------------------

describe("runtime guards", () => {
  test("GREEN CAP at runtime: a winning green-graded rule THROWS instead of yielding Green — no partial row is written (Decision 9 / D-M-MKT-11.2)", () => {
    const projectId = insertProject();
    insertAssertion(projectId, "right_to_win.customer_overlap", "num", 4);
    insertAssertion(projectId, "right_to_win.tech_overlap", "num", 4);
    insertAssertion(projectId, "right_to_win.brand_transferability", "num", 4);
    const runId = insertRun(projectId);

    // A drifted/differently-migrated DB enables the green rule with both
    // anchors — legal per the 0012 CHECK, illegal per Decision 9. The
    // evaluator must fail loud, never average the cap away.
    db.run(
      "UPDATE rag_rule SET enabled = 1, policy_id = 'gd-0022-market-thresholds', thresholds_source = 'drifted enablement — test' WHERE rule_key = 'market-dd-right-to-win'",
    );
    try {
      expect(() => assess(projectId, runId, "dd")).toThrow(/Decision 9 Green cap/);
      expect(assessmentRows(runId)).toEqual([]); // the throw precedes any write
    } finally {
      db.run("UPDATE rag_rule SET enabled = 0, policy_id = NULL, thresholds_source = NULL WHERE rule_key = 'market-dd-right-to-win'");
    }
  });

  test("run immutability: grading the same run twice throws on the snapshot PK (ADR-0005 — a run is filled and graded exactly once)", () => {
    const projectId = insertProject();
    const runId = insertRun(projectId);
    assess(projectId, runId, "dd");
    expect(() => assess(projectId, runId, "dd")).toThrow(/UNIQUE constraint failed/);
  });
});
