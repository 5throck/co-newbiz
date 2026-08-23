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

function snapshotCount(runId: string): number {
  return (db.query("SELECT COUNT(*) AS n FROM project_variable_snapshot WHERE run_id = ?").get(runId) as { n: number }).n;
}

const COVENANT = "covenant_breach_with_coc_acceleration_under_downside";
const PARTNER = "partner_dependency_unconfirmed_and_no_alternative";

describe("covenant halt — D-M-RISK-2 / AI-1", () => {
  test("a breached covenant test in the latest simulation triggers the halt", () => {
    const projectId = insertProject();
    insertSimulationWithBreach(projectId); // sim + one breached test on its own run
    const runId = insertRun(projectId);

    const result = evaluate(projectId, runId);

    // The activated set of this PR: covenant + partner. (A registry gaining a
    // new enabled entry changes observable behavior — this line updates with it.)
    expect(result.evaluated).toBe(2);
    expect(result.inert).toBe(2); // the two predicate-null halts of brownfield-dd

    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0].criterion_id).toBe(COVENANT);
    expect(result.triggered[0].action).toBe("halt");

    // Partner half: no deal_structure_hypothesis recorded → both partner vars
    // missing → UNASSESSED — listed, never a silent pass.
    expect(result.unassessed).toEqual([PARTNER]);
  });

  test("no simulation and no debt → covenants_breached present 0 → determinately NOT triggered", () => {
    const projectId = insertProject();
    const runId = insertRun(projectId);

    const result = evaluate(projectId, runId);

    expect(result.triggered).toHaveLength(0);
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

    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0].criterion_id).toBe(PARTNER);
    expect(result.triggered[0].action).toBe("mark_conditional");
    expect(result.unassessed).toEqual([]);
  });

  test("two active candidates → 'no alternative' is false → conjunction false, no trigger", () => {
    const projectId = insertProject();
    insertHypothesis(projectId, "jv");
    insertPartner(projectId, { status: "contacted", dependency: "high" });
    insertPartner(projectId, { status: "in_negotiation", dependency: "low" });
    const runId = insertRun(projectId);

    const result = evaluate(projectId, runId);
    expect(result.triggered).toHaveLength(0);
    expect(result.unassessed).toEqual([]);
  });

  test("non-JV vehicle → dependency determinately 'none' → in-predicate false, no trigger", () => {
    const projectId = insertProject();
    insertHypothesis(projectId, "direct"); // vehicle ≠ null and ≠ jv → dependency "none"
    insertPartner(projectId, { status: "contacted", dependency: "high" });
    const runId = insertRun(projectId);

    const result = evaluate(projectId, runId);
    expect(result.triggered).toHaveLength(0);
    expect(result.unassessed).toEqual([]);
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

    expect(result.triggered).toHaveLength(1);
    expect(rowIds).toHaveLength(2); // covenant (triggered) + partner (unassessed) — the COMPLETE ledger, false included

    const rows = ledgerRows(runId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.policy_id).toBe("gd-0022-risk-thresholds"); // anchors snapshotted (ADR-0005)
      expect(String(row.thresholds_source)).toContain("risk-thresholds.md");
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
    expect(audit.some((a) => a.target.startsWith(`${projectId}:${runId}:brownfield-dd`) && a.target.includes("evaluated=2") && a.target.endsWith(":HALT-PATH"))).toBe(true);
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
    expect(ledgerRows(runId)).toHaveLength(2); // exactly the first record's rows
  });

  test("read-only evaluate still works on a recorded run (re-check without re-recording)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);
    record(projectId, runId);

    const recheck = evaluate(projectId, runId); // no throw — the ledger is append-only, the evaluator is pure
    expect(recheck.evaluated).toBe(2);
    expect(ledgerRows(runId)).toHaveLength(2);
  });

  test("a procedure with no enabled entries records zero rows — and still writes the audit trail", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    const { rowIds } = record(projectId, runId, "greenfield-screening"); // registry has no such files

    expect(rowIds).toHaveLength(0);
    expect(ledgerRows(runId)).toHaveLength(0);
    const audit = db.query("SELECT target FROM audit_log WHERE action = 'kill_criteria_evaluated'").all() as Array<{ target: string }>;
    expect(audit.some((a) => a.target.startsWith(`${projectId}:${runId}:greenfield-screening`))).toBe(true); // the empty evaluation is itself an audited act
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
    expect(record(projectId, runId).rowIds).toHaveLength(2);
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
    expect(hit.halt).toHaveLength(1);
    expect(hit.halt[0].criterion_id).toBe(COVENANT);
    expect(hit.halt[0].predicate).toHaveProperty("op"); // parsed from predicate_json, not a string
    expect(hit.halt[0].policy_id).toBe("gd-0022-risk-thresholds");
    expect(hit.mark_conditional).toHaveLength(1);
    expect(hit.mark_conditional[0].criterion_id).toBe(PARTNER);
    expect(hit.unassessed).toHaveLength(0);
    expect(hit.evaluated_false).toHaveLength(0);
    expect(hit.procedures).toEqual(["brownfield-dd"]);

    // The no-evidence run: covenant FALSE (auditable proof), partner UNASSESSED (caller decides)
    const quietProject = insertProject();
    grantMember(quietProject, U1);
    const quietRun = insertRun(quietProject);
    record(quietProject, quietRun);
    const quiet = getRecordedEvaluation({ runId: quietRun, projectId: quietProject, actor: U1 }, db);
    expect(quiet.halt).toHaveLength(0);
    expect(quiet.unassessed.map((r) => r.criterion_id)).toEqual([PARTNER]);
    expect(quiet.evaluated_false.map((r) => r.criterion_id)).toEqual([COVENANT]);
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
