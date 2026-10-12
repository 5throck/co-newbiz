/**
 * Unit tests for db/repositories/venture-scorecard.repository.ts — the
 * ADR-0059 writer/readers behind migration 0024. Real scratch SQLite
 * through the FULL migration chain, seeded via raw SQL fixtures (the
 * kill-criteria.test.ts pattern). Covers: the record guards in order (run
 * scope, cycle immutability, membership/MNPI, measure cap, per-row
 * validation), the happy-path ledger + audit + data_access rows, the
 * project read (explicit cycle, latest-cycle fallback, guards), and the
 * portfolio rollup grouping (class rollup over both sections,
 * insufficient_evidence list, projectIds filter, provenance).
 */
import { test, describe, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  recordVentureScorecardCycle,
  getVentureScorecard,
  getPortfolioRollup,
  SCORECARD_MEASURE_CAP,
  type ScorecardRowInput,
  type RecordVentureScorecardInput,
} from "../../db/repositories/venture-scorecard.repository.ts";

const TEST_DB_PATH = "db/data/test-venture-scorecard.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
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
  db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)", [projectId, userId, "member", "admin", NOW, "test fixture basis"]);
}

function enrollInsider(projectId: string, userId: string): void {
  db.run("INSERT INTO insider_list (project_id, user_id, added_at, reason) VALUES (?,?,?,?)", [projectId, userId, NOW, "test fixture enrollment"]);
}

function insertRun(projectId: string): string {
  const id = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [id, projectId, `hash-${id.slice(-6)}`, U1, NOW]);
  return id;
}

function row(overrides: Partial<ScorecardRowInput> = {}): ScorecardRowInput {
  return {
    venture_class: "driving",
    section: "financial",
    measure_key: `measure-${ulid().slice(-8)}`,
    target_value: ">= 0pp",
    actual_value: "+3pp",
    status: "on_target",
    evidence_ref: "doc:cim-2026-001",
    observed_at: NOW,
    ...overrides,
  };
}

function record(
  projectId: string,
  runId: string,
  rows: ScorecardRowInput[],
  opts: { sourceProcedure?: string; reviewCycle?: string; actor?: string } = {},
) {
  const input: RecordVentureScorecardInput = {
    runId,
    projectId,
    sourceProcedure: (opts.sourceProcedure ?? "portfolio-venture-monitoring") as RecordVentureScorecardInput["sourceProcedure"],
    reviewCycle: opts.reviewCycle ?? "2026-Q4",
    rows,
    actor: opts.actor ?? U1,
    now: NOW,
  };
  return recordVentureScorecardCycle(input, db);
}

describe("recordVentureScorecardCycle — guards", () => {
  test("an unknown run is rejected", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    insertRun(projectId);

    expect(() => record(projectId, "01NOSUCHRUN000000002", [row()])).toThrow(/run.*does not exist.*migration 0024/);
  });

  test("another project's run is rejected (a record cannot cross projects)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const otherProject = insertProject();
    const otherRun = insertRun(otherProject);

    expect(() => record(projectId, otherRun, [row()])).toThrow(/belongs to project.*cannot cross projects/);
    expect(
      (db.query("SELECT COUNT(*) AS n FROM venture_scorecard WHERE run_id = ?").get(otherRun) as { n: number }).n,
    ).toBe(0);
  });

  test("a second record for the same project+procedure+cycle throws — even under a new run (ADR-0005 cycle immutability)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runA = insertRun(projectId);
    record(projectId, runA, [row()]);

    const runB = insertRun(projectId);
    expect(() => record(projectId, runB, [row()])).toThrow(/already has a recorded.*ADR-0005/);
    expect((db.query("SELECT COUNT(*) AS n FROM venture_scorecard WHERE project_id = ?").get(projectId) as { n: number }).n).toBe(1);
  });

  test("the same project+procedure under a DIFFERENT cycle is legal (trend-and-trigger, not one-shot)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runQ3 = insertRun(projectId);
    const runQ4 = insertRun(projectId);

    expect(() => record(projectId, runQ3, [row()], { reviewCycle: "2026-Q3" })).not.toThrow();
    expect(() => record(projectId, runQ4, [row()], { reviewCycle: "2026-Q4" })).not.toThrow();
  });

  test("a non-member recorder is rejected (FR-SEC-08), zero rows", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    expect(() => record(projectId, runId, [row()], { actor: U3 })).toThrow(new RegExp(`'${U3}' is not an active project_member`));
    expect((db.query("SELECT COUNT(*) AS n FROM venture_scorecard WHERE run_id = ?").get(runId) as { n: number }).n).toBe(0);
  });

  test("an MNPI project rejects a member not on the insider list (FR-SEC-06); enrolled → accepted", () => {
    const projectId = insertMnpiProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    expect(() => record(projectId, runId, [row()])).toThrow(/insider/);
    expect((db.query("SELECT COUNT(*) AS n FROM venture_scorecard WHERE run_id = ?").get(runId) as { n: number }).n).toBe(0);

    enrollInsider(projectId, U1);
    expect(record(projectId, runId, [row()]).rowCount).toBe(1);
  });

  test("a malformed review_cycle is rejected before any DB state is read", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    for (const bad of ["2026-Q5", "2026Q4", "26-Q4", "2026-Q0"]) {
      expect(() => record(projectId, runId, [row()], { reviewCycle: bad })).toThrow(/review_cycle.*YYYY-Q\[1-4\]/);
    }
  });

  test("a source_procedure outside the two producers is rejected", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    expect(() => record(projectId, runId, [row()], { sourceProcedure: "greenfield-screening" })).toThrow(/source_procedure.*outside the vocabulary/);
  });

  test("empty rows is rejected — an empty scorecard would silently pass for never-recorded", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    expect(() => record(projectId, runId, [])).toThrow(/rows is mandatory and non-empty/);
  });

  test("more than SCORECARD_MEASURE_CAP rows in one section throws (the 21st measure)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    const tooMany: ScorecardRowInput[] = [];
    for (let i = 0; i <= SCORECARD_MEASURE_CAP; i++) tooMany.push(row({ measure_key: `m${i}` }));
    expect(() => record(projectId, runId, tooMany)).toThrow(new RegExp(`exceeds the SCORECARD_MEASURE_CAP of ${SCORECARD_MEASURE_CAP}`));

    // Exactly the cap in financial PLUS more rows in strategic is legal — the
    // cap is per section, not per call (the rollup template's "per section family").
    const atCap: ScorecardRowInput[] = [];
    for (let i = 0; i < SCORECARD_MEASURE_CAP; i++) atCap.push(row({ measure_key: `f${i}` }));
    atCap.push(row({ section: "strategic", measure_key: "s0" }));
    expect(() => record(projectId, insertRun(projectId), atCap)).not.toThrow();
  });

  test("per-row validation: enums, measure identity, target rule, evidence vocabulary, observed_at", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    expect(() => record(projectId, runId, [row({ venture_class: "incubator" })])).toThrow(/venture_class.*outside the taxonomy/);
    expect(() => record(projectId, runId, [row({ section: "operational" as unknown as ScorecardRowInput["section"] })])).toThrow(/section.*financial.*strategic/);
    expect(() => record(projectId, runId, [row({ status: "green" as unknown as ScorecardRowInput["status"] })])).toThrow(/status.*on_target/);
    expect(() => record(projectId, runId, [row({ measure_key: "" })])).toThrow(/measure_key is mandatory/);
    expect(() => record(projectId, runId, [row({ target_value: null, status: "deviation" })])).toThrow(/without a target is invalid/);
    expect(() => record(projectId, runId, [row({ evidence_ref: "cim.pdf#p12" })])).toThrow(/not a resolvable citation/);
    expect(() => record(projectId, runId, [row({ observed_at: "" })])).toThrow(/observed_at.*ISO-shaped/);

    // A duplicate measure within one section gets a named error, not a raw
    // UNIQUE abort: the (run, procedure, section) key is constant per call.
    expect(() => record(projectId, runId, [row({ measure_key: "dup" }), row({ measure_key: "dup" })])).toThrow(/appears twice in section/);
  });

  test("target_value null with status insufficient_evidence is the legal escape", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    const { rowCount } = record(projectId, runId, [row({ target_value: null, actual_value: null, status: "insufficient_evidence", section: "strategic" })]);
    expect(rowCount).toBe(1);
  });
});

describe("recordVentureScorecardCycle — happy path", () => {
  test("writes the rows + one audit row + one data_access row, and returns the record summary", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    const rows = [
      row({ venture_class: "jv", section: "financial", measure_key: "irr_vs_hurdle", target_value: ">=0pp", actual_value: "+2pp", status: "on_target", evidence_ref: "src:KIS-2025" }),
      row({ section: "strategic", measure_key: "learning_to_product", target_value: null, actual_value: null, status: "insufficient_evidence", evidence_ref: "https://example.com/jv-health" }),
    ];
    const result = record(projectId, runId, rows);

    expect(result.rowIds).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.runId).toBe(runId);
    expect(result.projectId).toBe(projectId);
    expect(result.reviewCycle).toBe("2026-Q4");

    const stored = db.query("SELECT * FROM venture_scorecard WHERE run_id = ? ORDER BY section").all(runId) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(2);
    for (const r of stored) {
      expect(r.created_at).toBe(NOW);
      expect(r.source_procedure).toBe("portfolio-venture-monitoring");
      expect(r.review_cycle).toBe("2026-Q4");
    }
    expect(stored[0].measure_key).toBe("irr_vs_hurdle"); // financial sorts first
    expect(stored[0].venture_class).toBe("jv");
    expect(stored[0].target_value).toBe(">=0pp");
    expect(stored[1].target_value).toBeNull();
    expect(stored[1].status).toBe("insufficient_evidence");

    const audit = db.query("SELECT actor_user_id, target FROM audit_log WHERE action = 'venture_scorecard_recorded'").all() as Array<{ actor_user_id: string; target: string }>;
    expect(audit.some((a) => a.actor_user_id === U1 && a.target === `${projectId}:portfolio-venture-monitoring:2026-Q4 rows=2`)).toBe(true);

    const access = db.query("SELECT record_ref, action FROM data_access_log WHERE table_key = 'venture_scorecard'").all() as Array<{ record_ref: string; action: string }>;
    expect(access.some((a) => a.record_ref === `${projectId}:portfolio-venture-monitoring:2026-Q4` && a.action === "write")).toBe(true);
  });
});

describe("ADR-0164 — consecutive quarters on the SAME run (migration 0139 unique key)", () => {
  test("two consecutive quarters both store on one run; cycle guard stays per (project, procedure, cycle)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);

    record(projectId, runId, [row({ measure_key: "same-quarter-a" })], { reviewCycle: "2026-Q3" });
    // The SAME measure on the SAME run, next quarter — legal since 0139.
    record(projectId, runId, [row({ measure_key: "same-quarter-a" })], { reviewCycle: "2026-Q4" });
    // The same cycle again is still the immutable unit (repository guard, unchanged).
    expect(() => record(projectId, runId, [row({ measure_key: "same-quarter-a" })], { reviewCycle: "2026-Q4" }))
      .toThrow(/one record per project\+procedure\+cycle/);

    const cycles = (db.query("SELECT review_cycle, COUNT(*) n FROM venture_scorecard WHERE run_id = ? GROUP BY review_cycle ORDER BY review_cycle").all(runId) as Array<{ review_cycle: string; n: number }>);
    expect(cycles).toEqual([{ review_cycle: "2026-Q3", n: 1 }, { review_cycle: "2026-Q4", n: 1 }]);

    // Latest-cycle read resolves to Q4 only, ordered by cycle then measure.
    const latest = getVentureScorecard({ projectId, actor: U1 }, db);
    expect(latest).toHaveLength(1);
    expect(latest[0].review_cycle).toBe("2026-Q4");
  });

  test("greenfieldRampUpView + effectiveVentureClass resolve the LATEST cycle even when one run holds both quarters", async () => {
    const { greenfieldRampUpView, effectiveVentureClass } = await import("../../app/web-next/lib/greenfield-execution.ts");
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runId = insertRun(projectId);
    const opp = ulid();
    db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, "t", "테스트", "selected", U1, NOW]);
    db.run("INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), opp, "greenfield", null, "t", U1, NOW]);
    db.run("UPDATE md_project SET track = 'greenfield', source_opportunity_id = ? WHERE id = ?", [opp, projectId]);

    record(projectId, runId, [row({ measure_key: "ramp-view", venture_class: "driving" })], { reviewCycle: "2026-Q3" });
    record(projectId, runId, [row({ measure_key: "ramp-view", venture_class: "enabling" })], { reviewCycle: "2026-Q4" });

    expect(greenfieldRampUpView(projectId, db)!.review_cycle).toBe("2026-Q4");
    const view = greenfieldRampUpView(projectId, db)!;
    expect(view.measures.map((x: { venture_class: string }) => x.venture_class)).toEqual(["enabling"]);
    expect(effectiveVentureClass(projectId, db).effective).toBe("enabling");
  });
});

describe("getVentureScorecard — the project read", () => {
  test("explicit cycle returns that cycle's rows; latest-cycle fallback returns MAX(review_cycle) only", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);
    const runQ3 = insertRun(projectId);
    const runQ4 = insertRun(projectId);
    record(projectId, runQ3, [row({ measure_key: "q3-only" })], { reviewCycle: "2026-Q3" });
    record(projectId, runQ4, [row({ measure_key: "q4-a" }), row({ measure_key: "q4-b", section: "strategic" })], { reviewCycle: "2026-Q4" });

    const explicit = getVentureScorecard({ projectId, reviewCycle: "2026-Q3", actor: U1 }, db);
    expect(explicit.map((r) => r.measure_key)).toEqual(["q3-only"]);

    const latest = getVentureScorecard({ projectId, actor: U1 }, db);
    expect(latest).toHaveLength(2);
    expect(latest.every((r) => r.review_cycle === "2026-Q4")).toBe(true);

    const reads = db.query("SELECT record_ref FROM data_access_log WHERE table_key = 'venture_scorecard' AND action = 'read'").all() as Array<{ record_ref: string }>;
    expect(reads.some((r) => r.record_ref === `${projectId}:2026-Q3`)).toBe(true);
    expect(reads.some((r) => r.record_ref === `${projectId}:2026-Q4`)).toBe(true);
  });

  test("a project with no scorecard rows returns an empty array (member still guarded)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);

    expect(getVentureScorecard({ projectId, actor: U1 }, db)).toEqual([]);
  });

  test("a non-member reader is rejected (FR-SEC-08)", () => {
    const projectId = insertProject();
    grantMember(projectId, U1);

    expect(() => getVentureScorecard({ projectId, actor: U3 }, db)).toThrow(new RegExp(`'${U3}' is not an active project_member`));
  });

  test("an MNPI project rejects a non-insider reader (FR-SEC-06); the insider reads fine", () => {
    const projectId = insertMnpiProject();
    grantMember(projectId, U1);
    enrollInsider(projectId, U1);
    record(projectId, insertRun(projectId), [row()]);

    const U4 = "user-004";
    db.run("INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), U4, "analyst", "active", "salt", "hash", 1, NOW]);
    grantMember(projectId, U4); // member but NOT insider

    expect(() => getVentureScorecard({ projectId, actor: U4 }, db)).toThrow(/insider/);
    expect(getVentureScorecard({ projectId, actor: U1 }, db)).toHaveLength(1);
  });
});

describe("getPortfolioRollup — the E.4 portfolio view data core", () => {
  // Seed: projA (driving) — 2027-Q1: 1 financial on_target; 2027-Q2:
  // financial on_target + financial deviation + strategic
  // insufficient_evidence. projB (jv) — 2027-Q2: 1 financial on_target under
  // jv-lifecycle-governance (both producers share the rollup surface,
  // ADR-0059). The 2027 cycles are unique to this describe: the rollup is a
  // whole-table query, and earlier describes already wrote 2026-Q3/Q4 rows.
  let projA: string;
  let projB: string;
  let projectNoB: string;
  let runQ2A: string;
  let runQ2B: string;

  beforeAll(() => {
    projA = insertProject();
    grantMember(projA, U1);
    projB = insertProject();
    grantMember(projB, U1);
    projectNoB = (db.query("SELECT project_no FROM md_project WHERE id = ?").get(projB) as { project_no: string }).project_no;

    record(projA, insertRun(projA), [row({ measure_key: "a-q1-fin", venture_class: "driving" })], { reviewCycle: "2027-Q1" });

    runQ2A = insertRun(projA);
    record(projA, runQ2A, [
      row({ measure_key: "a-fin-on", venture_class: "driving", status: "on_target" }),
      row({ measure_key: "a-fin-dev", venture_class: "driving", status: "deviation" }),
      row({ measure_key: "a-str-ins", venture_class: "driving", section: "strategic", target_value: null, actual_value: null, status: "insufficient_evidence" }),
    ], { reviewCycle: "2027-Q2" });

    runQ2B = insertRun(projB);
    record(projB, runQ2B, [
      row({ measure_key: "b-fin-on", venture_class: "jv", status: "on_target", evidence_ref: "src:KIS-2025" }),
    ], { reviewCycle: "2027-Q2", sourceProcedure: "jv-lifecycle-governance" });
  });

  test("latest-cycle resolution groups both producers' 2027-Q2 rows: sections, class rollup, exception list, provenance", () => {
    const rollup = getPortfolioRollup({}, db);

    expect(rollup.review_cycle).toBe("2027-Q2"); // MAX over the whole table — the 2026 rows of earlier describes sort lower
    expect(rollup.resolved_from).toBe("latest");

    expect(rollup.financial.map((r) => r.measure_key).sort()).toEqual(["a-fin-dev", "a-fin-on", "b-fin-on"]);
    expect(rollup.strategic.map((r) => r.measure_key)).toEqual(["a-str-ins"]);

    // Class rollup over BOTH sections; ventures counts distinct projects;
    // taxonomy order (driving before jv).
    expect(rollup.class_rollup).toEqual([
      { venture_class: "driving", ventures: 1, measures: 3, on_target: 1, deviation: 1, insufficient_evidence: 1 },
      { venture_class: "jv", ventures: 1, measures: 1, on_target: 1, deviation: 0, insufficient_evidence: 0 },
    ]);

    expect(rollup.insufficient_evidence).toEqual([{ project_id: projA, section: "strategic", measure_key: "a-str-ins" }]);

    expect(rollup.provenance.runs.sort()).toEqual([runQ2A, runQ2B].sort());
    expect(rollup.provenance.review_cycles_available).toContain("2027-Q1");
    expect(rollup.provenance.review_cycles_available).toContain("2027-Q2");

    // The JOIN carries project_no for the rollup's venture identification.
    const bRow = rollup.financial.find((r) => r.measure_key === "b-fin-on");
    expect(bRow?.project_no).toBe(projectNoB);
    expect(bRow?.source_procedure).toBe("jv-lifecycle-governance");
  });

  test("explicit cycle returns that cycle only", () => {
    const rollup = getPortfolioRollup({ reviewCycle: "2027-Q1" }, db);

    expect(rollup.review_cycle).toBe("2027-Q1");
    expect(rollup.resolved_from).toBe("explicit");
    expect(rollup.financial.map((r) => r.measure_key)).toEqual(["a-q1-fin"]);
    expect(rollup.strategic).toEqual([]);
    expect(rollup.class_rollup).toEqual([
      { venture_class: "driving", ventures: 1, measures: 1, on_target: 1, deviation: 0, insufficient_evidence: 0 },
    ]);
    // Available cycles are NOT cycle-filtered — the axis stays navigable.
    expect(rollup.provenance.review_cycles_available).toContain("2027-Q2");
  });

  test("projectIds filter scopes rows AND latest-cycle resolution AND available cycles", () => {
    const rollup = getPortfolioRollup({ projectIds: [projB] }, db);

    expect(rollup.review_cycle).toBe("2027-Q2"); // B's own latest (its only cycle)
    expect(rollup.financial.map((r) => r.measure_key)).toEqual(["b-fin-on"]);
    expect(rollup.class_rollup).toEqual([
      { venture_class: "jv", ventures: 1, measures: 1, on_target: 1, deviation: 0, insufficient_evidence: 0 },
    ]);
    expect(rollup.provenance.review_cycles_available).toEqual(["2027-Q2"]);
  });

  test("an explicit cycle with no rows is a valid empty rollup, not an error", () => {
    const rollup = getPortfolioRollup({ reviewCycle: "2020-Q1" }, db);
    expect(rollup.review_cycle).toBe("2020-Q1");
    expect(rollup.resolved_from).toBe("explicit");
    expect(rollup.financial).toEqual([]);
    expect(rollup.class_rollup).toEqual([]);
  });
});
