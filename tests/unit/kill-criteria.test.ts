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
import { assessRulesForRun } from "../../db/lib/rule-assessment.ts";

const TEST_DB_PATH = "db/data/test-kill-criteria.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const EVALUATED_AT = "2026-08-23T10:00:00Z";
const U1 = "user-001";

type Db = ReturnType<typeof GetDb>;
let db: Db;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);
  db.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), U1, "analyst", "active", "salt", "hash", 1, NOW]);
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
