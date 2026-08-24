/**
 * Unit tests for db/lib/kill-criteria.ts — the ADR-0057 evaluator. Real
 * scratch SQLite through the FULL migration chain and the REAL registry
 * files (brownfield-dd: 2 predicate-null halts inert + the 2 entries
 * activated by this PR — covenant halt / D-M-RISK-2, partner
 * mark_conditional / D-M-RISK-3), so the entries under test are the real
 * ones, not a hand-inserted approximation.
 *
 * Behavioral expectations trace to the records:
 *   covenant  risk-thresholds.md AI-1 — breached covenant test of the latest
 *             simulation ⇒ halt; no-sim/no-debt ⇒ present 0, determinately
 *             NOT triggered (not a silent pass: the var is present)
 *   partner   risk-thresholds.md AI-1 / D-M-RISK-3 — jv hypothesis + one
 *             active high-dependency candidate ⇒ mark_conditional; two
 *             active candidates or a determinate non-high dependency ⇒
 *             false; hypothesis unrecorded ⇒ UNASSESSED (listed, the caller
 *             decides — never a silent pass, never a defaulted halt)
 *   twin      ADR-0060 Decision 2 — greenfield-screening carries the same
 *             partner criterion verbatim (anchors are record-scoped, not
 *             procedure-scoped): 1 enabled + 2 predicate-null inert; same
 *             outcome map, including UNASSESSED before any hypothesis exists
 *   fill-once assessRulesForRun fills unconditionally, so composition order
 *             is assess-first; the evaluator skips a filled run and is
 *             re-runnable read-only
 */
import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { evaluateKillCriteria, validateRegistryEntry } from "../../db/lib/kill-criteria.ts";
import { recordKillCriteriaEvaluation, getRecordedEvaluation } from "../../db/repositories/kill-criteria.repository.ts";
import { assessRulesForRun } from "../../db/lib/rule-assessment.ts";

const TEST_DB_PATH = "db/data/test-kill-criteria.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const EVALUATED_AT = "2026-08-23T10:00:00Z";
const U1 = "user-001"; // member everywhere
const U3 = "user-003"; // app_user only — never a project_member

type Db = ReturnType<typeof GetDb>;
let db: Db;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  db.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), U1, "analyst", "active", "salt", "hash", 1, NOW]);
  db.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), U3, "analyst", "active", "salt", "hash", 1, NOW]);
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

function insertMnpiProject(): string {
  const id = insertProject();
  db.run("INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, classified_by, classified_at) VALUES (?,?,?,?,?)", [id, "restricted", 1, "legal", NOW]);
  return id;
}

function grantMember(projectId: string, userId: string): void {
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, userId, "contributor", "admin", NOW, "test fixture basis"]);
}

function enrollInsider(projectId: string, userId: string): void {
  db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [projectId, userId, NOW, "test fixture enrollment"]);
}

function insertRun(projectId: string): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [id, projectId, `hash-${id.slice(-6)}`, U1, NOW]);
  return id;
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

function evaluate(projectId: string, runId: string) {
  return evaluateKillCriteria(db, { runId, projectId, procedure: "brownfield-dd", now: EVALUATED_AT });
}

function evaluateScreening(projectId: string, runId: string) {
  return evaluateKillCriteria(db, { runId, projectId, procedure: "greenfield-screening", now: EVALUATED_AT });
}

function snapshotCount(runId: string): number {
  return (db.query("SELECT COUNT(*) AS n FROM project_variable_snapshot WHERE run_id = ?").get(runId) as { n: number }).n;
}

const COVENANT = "covenant_breach_with_coc_acceleration_under_downside";
const PARTNER = "partner_dependency_unconfirmed_and_no_alternative";
const VALIDATORS = "any_of_six_ma_validators_missing_at_dd_exit";
const INFRA_PLAN = "infrastructure_plan_not_finalized_at_site_announcement";

describe("covenant halt — D-M-RISK-2 / AI-1", () => {
  test("a breached covenant test in the latest simulation triggers the halt", () => {
    const projectId = insertProject();
    insertSimulationWithBreach(projectId); // sim + one breached test on its own run
    const runId = insertRun(projectId);

    const result = evaluate(projectId, runId);

    // ADR-0063/0064 armed all four brownfield-dd entries: covenant, partner,
    // cert-inferred tripwire, six-validator completeness. A registry gaining
    // a new enabled entry changes observable behavior — lines update with it.
    expect(result.evaluated).toBe(4);
    expect(result.inert).toBe(0);

    expect(result.triggered.map((t) => t.criterion_id).sort()).toEqual([COVENANT, VALIDATORS].sort());

    // Partner half: no deal_structure_hypothesis recorded → both partner vars
    // missing → UNASSESSED — listed, never a silent pass.
    expect(result.unassessed).toEqual([PARTNER]);
  });

  test("no simulation and no debt → covenants_breached present 0 → determinately NOT triggered", () => {
    const projectId = insertProject();
    const runId = insertRun(projectId);

    const result = evaluate(projectId, runId);

    // The six-validator count IS determinately 6 here (nothing covered) — its
    // halt fires even though the covenant path does not.
    expect(result.triggered.map((t) => t.criterion_id)).toEqual([VALIDATORS]);
    expect(result.unassessed).toEqual([PARTNER]); // covenant FALSE, not unassessed — the var is present
  });
});

describe("partner mark_conditional — D-M-RISK-3 / AI-1", () => {
  test("jv hypothesis + one active high-dependency candidate triggers mark_conditional", () => {
    const projectId = insertProject();
    insertHypothesis(projectId, "jv");
    insertPartner(projectId, { status: "contacted", dependency: "high" });
    const runId = insertRun(projectId);

    const result = evaluate(projectId, runId);

    expect(result.triggered.map((t) => t.criterion_id).sort()).toEqual([PARTNER, VALIDATORS].sort());
    expect(result.triggered.find((t) => t.criterion_id === PARTNER)!.action).toBe("mark_conditional");
    expect(result.unassessed).toEqual([]);
  });

  test("two active candidates → 'no alternative' is false → conjunction false, no trigger", () => {
    const projectId = insertProject();
    insertHypothesis(projectId, "jv");
    insertPartner(projectId, { status: "contacted", dependency: "high" });
    insertPartner(projectId, { status: "in_negotiation", dependency: "low" });
    const runId = insertRun(projectId);

    const result = evaluate(projectId, runId);
    expect(result.triggered.map((t) => t.criterion_id)).toEqual([VALIDATORS]);
    expect(result.unassessed).toEqual([]);
  });

  test("non-JV vehicle → dependency determinately 'none' → in-predicate false, no trigger", () => {
    const projectId = insertProject();
    insertHypothesis(projectId, "direct"); // vehicle ≠ null and ≠ jv → dependency "none"
    insertPartner(projectId, { status: "contacted", dependency: "high" });
    const runId = insertRun(projectId);

    const result = evaluate(projectId, runId);
    expect(result.triggered.map((t) => t.criterion_id)).toEqual([VALIDATORS]);
    expect(result.unassessed).toEqual([]);
  });
});

// ADR-0060 Decision 2: the greenfield-screening twin of the brownfield-dd
// partner criterion — same two 0018-seeded vars, same D-M-RISK-3 conjunction
// verbatim, same record-scoped anchors. The procedure loads 3 entries: the
// enabled twin plus the two predicate-null class-(iii) entries (infrastructure
// plan not finalized / zero sites clear minimums).
describe("greenfield-screening — the ADR-0060 partner twin (D-M-RISK-3 / AI-1)", () => {
  test("the registry loads 4 entries: the enabled twin + the ADR-0065 infra-plan tripwire + 2 predicate-null inert", () => {
    const projectId = insertProject();
    const runId = insertRun(projectId);

    const result = evaluateScreening(projectId, runId);

    expect(result.evaluated).toBe(2);
    expect(result.inert).toBe(1);
    const byId = new Map(result.outcomes.map((o) => [o.criterion_id, o]));
    expect(byId.get(PARTNER)).toMatchObject({ action: "mark_conditional", outcome: "unassessed" });
    // Anti-tamper contract (registry check c, enforced at runtime too): each
    // enabled entry carries BOTH governance anchors.
    expect(byId.get(PARTNER)?.policy_id).toBe("gd-0022-risk-thresholds");
    expect(byId.get(PARTNER)?.thresholds_source).toContain("risk-thresholds.md");
    expect(byId.get(INFRA_PLAN)?.policy_id).toBe("gd-0024-class-c-decisions");
    expect(byId.get(INFRA_PLAN)?.thresholds_source).toContain("2026-08-24-class-c-decisions.md");
    // Bare project: infra.plan_finalized is asserted-var → missing → UNASSESSED
    expect(result.unassessed.sort()).toEqual([INFRA_PLAN, PARTNER].sort());
  });

  test("jv hypothesis + one active high-dependency candidate triggers mark_conditional; infra plan unasserted stays UNASSESSED", () => {
    const projectId = insertProject();
    insertHypothesis(projectId, "jv");
    insertPartner(projectId, { status: "contacted", dependency: "high" });
    const runId = insertRun(projectId);

    const result = evaluateScreening(projectId, runId);

    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0].criterion_id).toBe(PARTNER);
    expect(result.triggered[0].action).toBe("mark_conditional");
    expect(result.unassessed).toEqual([INFRA_PLAN]);
    expect(result.outcomes.find((o) => o.criterion_id === PARTNER)!.outcome).toBe("true");
  });

  test("two active candidates → 'no alternative' is false → conjunction false, no trigger", () => {
    const projectId = insertProject();
    insertHypothesis(projectId, "jv");
    insertPartner(projectId, { status: "contacted", dependency: "high" });
    insertPartner(projectId, { status: "in_negotiation", dependency: "low" });
    const runId = insertRun(projectId);

    const result = evaluateScreening(projectId, runId);
    expect(result.triggered).toHaveLength(0);
    expect(result.unassessed).toEqual([INFRA_PLAN]);
    expect(result.outcomes.find((o) => o.criterion_id === PARTNER)!.outcome).toBe("false");
  });

  test("determinate non-high dependency → in-set conjunct false, no trigger", () => {
    const projectId = insertProject();
    insertHypothesis(projectId, "jv");
    insertPartner(projectId, { status: "contacted", dependency: "medium" });
    const runId = insertRun(projectId);

    const result = evaluateScreening(projectId, runId);
    expect(result.triggered).toHaveLength(0);
    expect(result.unassessed).toEqual([INFRA_PLAN]);
    expect(result.outcomes.find((o) => o.criterion_id === PARTNER)!.outcome).toBe("false");
  });

  test("no deal_structure_hypothesis → the filler seeds neither partner var → UNASSESSED, never a silent false (ADR-0060 Decision 2)", () => {
    const projectId = insertProject();
    const runId = insertRun(projectId);

    const result = evaluateScreening(projectId, runId);

    expect(result.unassessed.sort()).toEqual([INFRA_PLAN, PARTNER].sort());
    expect(result.triggered).toHaveLength(0);
    expect(result.outcomes[0].outcome).toBe("unassessed");
    // Pin the screening premise at the filler layer: with no hypothesis the
    // filler wrote BOTH risk vars missing — the criterion is listed for the
    // caller to decide, not defaulted to false.
    const vars = db
      .query("SELECT var_key, status FROM project_variable_snapshot WHERE run_id = ? AND var_key IN ('risk.partner_candidates_active','risk.partner_dependency_risk')")
      .all(runId) as Array<{ var_key: string; status: string }>;
    expect(vars).toHaveLength(2);
    expect(vars.every((v) => v.status === "missing")).toBe(true);
  });

  test("record → the triggered twin lands in the ledger and reads back under mark_conditional", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    insertHypothesis(projectId, "jv");
    insertPartner(projectId, { status: "contacted", dependency: "high" });
    const runId = insertRun(projectId);

    const { result, rowIds } = record(projectId, runId, "greenfield-screening");

    expect(result.triggered).toHaveLength(1);
    // The complete ledger: the triggered twin + the ADR-0065 infra-plan
    // tripwire (UNASSESSED on an unasserted project) — inert entries claim nothing.
    expect(rowIds).toHaveLength(2);

    const rows = ledgerRows(runId);
    expect(rows).toHaveLength(2);
    const partnerRow = rows.find((r) => r.criterion_id === PARTNER)!;
    expect(partnerRow.outcome).toBe("triggered");
    expect(partnerRow.action).toBe("mark_conditional");
    expect(partnerRow.policy_id).toBe("gd-0022-risk-thresholds"); // anchors snapshotted (ADR-0005)
    expect(String(partnerRow.thresholds_source)).toContain("risk-thresholds.md");
    expect(partnerRow.evaluated_by).toBe(U1);
    expect(partnerRow.evaluated_at).toBe(EVALUATED_AT);

    const summary = getRecordedEvaluation({ runId, projectId, procedure: "greenfield-screening", actor: U1 }, db);
    expect(summary.status).toBe("recorded");
    expect(summary.mark_conditional).toHaveLength(1);
    expect(summary.mark_conditional[0].criterion_id).toBe(PARTNER);
    expect(summary.mark_conditional[0].predicate).toHaveProperty("op"); // parsed from predicate_json, not a string
    expect(summary.halt).toHaveLength(0);
    expect(summary.unassessed.map((r) => r.criterion_id)).toEqual([INFRA_PLAN]);
    expect(summary.evaluated_false).toHaveLength(0);
    expect(summary.procedures).toEqual(["greenfield-screening"]);
  });

  test("a determinate-false twin records outcome 'false' — read back in evaluated_false, auditable proof of evaluation", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    insertHypothesis(projectId, "jv");
    insertPartner(projectId, { status: "contacted", dependency: "medium" });
    const runId = insertRun(projectId);

    record(projectId, runId, "greenfield-screening");

    expect(ledgerRows(runId)).toHaveLength(2);
    expect(ledgerRows(runId).find((r) => r.criterion_id === PARTNER)!.outcome).toBe("false");
    const summary = getRecordedEvaluation({ runId, projectId, procedure: "greenfield-screening", actor: U1 }, db);
    expect(summary.evaluated_false.map((r) => r.criterion_id)).toEqual([PARTNER]);
    expect(summary.mark_conditional).toHaveLength(0);
    expect(summary.unassessed.map((r) => r.criterion_id)).toEqual([INFRA_PLAN]);
  });

  test("no hypothesis → the twin records outcome 'unassessed' — the gate reads it in the caller-decides group", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    record(projectId, runId, "greenfield-screening");

    expect(ledgerRows(runId)).toHaveLength(2);
    expect(ledgerRows(runId).find((r) => r.criterion_id === PARTNER)!.outcome).toBe("unassessed");
    const summary = getRecordedEvaluation({ runId, projectId, procedure: "greenfield-screening", actor: U1 }, db);
    expect(summary.unassessed.map((r) => r.criterion_id).sort()).toEqual([INFRA_PLAN, PARTNER].sort());
    expect(summary.mark_conditional).toHaveLength(0);
    expect(summary.evaluated_false).toHaveLength(0);
  });
});

// ADR-0062: the migration-0018 Decision 4 premise-lock reversal — antitrust
// enters the evidence plane as ONE computed var (migration 0025), and
// brownfield-screening's #13 arms as the screening-stage tripwire. The
// trigger ESCALATES to the human gate; it never auto-kills.
describe("brownfield-screening — the ADR-0062 antitrust tripwire (Class C record)", () => {
  const HHI = "preliminary_hhi_flags_certain_block";

  function insertFinding(projectId: string, hhiBefore: number | null, hhiAfter: number | null): void {
    db.run(
      "INSERT INTO antitrust_finding (id, project_id, market_definition, hhi_before, hhi_after, created_at) VALUES (?,?,?,?,?,?)",
      [ulid(), projectId, "test-market", hhiBefore, hhiAfter, NOW],
    );
  }

  function evaluateBScreening(projectId: string, runId: string) {
    return evaluateKillCriteria(db, { runId, projectId, procedure: "brownfield-screening", now: EVALUATED_AT });
  }

  test("the registry loads 2 entries: both enabled tripwires (antitrust + longlist) — zero inert", () => {
    const projectId = insertProject();
    const runId = insertRun(projectId);

    const result = evaluateBScreening(projectId, runId);

    expect(result.evaluated).toBe(2);
    expect(result.inert).toBe(0);
    const byId = new Map(result.outcomes.map((o) => [o.criterion_id, o]));
    const anti = byId.get(HHI)!;
    expect(anti.action).toBe("escalate_to_risk_officer");
    expect(anti.policy_id).toBe("gd-0024-class-c-decisions");
    expect(anti.thresholds_source).toContain("2026-08-24-class-c-decisions.md");
    // The round-4 longlist tripwire shares the same anchor generation.
    const longlist = byId.get("no_viable_target_in_longlist")!;
    expect(longlist.action).toBe("halt");
    expect(longlist.policy_id).toBe("gd-0024-class-c-decisions");
  });

  test("no antitrust_finding rows and no longlist → both tripwires UNASSESSED-listed, never a silent pass", () => {
    const projectId = insertProject();
    const runId = insertRun(projectId);

    const result = evaluateBScreening(projectId, runId);

    expect(result.triggered).toHaveLength(0);
    expect(result.unassessed.sort()).toEqual([HHI, "no_viable_target_in_longlist"].sort());
  });

  test("a finding inside the presumption zone (HHI>1800 AND delta>100) triggers the escalation", () => {
    const projectId = insertProject();
    insertFinding(projectId, 1500, 1950);
    const runId = insertRun(projectId);

    const result = evaluateBScreening(projectId, runId);

    expect(result.triggered.map((t) => t.criterion_id)).toEqual([HHI]);
    expect(result.unassessed).toEqual(["no_viable_target_in_longlist"]);
  });

  test("concentrated but sub-delta movement (HHI>1800, delta=100 exactly) does NOT trigger", () => {
    const projectId = insertProject();
    insertFinding(projectId, 1750, 1850);
    const runId = insertRun(projectId);

    const result = evaluateBScreening(projectId, runId);

    expect(result.triggered).toHaveLength(0);
    // Longlist tripwire is determinately false here: the finding exists and
    // no knock-out-passing candidate was recorded on this fixture.
    expect(result.unassessed).toEqual(["no_viable_target_in_longlist"]);
  });
});

// ADR-0063: the four Class-C criteria arm together — threshold halves from
// gd-0024-class-c-decisions, var halves from migration 0026's tables.
describe("Class C armed criteria (ADR-0063)", () => {
  const ATTRITION = "key_talent_attrition_above_threshold_at_90d";
  const SYNERGY = "synergy_run_rate_uncertified_at_bau_handover";
  const NO_SHAPE = "no_viable_deal_shape";
  const DEADLINE = "permit_critical_path_exceeds_incentive_deadline";

  function insertTalent(pid: string, status: string, exitDate: string | null): void {
    db.run("INSERT INTO pmi_key_talent (id, project_id, role_ref, status, exit_date, locked_at, created_at) VALUES (?,?,?,?,?,?,?)", [ulid(), pid, "C-EO-001", status, exitDate, NOW, NOW]);
  }

  function insertCert(pid: string, runRateBp: number): void {
    db.run("INSERT INTO pmi_synergy_certification (id, project_id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at, created_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), pid, runRateBp, 2, "C-CFO-001", NOW, NOW, NOW]);
  }

  function insertShape(pid: string, viable: number): void {
    db.run("INSERT INTO deal_shape_evaluation (id, project_id, shape, intent, viable, evaluated_by, evaluated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), pid, "minority_stake", "capability_access", viable, U1, NOW]);
  }

  function ev(proc: string, projectId: string, runId: string) {
    return evaluateKillCriteria(db, { runId, projectId, procedure: proc, now: EVALUATED_AT });
  }

  test("#28+#29: closed deal, 1-in-4 regretted inside 90d, no certification → BOTH fire (escalate + halt)", () => {
    const pid = insertProject();
    insertTalent(pid, "departed_regretted", "2026-09-10T00:00:00Z");
    for (const s of ["active", "active", "departed_planned"]) insertTalent(pid, s, s === "active" ? null : "2026-10-01T00:00:00Z");
    const runId = insertRun(pid);

    const result = ev("pmi-integration-execution", pid, runId);

    expect(result.triggered.map((t) => t.criterion_id).sort()).toEqual([ATTRITION, SYNERGY].sort());
    expect(result.triggered.find((t) => t.criterion_id === SYNERGY)!.action).toBe("halt");
  });

  test("#28+#29: full roster retained AND a qualifying certification (92% / 2 quarters) → neither fires", () => {
    const pid = insertProject();
    for (const _ of [1, 2, 3]) insertTalent(pid, "active", null);
    insertCert(pid, 9200);
    const runId = insertRun(pid);

    const result = ev("pmi-integration-execution", pid, runId);
    expect(result.triggered).toHaveLength(0);
    expect(result.unassessed).toEqual([]);
  });

  test("#14: every evaluated shape non-viable → mark_conditional (recycle); no evaluations → unassessed", () => {
    const pid = insertProject();
    insertShape(pid, 0);
    insertShape(pid, 0);
    let runId = insertRun(pid);

    let result = ev("deal-shape-chain", pid, runId);
    expect(result.triggered.map((t) => t.criterion_id)).toEqual([NO_SHAPE]);
    expect(result.triggered[0].action).toBe("mark_conditional");

    const pid2 = insertProject();
    runId = insertRun(pid2);
    result = ev("deal-shape-chain", pid2, runId);
    expect(result.unassessed).toContain(NO_SHAPE);
  });

  test("#4: incentive deadline inside the permit critical path → escalation", () => {
    const pid = insertProject();
    const permitA = ulid();
    const permitB = ulid();
    db.run("INSERT INTO permit (id, project_id, name, statutory_days, status) VALUES (?,?,?,?,?)", [permitA, pid, "P-A", 365, "not_started"]);
    db.run("INSERT INTO permit (id, project_id, name, statutory_days, status) VALUES (?,?,?,?,?)", [permitB, pid, "P-B", 30, "not_started"]);
    db.run("INSERT INTO permit_edge (from_permit_id, to_permit_id) VALUES (?,?)", [permitA, permitB]);
    const soon = new Date(Date.parse(EVALUATED_AT) + 90 * 86_400_000).toISOString();
    db.run("INSERT INTO project_incentive_deadline (id, project_id, incentive_ref, deadline, source, created_at) VALUES (?,?,?,?,?,?)", [ulid(), pid, "INC-001", soon, "test", NOW]);
    const runId = insertRun(pid);

    const result = ev("greenfield-fs", pid, runId);
    expect(result.triggered.map((t) => t.criterion_id)).toEqual([DEADLINE]);
    // Anti-tamper anchors ride the outcome record (same shape as the ADR-0060 twin test)
    const outcome = result.outcomes.find((o) => o.criterion_id === DEADLINE);
    expect(outcome?.policy_id).toBe("gd-0024-class-c-decisions");
    expect(outcome?.thresholds_source).toContain("2026-08-24-class-c-decisions.md");
  });
});

describe("fill-once semantics (ADR-0005) and composition with rule-assessment", () => {
  test("re-evaluating the same run is idempotent — no re-fill, no throw, same result", () => {
    const projectId = insertProject();
    insertSimulationWithBreach(projectId);
    const runId = insertRun(projectId);

    const first = evaluate(projectId, runId);
    const rows = snapshotCount(runId);
    const second = evaluate(projectId, runId);

    expect(snapshotCount(runId)).toBe(rows);
    expect(second.triggered.map((t) => t.criterion_id)).toEqual(first.triggered.map((t) => t.criterion_id));
  });

  test("assess-first composition: assessRulesForRun fills, the evaluator skips and reads the same snapshot", () => {
    const projectId = insertProject();
    insertSimulationWithBreach(projectId);
    const runId = insertRun(projectId);

    assessRulesForRun(db, { runId, projectId, stageGate: "dd", now: EVALUATED_AT }); // fills the run
    const rows = snapshotCount(runId);

    const result = evaluate(projectId, runId); // must NOT try a second fill

    expect(snapshotCount(runId)).toBe(rows);
    expect(result.triggered.map((t) => t.criterion_id)).toContain(COVENANT);
  });
});

describe("procedure scope", () => {
  test("a procedure with no registry entries evaluates zero and claims nothing", () => {
    const projectId = insertProject();
    const runId = insertRun(projectId);
    const result = evaluateKillCriteria(db, { runId, projectId, procedure: "no-such-procedure", now: EVALUATED_AT });
    expect(result.evaluated).toBe(0);
    expect(result.triggered).toEqual([]);
    expect(result.unassessed).toEqual([]);
    expect(result.inert).toBe(0);
  });
});

describe("validateRegistryEntry — runtime anti-tamper (registry check c, at load time)", () => {
  const base = {
    procedure: "synthetic",
    criterion_id: "synthetic-entry",
    action: "halt",
    predicate: { op: "count", var: "risk.covenants_breached", cmp: "gte", value: 1 },
    enabled: true,
    policy_id: "gd-0022-risk-thresholds",
    thresholds_source: "docs/decisions/risk-thresholds.md",
  };

  test("enabled without policy_id is rejected", () => {
    expect(() => validateRegistryEntry({ ...base, policy_id: null })).toThrow(/lacks policy_id/);
  });

  test("enabled without thresholds_source is rejected", () => {
    expect(() => validateRegistryEntry({ ...base, thresholds_source: null })).toThrow(/lacks thresholds_source/);
  });

  test("an action outside the vocabulary is rejected", () => {
    expect(() => validateRegistryEntry({ ...base, action: "maybe_halt" })).toThrow(/outside the actions vocabulary/);
  });

  test("a predicate that does not parse is rejected", () => {
    expect(() => validateRegistryEntry({ ...base, predicate: { op: "no_such_op" } })).toThrow(/does not parse/);
  });

  test("an anchored, parseable, in-vocabulary entry passes", () => {
    expect(() => validateRegistryEntry({ ...base })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// recordKillCriteriaEvaluation — the durable ledger (ADR-0058 §1, migration 0023)
// ---------------------------------------------------------------------------

function record(projectId: string, runId: string, procedure = "brownfield-dd", evaluatedBy = U1) {
  return recordKillCriteriaEvaluation({ runId, projectId, procedure, evaluatedBy, now: EVALUATED_AT }, db);
}

function ledgerRows(runId: string) {
  return db.query("SELECT * FROM kill_criteria_evaluation WHERE run_id = ? ORDER BY criterion_id").all(runId) as Array<Record<string, unknown>>;
}

describe("recordKillCriteriaEvaluation — the complete ledger", () => {
  test("a triggered evaluation writes one row per evaluated criterion with anchors + predicate, and both log rows", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    insertSimulationWithBreach(projectId); // covenant TRUE on its own run
    const runId = insertRun(projectId);

    const { result, rowIds } = record(projectId, runId);

    expect(result.triggered.map((t) => t.criterion_id).sort()).toEqual([COVENANT, VALIDATORS].sort());
    expect(rowIds).toHaveLength(4); // covenant+validators (triggered) + partner+cert-inferred (false) — the COMPLETE ledger

    const rows = ledgerRows(runId);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      // Anchors snapshotted (ADR-0005); two governance generations coexist:
      // 0018-era entries under risk-thresholds, ADR-0063/64 arms under Class C.
      expect(["gd-0022-risk-thresholds", "gd-0024-class-c-decisions"]).toContain(row.policy_id);
      expect(String(row.thresholds_source)).toContain("docs/decisions/");
      expect(JSON.parse(row.predicate_json as string)).toHaveProperty("op");
      expect(row.evaluated_by).toBe(U1);
      expect(row.evaluated_at).toBe(EVALUATED_AT);
    }
    const covenant = rows.find((r) => r.criterion_id === COVENANT);
    expect(covenant?.outcome).toBe("triggered"); // 'true' recorded under the act's name
    expect(covenant?.action).toBe("halt");
    const partner = rows.find((r) => r.criterion_id === PARTNER);
    expect(partner?.outcome).toBe("unassessed");

    const audit = db.query("SELECT target FROM audit_log WHERE action = 'kill_criteria_evaluated' AND actor_user_id = ?").all(U1) as Array<{ target: string }>;
    expect(audit.some((a) => a.target.startsWith(`${projectId}:${runId}:brownfield-dd`) && a.target.includes("evaluated=4") && a.target.endsWith(":HALT-PATH"))).toBe(true);
    const access = db.query("SELECT record_ref FROM data_access_log WHERE table_key = 'kill_criteria_evaluation'").all() as Array<{ record_ref: string }>;
    expect(access.some((a) => a.record_ref === `${projectId}:${runId}:brownfield-dd`)).toBe(true);
  });

  test("a determinate-false criterion is recorded as outcome='false' — auditable proof of evaluation, not absence", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId); // no simulation → covenants_breached present 0

    record(projectId, runId);

    const covenant = ledgerRows(runId).find((r) => r.criterion_id === COVENANT);
    expect(covenant?.outcome).toBe("false");
  });

  test("a second record for the same run+procedure throws (ADR-0005 immutability), leaving no partial state", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);
    record(projectId, runId);

    expect(() => record(projectId, runId)).toThrow(/already has a recorded.*ADR-0005/);
    expect(ledgerRows(runId)).toHaveLength(4); // exactly the first record's rows
  });

  test("read-only evaluate still works on a recorded run (re-check without re-recording)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);
    record(projectId, runId);

    const recheck = evaluate(projectId, runId); // no throw — the ledger is append-only, the evaluator is pure
    expect(recheck.evaluated).toBe(4);
    expect(ledgerRows(runId)).toHaveLength(4);
  });

  test("a procedure with no enabled entries records zero rows — and still writes the audit trail", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    // greenfield-screening gained its ADR-0060 twin, so it no longer
    // exemplifies "no registry files" — use a key the registry has none for.
    const { rowIds } = record(projectId, runId, "no-such-procedure");

    expect(rowIds).toHaveLength(0);
    expect(ledgerRows(runId)).toHaveLength(0);
    const audit = db.query("SELECT target FROM audit_log WHERE action = 'kill_criteria_evaluated'").all() as Array<{ target: string }>;
    expect(audit.some((a) => a.target.startsWith(`${projectId}:${runId}:no-such-procedure`))).toBe(true); // the empty evaluation is itself an audited act
  });
});

describe("recordKillCriteriaEvaluation — guards", () => {
  test("a non-member evaluator is rejected (FR-SEC-08), zero rows", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    expect(() => record(projectId, runId, "brownfield-dd", U3)).toThrow(new RegExp(`'${U3}' is not an active project_member`));
    expect(ledgerRows(runId)).toHaveLength(0);
  });

  test("an MNPI project rejects a member who is not on the insider list (FR-SEC-06); enrolled → accepted", () => {
    const projectId = insertMnpiProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    expect(() => record(projectId, runId)).toThrow(/insider/);
    expect(ledgerRows(runId)).toHaveLength(0);

    enrollInsider(projectId, U1);
    expect(record(projectId, runId).rowIds).toHaveLength(4);
  });

  test("an unknown run is rejected", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    insertRun(projectId);

    expect(() => record(projectId, "01NOSUCHRUN000000002")).toThrow(/run.*does not exist.*migration 0023/);
  });

  test("another project's run is rejected (a record cannot cross projects)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const otherProject = insertProject();
    const otherRun = insertRun(otherProject);

    expect(() => record(projectId, otherRun)).toThrow(/belongs to project.*cannot cross projects/);
    expect(ledgerRows(otherRun)).toHaveLength(0);
  });

  test("an empty evaluated_by is rejected — an evaluation without its actor is unauditable", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    expect(() => record(projectId, runId, "brownfield-dd", "")).toThrow(/evaluated_by is mandatory/);
  });
});

// ---------------------------------------------------------------------------
// getRecordedEvaluation — the gate-flow reader (ADR-0058 §1, 1.1.0)
// ---------------------------------------------------------------------------

describe("getRecordedEvaluation — the gate-impact summary", () => {
  test("a recorded ledger groups triggered rows by action, unassessed and false separately, with parsed predicates and anchors", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    insertSimulationWithBreach(projectId); // covenant → halt
    insertHypothesis(projectId, "jv");     // partner → mark_conditional (both partner vars present)
    insertPartner(projectId, { status: "contacted", dependency: "high" });
    const triggeredRun = insertRun(projectId);
    record(projectId, triggeredRun);

    const hit = getRecordedEvaluation({ runId: triggeredRun, projectId, actor: U1 }, db);
    expect(hit.status).toBe("recorded");
    expect(hit.scope).toBe("*");
    // Two halts now: covenant (D-M-RISK-2) + the six-validator completeness
    // count (ADR-0063/64 — nothing covered on this bare-dd run).
    expect(hit.halt).toHaveLength(2);
    expect(hit.halt.map((h) => h.criterion_id).sort()).toEqual([COVENANT, VALIDATORS].sort());
    expect(hit.halt[0].predicate).toHaveProperty("op"); // parsed from predicate_json, not a string
    expect(hit.halt.map((h) => h.policy_id).sort()).toEqual(["gd-0022-risk-thresholds", "gd-0024-class-c-decisions"].sort());
    expect(hit.mark_conditional).toHaveLength(1);
    expect(hit.mark_conditional[0].criterion_id).toBe(PARTNER);
    expect(hit.unassessed).toHaveLength(0);
    // cert-inferred tripwire is determinately FALSE on an API-only run —
    // recorded as auditable proof, not absence.
    expect(hit.evaluated_false.map((r) => r.criterion_id)).toEqual(["certification_transferability_computed_by_inference_not_confirmation"]);
    expect(hit.procedures).toEqual(["brownfield-dd"]);

    // The no-evidence run: covenant FALSE (auditable proof), partner UNASSESSED (caller decides)
    const quietProject = insertProject();
    grantMember(quietProject, U1);
    const quietRun = insertRun(quietProject);
    record(quietProject, quietRun);
    const quiet = getRecordedEvaluation({ runId: quietRun, projectId: quietProject, actor: U1 }, db);
    expect(quiet.halt.map((h) => h.criterion_id)).toEqual([VALIDATORS]);
    expect(quiet.unassessed.map((r) => r.criterion_id)).toEqual([PARTNER]);
    expect(quiet.evaluated_false.map((r) => r.criterion_id).sort()).toEqual([COVENANT, "certification_transferability_computed_by_inference_not_confirmation"].sort());
  });

  test("zero rows in the asked scope → status 'never_evaluated' — never an empty-looking pass (ADR-0049 at read time)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);
    record(projectId, runId, "brownfield-dd");

    const summary = getRecordedEvaluation({ runId, projectId, procedure: "greenfield-screening", actor: U1 }, db);
    expect(summary.status).toBe("never_evaluated");
    expect(summary.scope).toBe("greenfield-screening");
    expect(summary.procedures).toEqual([]);
    expect(summary.halt).toHaveLength(0); // all groups empty — but the STATUS is what the gate must record

    const recorded = getRecordedEvaluation({ runId, projectId, procedure: "brownfield-dd", actor: U1 }, db);
    expect(recorded.status).toBe("recorded");
  });

  test("the read is logged as a data_access row (action=read, scoped recordRef)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);
    record(projectId, runId);

    getRecordedEvaluation({ runId, projectId, procedure: "brownfield-dd", actor: U1 }, db);
    const reads = db.query("SELECT record_ref FROM data_access_log WHERE table_key = 'kill_criteria_evaluation' AND action = 'read'").all() as Array<{ record_ref: string }>;
    expect(reads.some((r) => r.record_ref === `${projectId}:${runId}:brownfield-dd`)).toBe(true);
  });
});

describe("getRecordedEvaluation — read guards (listVisibleProjects precedent)", () => {
  test("a non-member reader is rejected (FR-SEC-08)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);
    record(projectId, runId);

    expect(() => getRecordedEvaluation({ runId, projectId, actor: U3 }, db)).toThrow(new RegExp(`'${U3}' is not an active project_member`));
  });

  test("an MNPI project rejects a non-insider reader (FR-SEC-06); enrolled → readable", () => {
    const projectId = insertMnpiProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);
    enrollInsider(projectId, U1); // needed to record at all
    record(projectId, runId);

    const U4 = "user-004";
    db.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), U4, "analyst", "active", "salt", "hash", 1, NOW]);
    grantMember(projectId, U4); // member but NOT insider

    expect(() => getRecordedEvaluation({ runId, projectId, actor: U4 }, db)).toThrow(/insider/);
    expect(getRecordedEvaluation({ runId, projectId, actor: U1 }, db).status).toBe("recorded");
  });

  test("an unknown run and a cross-project run are rejected", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    expect(() => getRecordedEvaluation({ runId: "01NOSUCHRUN000000002", projectId, actor: U1 }, db)).toThrow(/run.*does not exist.*run-scoped/);

    const otherProject = insertProject();
    const otherRun = insertRun(otherProject);
    expect(() => getRecordedEvaluation({ runId: otherRun, projectId, actor: U1 }, db)).toThrow(/cannot be read across projects/);
  });

  test("an empty actor is rejected — a ledger read without its reader is unauditable", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);
    expect(() => getRecordedEvaluation({ runId, projectId, actor: "" }, db)).toThrow(/actor is mandatory/);
  });
});
