/**
 * Unit tests for db/lib/snapshot-filler.ts — the project_variable_snapshot
 * filler implementing the thresholds records' var contracts:
 *   docs/decisions/market-thresholds.md          D-M-MKT-3 / -5 / -6 / -2
 *   docs/decisions/risk-thresholds.md            D-M-RISK-5
 *   docs/decisions/technical-execution-thresholds.md D-M-TE-8 ("Filler
 *   semantics pinned")
 * Real scratch SQLite (the migration-0017/0019 pattern) so FK/CHECK behavior
 * and the 0020 max_age gate are exercised by SQLite itself, not mocked.
 *
 * Coverage per family: happy path, empty-table → missing, r2 < 0.6 →
 * low_confidence WITH the value written, NULL r2 → missing, arg-max HHI tie
 * handling, DAG longest path with NULL statutory_days, and the reviewed_by
 * gate on asserted vars. Since ADR-0054/migration 0021: binding-driven fact
 * resolution (live project_industry rows as the default set, the multi-
 * industry conservative rule reachable via bindings, and the industryIds
 * UNION semantics). Fixed clock literals throughout (ADR-0002 spirit).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { fillSnapshot, SNAPSHOT_VAR_KEYS } from "../../db/lib/snapshot-filler.ts";

const TEST_DB_PATH = "db/data/test-snapshot-filler.sqlite";
const NOW = "2026-08-23T00:00:00.000Z";
const FILL_NOW = new Date("2026-08-23T10:00:00Z");
const FILL_NOW_MS = FILL_NOW.getTime();
const U1 = "user-001";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let industryA: string;
let industryB: string;
let sourceA: string; // md_source carrying code "KIS-2025"

// ---------------------------------------------------------------------------
// Fixtures
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
    // Windows occasionally lags the handle release just past close(); the
    // artifact is throwaway and beforeAll removes any leftover next run
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

function insertIndustry(): string {
  const id = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [id, `30${id.slice(-3)}`, "테스트 업종", "Test industry", NOW]);
  return id;
}

function insertPeriod(type: "year" | "quarter", endDate: string, fiscalYear: number): string {
  const id = ulid();
  db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", [id, type, endDate, endDate, fiscalYear, NOW]);
  return id;
}

function endDaysAgo(days: number): string {
  return new Date(FILL_NOW_MS - days * 86_400_000).toISOString();
}

function insertFact(industryId: string, periodId: string, metricKey: string, value: number, opts: { revisionNo?: number; sourceId?: string | null } = {}): void {
  db.run("INSERT INTO fact_industry (id, industry_id, period_id, metric_key, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)", [
    ulid(), industryId, periodId, metricKey, value, opts.revisionNo ?? 1, opts.sourceId === undefined ? sourceA : opts.sourceId, NOW,
  ]);
}

/** ADR-0054 / migration 0021: bind an industry to a project. bornSupersededBy seeds a NON-live successor (the flip pattern). */
function bindIndustry(projectId: string, industryId: string, opts: { bornSupersededBy?: string } = {}): string {
  const id = ulid();
  db.run("INSERT INTO project_industry (id, project_id, industry_id, bound_by, bound_at, rationale, superseded_by) VALUES (?,?,?,?,?,?,?)", [
    id, projectId, industryId, U1, NOW, "test binding rationale", opts.bornSupersededBy ?? null,
  ]);
  return id;
}

/** Supersede a binding the way the repository flip pattern does: successor born non-live, then the pointers swap. */
function supersedeBinding(oldId: string, projectId: string, industryId: string): string {
  const successor = bindIndustry(projectId, industryId, { bornSupersededBy: oldId });
  db.run("UPDATE project_industry SET superseded_by = ? WHERE id = ?", [successor, oldId]);
  db.run("UPDATE project_industry SET superseded_by = NULL WHERE id = ?", [successor]);
  return successor;
}

function insertLink(projectId: string, opts: { hhi?: number | null; grade?: string | null; r2?: number | null; assessedAt?: string } = {}): string {
  const id = ulid();
  db.run(
    "INSERT INTO value_chain_link (id, project_id, from_industry_id, to_industry_id, direction, concentration_hhi, switching_cost_grade, r2, assessed_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, projectId, industryA, industryB, "upstream", opts.hhi ?? null, opts.grade ?? null, opts.r2 ?? null, opts.assessedAt ?? NOW],
  );
  return id;
}

function insertAssertion(projectId: string, varKey: string, kind: "num" | "text", value: number | string, opts: { reviewed?: boolean } = {}): string {
  const runId = insertRun(projectId);
  const id = ulid();
  db.run(
    "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, value_num, evidence_ref, asserted_by, reviewed_by, rationale, observed_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id, runId, projectId, varKey, kind,
      kind === "text" ? String(value) : null,
      kind === "num" ? Number(value) : null,
      "doc://test-evidence", U1, opts.reviewed === false ? null : U1, "test rationale", NOW, null,
    ],
  );
  return id;
}

function insertDdFinding(projectId: string, opts: { trl?: string | null; ip?: string | null } = {}): void {
  db.run("INSERT INTO dd_finding (id, project_id, category, description, trl_grade, ip_ownership_status, created_at) VALUES (?,?,?,?,?,?,?)", [
    ulid(), projectId, "technical", "Test finding", opts.trl ?? null, opts.ip ?? null, NOW,
  ]);
}

function insertCert(projectId: string, opts: { transferableOnCoc?: string | null; basis?: string | null; loadBearing?: number } = {}): void {
  db.run("INSERT INTO certification (id, project_id, name, transferable_on_coc, transferability_basis, load_bearing) VALUES (?,?,?,?,?,?)", [
    ulid(), projectId, "ISO 9001", opts.transferableOnCoc ?? null, opts.basis ?? null, opts.loadBearing ?? 0,
  ]);
}

function insertPermit(projectId: string, opts: { days?: number | null; status?: string } = {}): string {
  const id = ulid();
  db.run("INSERT INTO permit (id, project_id, name, statutory_days, status) VALUES (?,?,?,?,?)", [id, projectId, "Permit", opts.days ?? null, opts.status ?? "not_started"]);
  return id;
}

function insertEdge(from: string, to: string): void {
  db.run("INSERT INTO permit_edge (from_permit_id, to_permit_id) VALUES (?,?)", [from, to]);
}

function insertContingent(projectId: string, probability: number, amountExpected: number): void {
  db.run("INSERT INTO contingent_liability (id, project_id, category, probability, amount_low, amount_expected, amount_high, expected_timing_year) VALUES (?,?,?,?,?,?,?,?)", [
    ulid(), projectId, "litigation", probability, amountExpected, amountExpected, amountExpected, 0,
  ]);
}

function insertSimulation(projectId: string, createdAt: string): string {
  const runId = insertRun(projectId);
  const id = ulid();
  db.run("INSERT INTO simulation (id, run_id, seed, iterations, discount_rate, created_at) VALUES (?,?,?,?,?,?)", [id, runId, 42, 100, 0.08, createdAt]);
  return id;
}

function insertCovenantTest(simulationId: string, key: string, breached: 0 | 1): void {
  db.run("INSERT INTO covenant_test (simulation_id, period_id, covenant_key, threshold, projected_value, breached) VALUES (?,?,?,?,?,?)", [simulationId, "p1", key, 1.25, breached === 1 ? 1.0 : 1.5, breached]);
}

function insertPartner(projectId: string, opts: { status?: string; dependency?: string | null } = {}): void {
  db.run("INSERT INTO partner_candidate (id, project_id, name, partner_type, dependency_risk, status) VALUES (?,?,?,?,?,?)", [
    ulid(), projectId, "Acme", "supplier", opts.dependency ?? null, opts.status ?? "sourcing",
  ]);
}

function insertHypothesis(projectId: string, opts: { vehicle?: string | null; hypothesizedAt?: string } = {}): void {
  db.run("INSERT INTO deal_structure_hypothesis (id, project_id, vehicle, hypothesized_by, hypothesized_at, rationale) VALUES (?,?,?,?,?,?)", [
    ulid(), projectId, opts.vehicle ?? null, U1, opts.hypothesizedAt ?? NOW, "test rationale",
  ]);
}

function insertCoveragePass(projectId: string): void {
  db.run("INSERT INTO compliance_check (id, project_id, gate, rule_key, layer, result, detail, detected_at) VALUES (?,?,?,?,?,?,?,?)", [
    ulid(), projectId, "DD", "ma-validator-contingent-liability", "procedure", "pass", "contingent-liability pass", NOW,
  ]);
}

interface SnapshotRow {
  var_key: string;
  value_num: number | null;
  value_text: string | null;
  evidence_ref: string | null;
  observed_at: string | null;
  status: string;
}

function snap(runId: string, varKey: string): SnapshotRow {
  return db
    .query("SELECT var_key, value_num, value_text, evidence_ref, observed_at, status FROM project_variable_snapshot WHERE run_id = ? AND var_key = ?")
    .get(runId, varKey) as never;
}

function fill(projectId: string, runId: string, opts: { industryIds?: string[] } = {}): void {
  fillSnapshot({ runId, projectId, now: FILL_NOW, industryIds: opts.industryIds }, db);
}

// ---------------------------------------------------------------------------
// Family A — fact_industry (D-M-MKT-3)
// ---------------------------------------------------------------------------

describe("fact family — D-M-MKT-3", () => {
  // Each test binds a FRESH industry: fact_industry rows are keyed by industry
  // (not project), so a shared industry would leak rows across tests.
  test("latest annual period wins; quarters excluded; highest revision wins; evidence_ref carried", () => {
    const pid = insertProject();
    const ind = insertIndustry();
    const y2024 = insertPeriod("year", "2024-12-31T00:00:00.000Z", 2024);
    const y2025 = insertPeriod("year", "2025-12-31T00:00:00.000Z", 2025);
    const q4 = insertPeriod("quarter", "2025-12-31T00:00:00.000Z", 2025); // same end date, NOT annual → excluded
    insertFact(ind, y2024, "market_tam_krw", 100e12);
    insertFact(ind, y2025, "market_tam_krw", 120e12, { revisionNo: 1 });
    insertFact(ind, y2025, "market_tam_krw", 125e12, { revisionNo: 2 });
    insertFact(ind, q4, "market_tam_krw", 999e12);
    insertFact(ind, y2025, "market_growth_yoy_ratio", 0.07);
    insertFact(ind, y2025, "market_top3_share_ratio", 0.55);

    const runId = insertRun(pid);
    fill(pid, runId, { industryIds: [ind] });

    const tam = snap(runId, "market.tam");
    expect(tam.status).toBe("present");
    expect(tam.value_num).toBe(125e12);
    expect(tam.evidence_ref).toBe("KIS-2025");
    expect(tam.observed_at).toBe("2025-12-31T00:00:00.000Z");
    expect(snap(runId, "market.growth_rate")).toMatchObject({ status: "present", value_num: 0.07 });
    expect(snap(runId, "market.top3_share")).toMatchObject({ status: "present", value_num: 0.55 });
  });

  test("staleness per evidence_var.max_age_days (730, migration 0020): 731 days old → stale with value written; exactly 730 → present", () => {
    const staleInd = insertIndustry();
    const stalePid = insertProject();
    const y731 = insertPeriod("year", endDaysAgo(731), 2024);
    insertFact(staleInd, y731, "market_tam_krw", 90e12);
    const staleRun = insertRun(stalePid);
    fill(stalePid, staleRun, { industryIds: [staleInd] });
    const stale = snap(staleRun, "market.tam");
    expect(stale.status).toBe("stale");
    expect(stale.value_num).toBe(90e12); // value still written — age, not absence
    expect(stale.evidence_ref).toBe("KIS-2025");

    const boundaryInd = insertIndustry();
    const boundaryPid = insertProject();
    const y730 = insertPeriod("year", endDaysAgo(730), 2024);
    insertFact(boundaryInd, y730, "market_tam_krw", 91e12);
    const boundaryRun = insertRun(boundaryPid);
    fill(boundaryPid, boundaryRun, { industryIds: [boundaryInd] });
    expect(snap(boundaryRun, "market.tam").status).toBe("present");
  });

  test("non-null value WITHOUT evidence_ref → missing (Pre-FS strictness, applied unconditionally)", () => {
    const pid = insertProject();
    const ind = insertIndustry();
    const y = insertPeriod("year", endDaysAgo(100), 2026);
    insertFact(ind, y, "market_tam_krw", 80e12, { sourceId: null });
    const runId = insertRun(pid);
    fill(pid, runId, { industryIds: [ind] });
    const tam = snap(runId, "market.tam");
    expect(tam.status).toBe("missing");
    expect(tam.value_num).toBe(80e12); // the value exists and is recorded — the missing status is the evidence verdict
    expect(tam.evidence_ref).toBeNull();
  });

  test("no binding rows and no industryIds → fail-closed missing (absence is never guessed, ADR-0054)", () => {
    const pid = insertProject();
    const ind = insertIndustry();
    const y = insertPeriod("year", endDaysAgo(100), 2026);
    insertFact(ind, y, "market_tam_krw", 80e12);
    const runId = insertRun(pid);
    fill(pid, runId); // no industryIds, no project_industry rows
    expect(snap(runId, "market.tam").status).toBe("missing");
    expect(snap(runId, "market.tam").value_num).toBeNull();
  });

  test("two industries both carrying rows → ambiguous, missing (no decided aggregation)", () => {
    const pid = insertProject();
    const indA = insertIndustry();
    const indB = insertIndustry();
    const y = insertPeriod("year", endDaysAgo(100), 2026);
    insertFact(indA, y, "market_tam_krw", 80e12);
    insertFact(indB, y, "market_tam_krw", 70e12);
    const runId = insertRun(pid);
    fill(pid, runId, { industryIds: [indA, indB] });
    expect(snap(runId, "market.tam").status).toBe("missing");
  });

  test("quarter-only facts → missing (annual resolution finds nothing)", () => {
    const pid = insertProject();
    const ind = insertIndustry();
    const q = insertPeriod("quarter", endDaysAgo(30), 2026);
    insertFact(ind, q, "market_tam_krw", 60e12);
    const runId = insertRun(pid);
    fill(pid, runId, { industryIds: [ind] });
    expect(snap(runId, "market.tam").status).toBe("missing");
  });

  test("no annual facts for the bound industry → missing", () => {
    const pid = insertProject();
    const ind = insertIndustry();
    const runId = insertRun(pid);
    fill(pid, runId, { industryIds: [ind] });
    expect(snap(runId, "market.tam").status).toBe("missing");
    expect(snap(runId, "market.growth_rate").status).toBe("missing");
    expect(snap(runId, "market.top3_share").status).toBe("missing");
  });
});

// ---------------------------------------------------------------------------
// Family A — binding-driven resolution (ADR-0054 / migration 0021)
// ---------------------------------------------------------------------------

describe("fact family — project_industry binding (ADR-0054)", () => {
  test("a single live binding resolves the three fact vars — no industryIds option needed", () => {
    const pid = insertProject();
    const ind = insertIndustry();
    bindIndustry(pid, ind);
    const y = insertPeriod("year", endDaysAgo(100), 2026);
    insertFact(ind, y, "market_tam_krw", 88e12);
    insertFact(ind, y, "market_growth_yoy_ratio", 0.04);
    insertFact(ind, y, "market_top3_share_ratio", 0.61);
    const runId = insertRun(pid);
    fill(pid, runId); // no industryIds — the binding is the default set
    expect(snap(runId, "market.tam")).toMatchObject({ status: "present", value_num: 88e12, evidence_ref: "KIS-2025" });
    expect(snap(runId, "market.growth_rate")).toMatchObject({ status: "present", value_num: 0.04 });
    expect(snap(runId, "market.top3_share")).toMatchObject({ status: "present", value_num: 0.61 });
  });

  test("two live bindings → fact vars missing (the conservative multi-industry rule, reachable via bindings)", () => {
    const pid = insertProject();
    const indA = insertIndustry();
    const indB = insertIndustry();
    bindIndustry(pid, indA);
    bindIndustry(pid, indB); // DISTINCT live industry — legal at write time (0021)
    const y = insertPeriod("year", endDaysAgo(100), 2026);
    insertFact(indA, y, "market_tam_krw", 80e12);
    insertFact(indB, y, "market_tam_krw", 70e12);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.tam").status).toBe("missing");
    expect(snap(runId, "market.growth_rate").status).toBe("missing");
    expect(snap(runId, "market.top3_share").status).toBe("missing");
  });

  test("only LIVE rows count — retiring one of two bindings restores single-industry resolution", () => {
    const pid = insertProject();
    const indA = insertIndustry();
    const indB = insertIndustry();
    bindIndustry(pid, indA);
    const bindB = bindIndustry(pid, indB);
    const y = insertPeriod("year", endDaysAgo(100), 2026);
    insertFact(indA, y, "market_tam_krw", 80e12);
    insertFact(indB, y, "market_tam_krw", 70e12);
    // Retire B from the live set. The exact repository write for unbinding is
    // deliberately undecided (ADR-0054 leaves it to the writer PR); the schema
    // primitive is "superseded_by IS NOT NULL leaves the live set", so this
    // test uses the flip pattern WITHOUT the go-live step: B and its successor
    // point at each other, both non-live, history preserved either way.
    const retireB = bindIndustry(pid, indB, { bornSupersededBy: bindB });
    db.run("UPDATE project_industry SET superseded_by = ? WHERE id = ?", [retireB, bindB]);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.tam")).toMatchObject({ status: "present", value_num: 80e12 });
  });

  test("industryIds UNIONS with the binding — a duplicate set stays single-industry and resolves", () => {
    const pid = insertProject();
    const ind = insertIndustry();
    bindIndustry(pid, ind);
    const y = insertPeriod("year", endDaysAgo(100), 2026);
    insertFact(ind, y, "market_tam_krw", 80e12);
    const runId = insertRun(pid);
    fill(pid, runId, { industryIds: [ind] }); // the same industry, supplied twice (bound + param)
    expect(snap(runId, "market.tam")).toMatchObject({ status: "present", value_num: 80e12 });
  });

  test("industryIds UNIONS with the binding — a distinct param industry makes it two → missing", () => {
    const pid = insertProject();
    const bound = insertIndustry();
    const param = insertIndustry();
    bindIndustry(pid, bound);
    const y = insertPeriod("year", endDaysAgo(100), 2026);
    insertFact(bound, y, "market_tam_krw", 80e12);
    insertFact(param, y, "market_tam_krw", 70e12);
    const runId = insertRun(pid);
    fill(pid, runId, { industryIds: [param] }); // supplements, does not replace
    expect(snap(runId, "market.tam").status).toBe("missing");
  });

  test("re-binding via the repository flip pattern keeps the industry live (the successor carries it)", () => {
    const pid = insertProject();
    const ind = insertIndustry();
    const original = bindIndustry(pid, ind);
    const y = insertPeriod("year", endDaysAgo(100), 2026);
    insertFact(ind, y, "market_tam_krw", 80e12);
    supersedeBinding(original, pid, ind); // one live successor, one history row
    const live = db.query("SELECT COUNT(*) AS n FROM project_industry WHERE project_id = ? AND industry_id = ? AND superseded_by IS NULL").get(pid, ind) as { n: number };
    expect(live.n).toBe(1);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.tam")).toMatchObject({ status: "present", value_num: 80e12 });
  });
});

// ---------------------------------------------------------------------------
// Family B — value_chain_link (D-M-MKT-5 / -6 / -2)
// ---------------------------------------------------------------------------

describe("value chain family — D-M-MKT-5/-6", () => {
  test("no links → all three missing", () => {
    const pid = insertProject();
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.bargaining_power_hhi").status).toBe("missing");
    expect(snap(runId, "market.link_fit_quality").status).toBe("missing");
    expect(snap(runId, "market.switching_cost_grade").status).toBe("missing");
  });

  test("all r2 NULL → nothing derives; all three missing", () => {
    const pid = insertProject();
    insertLink(pid, { hhi: 0.9, grade: "high" }); // r2 NULL → contributes nothing
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.bargaining_power_hhi").status).toBe("missing");
    expect(snap(runId, "market.link_fit_quality").status).toBe("missing");
    expect(snap(runId, "market.switching_cost_grade").status).toBe("missing");
  });

  test("trusted links → MAX hhi present, fit present, worst (lowest) switching grade present", () => {
    const pid = insertProject();
    insertLink(pid, { hhi: 0.3, grade: "high", r2: 0.8 });
    insertLink(pid, { hhi: 0.2, grade: "moderate", r2: 0.7 });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.bargaining_power_hhi")).toMatchObject({ status: "present", value_num: 0.3 });
    expect(snap(runId, "market.link_fit_quality")).toMatchObject({ status: "present", value_num: 0.8 });
    // worst = weakest lock-in = lowest ordinal → moderate, trusted (r2 0.7 ≥ 0.6)
    expect(snap(runId, "market.switching_cost_grade")).toMatchObject({ status: "present", value_text: "moderate" });
  });

  test("r2 < 0.6 → hhi low_confidence WITH value written; fit still present, truthfully below 0.6", () => {
    const pid = insertProject();
    insertLink(pid, { hhi: 0.4, r2: 0.5 });
    const runId = insertRun(pid);
    fill(pid, runId);
    const hhi = snap(runId, "market.bargaining_power_hhi");
    expect(hhi.status).toBe("low_confidence");
    expect(hhi.value_num).toBe(0.4); // excluded by status, not by deletion
    expect(snap(runId, "market.link_fit_quality")).toMatchObject({ status: "present", value_num: 0.5 });
  });

  test("arg-max tie on HHI → fit takes the MIN r2 among tied links (conservative)", () => {
    const pid = insertProject();
    insertLink(pid, { hhi: 0.4, r2: 0.9 });
    insertLink(pid, { hhi: 0.4, r2: 0.5 });
    insertLink(pid, { hhi: 0.3, r2: 0.99 }); // not arg-max — excluded
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.bargaining_power_hhi")).toMatchObject({ status: "low_confidence", value_num: 0.4 });
    expect(snap(runId, "market.link_fit_quality")).toMatchObject({ status: "present", value_num: 0.5 });
  });

  test("a NULL-r2 link carrying the highest HHI is invisible to the MAX", () => {
    const pid = insertProject();
    insertLink(pid, { hhi: 0.9, r2: null });
    insertLink(pid, { hhi: 0.4, r2: 0.8 });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.bargaining_power_hhi")).toMatchObject({ status: "present", value_num: 0.4 });
  });

  test("grade carried only by NULL-r2 links → switching missing (nothing derives from it)", () => {
    const pid = insertProject();
    insertLink(pid, { hhi: 0.4, r2: 0.8 }); // no grade
    insertLink(pid, { grade: "negligible", r2: null }); // grade but NULL r2
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.switching_cost_grade").status).toBe("missing");
  });

  test("worst grade appearing only on sub-0.6 links → low_confidence with value; trusted elsewhere → present", () => {
    const lowConfPid = insertProject();
    insertLink(lowConfPid, { grade: "high", r2: 0.9 });
    insertLink(lowConfPid, { grade: "low", r2: 0.5 }); // worst ordinal, only carrier is sub-floor
    const lowConfRun = insertRun(lowConfPid);
    fill(lowConfPid, lowConfRun);
    expect(snap(lowConfRun, "market.switching_cost_grade")).toMatchObject({ status: "low_confidence", value_text: "low" });

    const presentPid = insertProject();
    insertLink(presentPid, { grade: "low", r2: 0.9 }); // worst ordinal on a trusted link
    insertLink(presentPid, { grade: "high", r2: 0.5 });
    const presentRun = insertRun(presentPid);
    fill(presentPid, presentRun);
    expect(snap(presentRun, "market.switching_cost_grade")).toMatchObject({ status: "present", value_text: "low" });
  });
});

// ---------------------------------------------------------------------------
// Family C — asserted dimension_input (reviewed_by gate)
// ---------------------------------------------------------------------------

describe("asserted family — live + reviewed only", () => {
  test("live reviewed assertions → present, typed per the registry, evidence carried", () => {
    const pid = insertProject();
    insertAssertion(pid, "market.entry_barrier", "text", "moderate");
    insertAssertion(pid, "right_to_win.customer_overlap", "num", 4);
    insertAssertion(pid, "right_to_win.tech_overlap", "num", 3);
    insertAssertion(pid, "right_to_win.brand_transferability", "num", 5);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.entry_barrier")).toMatchObject({ status: "present", value_text: "moderate", value_num: null, evidence_ref: "doc://test-evidence" });
    expect(snap(runId, "right_to_win.customer_overlap")).toMatchObject({ status: "present", value_num: 4, value_text: null });
    expect(snap(runId, "right_to_win.tech_overlap")).toMatchObject({ status: "present", value_num: 3 });
    expect(snap(runId, "right_to_win.brand_transferability")).toMatchObject({ status: "present", value_num: 5 });
  });

  test("unreviewed assertion (reviewed_by NULL) → missing", () => {
    const pid = insertProject();
    insertAssertion(pid, "market.entry_barrier", "text", "high", { reviewed: false });
    const runId = insertRun(pid);
    fill(pid, runId);
    const row = snap(runId, "market.entry_barrier");
    expect(row.status).toBe("missing");
    expect(row.value_text).toBeNull();
  });

  test("superseded reviewed row → missing (the live row is an unreviewed replacement)", () => {
    const pid = insertProject();
    const original = insertAssertion(pid, "market.entry_barrier", "text", "high");
    // The repository's flip pattern (dimension-input.repository.ts assert): the
    // successor is born NON-live to satisfy idx_dimension_input_live, then the
    // pointers swap — old.superseded_by = new.id, new goes live.
    const replacement = ulid();
    const runId2 = insertRun(pid);
    db.run(
      "INSERT INTO dimension_input (id, run_id, project_id, var_key, value_kind, value_text, value_num, evidence_ref, asserted_by, reviewed_by, rationale, observed_at, superseded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [replacement, runId2, pid, "market.entry_barrier", "text", "moderate", null, "doc://test-evidence-2", U1, null, "replacement rationale", NOW, original],
    );
    db.run("UPDATE dimension_input SET superseded_by = ? WHERE id = ?", [replacement, original]);
    db.run("UPDATE dimension_input SET superseded_by = NULL WHERE id = ?", [replacement]);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "market.entry_barrier").status).toBe("missing");
  });

  test("no assertion rows at all → all four missing", () => {
    const pid = insertProject();
    const runId = insertRun(pid);
    fill(pid, runId);
    for (const key of ["market.entry_barrier", "right_to_win.customer_overlap", "right_to_win.tech_overlap", "right_to_win.brand_transferability"]) {
      expect(snap(runId, key).status, key).toBe("missing");
    }
  });
});

// ---------------------------------------------------------------------------
// Family D — technical_execution (D-M-TE-8)
// ---------------------------------------------------------------------------

describe("trl / ip family — D-M-TE-8 worst-of", () => {
  test("trl = MIN across findings; NULL grades ignored; empty → missing", () => {
    const pid = insertProject();
    insertDdFinding(pid, { trl: "TRL9" });
    insertDdFinding(pid, { trl: "TRL3" });
    insertDdFinding(pid, { trl: null });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "tech.trl_grade")).toMatchObject({ status: "present", value_text: "TRL3" });

    const barePid = insertProject();
    const bareRun = insertRun(barePid);
    fill(barePid, bareRun);
    expect(snap(bareRun, "tech.trl_grade").status).toBe("missing");
  });

  test("ip = worst per the total order (disputed > licensed_in > jointly_owned > owned_by_originator > owned_by_target)", () => {
    const pid = insertProject();
    insertDdFinding(pid, { ip: "owned_by_target" });
    insertDdFinding(pid, { ip: "licensed_in" });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "tech.ip_ownership_status")).toMatchObject({ status: "present", value_text: "licensed_in" });

    const disputePid = insertProject();
    insertDdFinding(disputePid, { ip: "jointly_owned" });
    insertDdFinding(disputePid, { ip: "disputed" });
    insertDdFinding(disputePid, { ip: "owned_by_originator" });
    const disputeRun = insertRun(disputePid);
    fill(disputePid, disputeRun);
    expect(snap(disputeRun, "tech.ip_ownership_status")).toMatchObject({ status: "present", value_text: "disputed" });
  });
});

describe("cert counts — verified basis only", () => {
  test("no certification rows → both missing (UNASSESSED, not zero)", () => {
    const pid = insertProject();
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "cert.non_transferable_on_coc").status).toBe("missing");
    expect(snap(runId, "cert.load_bearing_non_transferable_on_coc").status).toBe("missing");
  });

  test("counts verified-basis non-transferable positions only; inferred / yes / NULL never count; load_bearing narrows", () => {
    const pid = insertProject();
    insertCert(pid, { transferableOnCoc: "no", basis: "verified", loadBearing: 1 });
    insertCert(pid, { transferableOnCoc: "no", basis: "verified", loadBearing: 0 });
    insertCert(pid, { transferableOnCoc: "no", basis: "inferred" }); // inferred basis is never evidence
    insertCert(pid, { transferableOnCoc: "yes", basis: "verified" });
    insertCert(pid, {}); // no position taken
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "cert.non_transferable_on_coc")).toMatchObject({ status: "present", value_num: 2 });
    expect(snap(runId, "cert.load_bearing_non_transferable_on_coc")).toMatchObject({ status: "present", value_num: 1 });
  });

  test("certifications exist, none at risk → present zero (valid N/A shape)", () => {
    const pid = insertProject();
    insertCert(pid, { transferableOnCoc: "yes", basis: "verified" });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "cert.non_transferable_on_coc")).toMatchObject({ status: "present", value_num: 0 });
    expect(snap(runId, "cert.load_bearing_non_transferable_on_coc")).toMatchObject({ status: "present", value_num: 0 });
  });
});

describe("permit critical path — DAG longest path (D-M-TE-8)", () => {
  test("no permits → both missing", () => {
    const pid = insertProject();
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "permit.critical_path_duration").status).toBe("missing");
    expect(snap(runId, "permit.unresolved_on_critical_path").status).toBe("missing");
  });

  test("permits exist but all resolved → present 0 / 0", () => {
    const pid = insertProject();
    insertPermit(pid, { days: 100, status: "granted" });
    insertPermit(pid, { days: 50, status: "denied" });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "permit.critical_path_duration")).toMatchObject({ status: "present", value_num: 0 });
    expect(snap(runId, "permit.unresolved_on_critical_path")).toMatchObject({ status: "present", value_num: 0 });
  });

  test("linear chain: 100+200+50 days → 350 days → 11.5 months, 3 unresolved on path", () => {
    const pid = insertProject();
    const a = insertPermit(pid, { days: 100 });
    const b = insertPermit(pid, { days: 200 });
    const c = insertPermit(pid, { days: 50 });
    insertEdge(a, b);
    insertEdge(b, c);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "permit.critical_path_duration")).toMatchObject({ status: "present", value_num: 11.5 }); // 350 / 30.44 = 11.4954… → 11.5
    expect(snap(runId, "permit.unresolved_on_critical_path")).toMatchObject({ status: "present", value_num: 3 });
  });

  test("NULL statutory_days contributes 0 days but still counts as an unresolved path node", () => {
    const pid = insertProject();
    const a = insertPermit(pid, { days: 100 });
    const b = insertPermit(pid, { days: null });
    const c = insertPermit(pid, { days: 50 });
    insertEdge(a, b);
    insertEdge(b, c);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "permit.critical_path_duration")).toMatchObject({ status: "present", value_num: Math.round((150 / 30.44) * 10) / 10 });
    expect(snap(runId, "permit.unresolved_on_critical_path")).toMatchObject({ status: "present", value_num: 3 });
  });

  test("a granted permit in the middle breaks the chain — paths recompute around it", () => {
    const pid = insertProject();
    const a = insertPermit(pid, { days: 100 });
    insertPermit(pid, { days: 200, status: "granted" });
    const c = insertPermit(pid, { days: 50 });
    const b = db.query("SELECT id FROM permit WHERE project_id = ? AND statutory_days = 200").get(pid) as { id: string };
    insertEdge(a, b.id);
    insertEdge(b.id, c);
    const runId = insertRun(pid);
    fill(pid, runId);
    // remaining graph: two isolated nodes → longest = 100 days, 1 node
    expect(snap(runId, "permit.critical_path_duration")).toMatchObject({ status: "present", value_num: Math.round((100 / 30.44) * 10) / 10 });
    expect(snap(runId, "permit.unresolved_on_critical_path")).toMatchObject({ status: "present", value_num: 1 });
  });

  test("branching: the longer branch wins", () => {
    const pid = insertProject();
    const a = insertPermit(pid, { days: 10 });
    const long1 = insertPermit(pid, { days: 120 });
    const long2 = insertPermit(pid, { days: 130 });
    const short = insertPermit(pid, { days: 30 });
    insertEdge(a, long1);
    insertEdge(long1, long2);
    insertEdge(a, short);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "permit.critical_path_duration")).toMatchObject({ status: "present", value_num: Math.round((260 / 30.44) * 10) / 10 });
    expect(snap(runId, "permit.unresolved_on_critical_path")).toMatchObject({ status: "present", value_num: 3 });
  });

  test("edges to OTHER projects' permits are filtered out of the induced subgraph", () => {
    const pid = insertProject();
    const other = insertProject();
    const a = insertPermit(pid, { days: 100 });
    const foreign = insertPermit(other, { days: 900 });
    insertEdge(foreign, a); // foreign node not in this project's unresolved set → edge invisible
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "permit.critical_path_duration")).toMatchObject({ status: "present", value_num: Math.round((100 / 30.44) * 10) / 10 });
    expect(snap(runId, "permit.unresolved_on_critical_path")).toMatchObject({ status: "present", value_num: 1 });
  });

  test("a cycle in permit_edge → throws (no critical path exists)", () => {
    const pid = insertProject();
    const a = insertPermit(pid, { days: 100 });
    const b = insertPermit(pid, { days: 100 });
    insertEdge(a, b);
    insertEdge(b, a);
    const runId = insertRun(pid);
    expect(() => fill(pid, runId)).toThrow(/cycle/);
  });
});

// ---------------------------------------------------------------------------
// Family E — risk (D-M-RISK-5 filler contracts)
// ---------------------------------------------------------------------------

describe("contingent family — EV / max amount / max probability", () => {
  test("rows exist → present: EV = sum of probability x amount, MAX amount, MAX probability", () => {
    const pid = insertProject();
    insertContingent(pid, 0.5, 10e9);
    insertContingent(pid, 0.25, 40e9);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.contingent_expected_value")).toMatchObject({ status: "present", value_num: 15e9 }); // 5e9 + 10e9
    expect(snap(runId, "risk.contingent_max_amount")).toMatchObject({ status: "present", value_num: 40e9 });
    expect(snap(runId, "risk.contingent_max_probability")).toMatchObject({ status: "present", value_num: 0.5 });
  });

  test("zero rows + validator coverage row → present 0 / 0 / 0 (a considered nothing)", () => {
    const pid = insertProject();
    insertCoveragePass(pid);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.contingent_expected_value")).toMatchObject({ status: "present", value_num: 0 });
    expect(snap(runId, "risk.contingent_max_amount")).toMatchObject({ status: "present", value_num: 0 });
    expect(snap(runId, "risk.contingent_max_probability")).toMatchObject({ status: "present", value_num: 0 });
  });

  test("zero rows + NO coverage → missing (the validator is owed, not zero)", () => {
    const pid = insertProject();
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.contingent_expected_value").status).toBe("missing");
    expect(snap(runId, "risk.contingent_max_amount").status).toBe("missing");
    expect(snap(runId, "risk.contingent_max_probability").status).toBe("missing");
  });
});

describe("covenant family — latest run decides", () => {
  test("breaches in the LATEST simulation count; older simulations are invisible", () => {
    const pid = insertProject();
    const oldSim = insertSimulation(pid, "2026-08-20T00:00:00Z");
    insertCovenantTest(oldSim, "dscr", 1);
    insertCovenantTest(oldSim, "leverage", 1);
    const newSim = insertSimulation(pid, "2026-08-22T00:00:00Z");
    insertCovenantTest(newSim, "dscr", 0);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.covenants_breached")).toMatchObject({ status: "present", value_num: 0, observed_at: "2026-08-22T00:00:00Z" });
  });

  test("latest simulation carries the breaches → the count is that simulation's", () => {
    const pid = insertProject();
    const oldSim = insertSimulation(pid, "2026-08-20T00:00:00Z");
    insertCovenantTest(oldSim, "dscr", 0);
    const newSim = insertSimulation(pid, "2026-08-22T00:00:00Z");
    insertCovenantTest(newSim, "dscr", 1);
    insertCovenantTest(newSim, "leverage", 1);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.covenants_breached")).toMatchObject({ status: "present", value_num: 2 });
  });

  test("no simulation + no debt → present 0 (nothing to test)", () => {
    const pid = insertProject();
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.covenants_breached")).toMatchObject({ status: "present", value_num: 0 });
  });

  test("no simulation but debt exists → missing (the covenant test is owed)", () => {
    const pid = insertProject();
    db.run("INSERT INTO debt_instrument (id, project_id, principal, rate_type, rate) VALUES (?,?,?,?,?)", [ulid(), pid, 10e9, "fixed", 0.05]);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.covenants_breached").status).toBe("missing");
  });
});

describe("partner family — active pool + dependency", () => {
  test("no deal_structure_hypothesis → both missing (the only missing condition)", () => {
    const pid = insertProject();
    insertPartner(pid, { status: "signed", dependency: "high" });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.partner_candidates_active").status).toBe("missing");
    expect(snap(runId, "risk.partner_dependency_risk").status).toBe("missing");
  });

  test("declared non-JV vehicle → dependency 'none' present; active pool counts only {contacted, in_negotiation, signed}", () => {
    const pid = insertProject();
    insertHypothesis(pid, { vehicle: "direct" });
    insertPartner(pid, { status: "contacted" });
    insertPartner(pid, { status: "in_negotiation" });
    insertPartner(pid, { status: "signed" });
    insertPartner(pid, { status: "sourcing" }); // longlist, not active
    insertPartner(pid, { status: "withdrawn" });
    insertPartner(pid, { status: "rejected" });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.partner_candidates_active")).toMatchObject({ status: "present", value_num: 3 });
    expect(snap(runId, "risk.partner_dependency_risk")).toMatchObject({ status: "present", value_text: "none" });
  });

  test("JV vehicle → dependency = MAX candidate severity (high > medium > low > none)", () => {
    const pid = insertProject();
    insertHypothesis(pid, { vehicle: "jv" });
    insertPartner(pid, { status: "signed", dependency: "medium" });
    insertPartner(pid, { status: "contacted", dependency: "high" });
    insertPartner(pid, { status: "sourcing", dependency: "low" });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.partner_dependency_risk")).toMatchObject({ status: "present", value_text: "high" });
  });

  test("JV with no assessed dependency → missing (dependency unassessed, pool still counted)", () => {
    const pid = insertProject();
    insertHypothesis(pid, { vehicle: "jv" });
    insertPartner(pid, { status: "signed", dependency: null });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.partner_candidates_active")).toMatchObject({ status: "present", value_num: 1 });
    expect(snap(runId, "risk.partner_dependency_risk").status).toBe("missing");
  });

  test("unsettled (NULL) vehicle → dependency from candidates when assessed; 'none' is a real verdict", () => {
    const pid = insertProject();
    insertHypothesis(pid, { vehicle: null });
    insertPartner(pid, { status: "contacted", dependency: "none" });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.partner_dependency_risk")).toMatchObject({ status: "present", value_text: "none" });
  });

  test("the LATEST hypothesis decides (a superseding direct deal overwrites an earlier JV)", () => {
    const pid = insertProject();
    insertHypothesis(pid, { vehicle: "jv", hypothesizedAt: "2026-08-20T00:00:00Z" });
    insertHypothesis(pid, { vehicle: "direct", hypothesizedAt: "2026-08-22T00:00:00Z" });
    insertPartner(pid, { status: "signed", dependency: "high" });
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "risk.partner_dependency_risk")).toMatchObject({ status: "present", value_text: "none", observed_at: "2026-08-22T00:00:00Z" });
  });
});

// ---------------------------------------------------------------------------
// Entry point — completeness, immutability, run gating
// ---------------------------------------------------------------------------

describe("fillSnapshot entry point", () => {
  test("a bare project fills exactly 27 rows — one per seeded var, every FK valid; covenant is the one present 0", () => {
    const pid = insertProject();
    const runId = insertRun(pid);
    const result = fillSnapshot({ runId, projectId: pid, now: FILL_NOW }, db);
    expect(result.rows).toHaveLength(27);
    expect(result.rows.map((r) => r.var_key).sort()).toEqual([...SNAPSHOT_VAR_KEYS].sort());
    const stored = db.query("SELECT var_key, status, value_num FROM project_variable_snapshot WHERE run_id = ?").all(runId) as Array<{ var_key: string; status: string; value_num: number | null }>;
    expect(stored).toHaveLength(27);
    // Bare project: everything missing except covenant — no debt → present 0 (D-M-RISK-5)
    const present = stored.filter((r) => r.status === "present");
    expect(present.map((r) => r.var_key)).toEqual(["risk.covenants_breached"]);
    expect(present[0].value_num).toBe(0);
  });

  test("runs are immutable — refilling the same run throws on the PK", () => {
    const pid = insertProject();
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(() => fill(pid, runId)).toThrow(/UNIQUE/);
  });

  test("a run belonging to another project is rejected", () => {
    const pidA = insertProject();
    const pidB = insertProject();
    const runB = insertRun(pidB);
    expect(() => fill(pidA, runB)).toThrow(/belongs to project/);
  });

  test("a nonexistent run is rejected", () => {
    const pid = insertProject();
    expect(() => fillSnapshot({ runId: "run-does-not-exist", projectId: pid, now: FILL_NOW }, db)).toThrow(/does not exist/);
  });
});

// ---------------------------------------------------------------------------
// Family F — antitrust.presumption_screens_triggered (ADR-0062, migration 0025)
// ---------------------------------------------------------------------------

describe("antitrust early-screen family (ADR-0062)", () => {
  function insertFinding(pid: string, hhiBefore: number | null, hhiAfter: number | null, at = "2026-08-24T00:00:00Z"): void {
    db.run(
      "INSERT INTO antitrust_finding (id, project_id, market_definition, hhi_before, hhi_after, created_at) VALUES (?,?,?,?,?,?)",
      [ulid(), pid, "test-market", hhiBefore, hhiAfter, at],
    );
  }

  test("no antitrust_finding rows → missing — not-yet-screened is never present-0 (ADR-0049)", () => {
    const pid = insertProject();
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "antitrust.presumption_screens_triggered")).toMatchObject({ status: "missing", value_num: null });
  });

  test("findings exist but none reach the presumption zone → present 0", () => {
    const pid = insertProject();
    // 2,400 with delta 60: concentrated but below the >100 delta half of the conjunction.
    insertFinding(pid, 2340, 2400);
    // delta 300 but post-HHI 1,500: movement without presumption-level concentration.
    insertFinding(pid, 1200, 1500);
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "antitrust.presumption_screens_triggered")).toMatchObject({ status: "present", value_num: 0 });
  });

  test("a row inside the 2023-guidelines zone (HHI>1800 AND delta>100) counts; boundary values excluded", () => {
    const pid = insertProject();
    insertFinding(pid, 1500, 1950); // HHI 1950 > 1800, delta 450 > 100 → trips
    insertFinding(pid, 1750, 1850); // delta exactly 100 → NOT > 100 → excluded
    insertFinding(pid, null, 2000); // unassessed before-HHI → excluded
    const runId = insertRun(pid);
    const result = fillSnapshot({ runId, projectId: pid, now: FILL_NOW }, db);
    expect(snap(runId, "antitrust.presumption_screens_triggered")).toMatchObject({ status: "present", value_num: 1 });
    const row = result.rows.find((r) => r.var_key === "antitrust.presumption_screens_triggered");
    expect(row?.evidence_ref).toBe("antitrust_finding");
    expect(row?.observed_at).toBe("2026-08-24T00:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// Family G — Class C extension vars (ADR-0063, migration 0026)
// ---------------------------------------------------------------------------

describe("Class C extension families (ADR-0063)", () => {
  function insertTalent(pid: string, status: string, exitDate: string | null, lockedAt: string): void {
    db.run(
      "INSERT INTO pmi_key_talent (id, project_id, role_ref, status, exit_date, locked_at, created_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), pid, `C-EO-001`, status, exitDate, lockedAt, NOW],
    );
  }

  test("#28 attrition: no roster → missing; roster with one in-window regretted of four → ratio 0.25", () => {
    const pid = insertProject();
    let runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "pmi.key_talent_attrition_90d")).toMatchObject({ status: "missing" });

    insertTalent(pid, "departed_regretted", "2026-09-15T00:00:00Z", NOW); // 22 days after lock → in window
    for (const s of ["active", "departed_planned", "active"]) insertTalent(pid, s, s === "active" ? null : "2026-10-01T00:00:00Z", NOW);
    runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "pmi.key_talent_attrition_90d")).toMatchObject({ status: "present", value_num: 0.25 });
  });

  test("#28: a regretted departure AFTER the 90-day window does not count", () => {
    const pid = insertProject();
    insertTalent(pid, "departed_regretted", "2027-01-15T00:00:00Z", NOW); // ~5 months after lock
    const runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "pmi.key_talent_attrition_90d")).toMatchObject({ status: "present", value_num: 0 });
  });

  test("#29 certification: no roster and no cert → missing; closed-but-uncertified → 'not_certified'; qualifying cert row → 'certified'", () => {
    const pid = insertProject();
    let runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "pmi.synergy_run_rate_certified")).toMatchObject({ status: "missing" });

    insertTalent(pid, "active", null, NOW); // close happened
    runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "pmi.synergy_run_rate_certified")).toMatchObject({ status: "present", value_text: "not_certified" });

    db.run(
      "INSERT INTO pmi_synergy_certification (id, project_id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), pid, 8500, 2, "C-CFO-001", NOW, "2026-11-01T00:00:00Z", NOW], // 85% < 90% floor
    );
    runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "pmi.synergy_run_rate_certified")).toMatchObject({ value_text: "not_certified" });

    db.run(
      "INSERT INTO pmi_synergy_certification (id, project_id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), pid, 9200, 2, "C-CFO-001", NOW, "2026-12-01T00:00:00Z", NOW], // 92% AND >=2 quarters → certified
    );
    runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "pmi.synergy_run_rate_certified")).toMatchObject({ value_text: "certified" });
  });

  test("#14 viable shapes: no evaluations → missing; evaluations count only viable=1 rows", () => {
    const pid = insertProject();
    let runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "dealshape.viable_shapes")).toMatchObject({ status: "missing" });

    db.run("INSERT INTO deal_shape_evaluation (id, project_id, shape, intent, viable, evaluated_by, evaluated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), pid, "minority_stake", "capability_access", 1, U1, NOW]);
    db.run("INSERT INTO deal_shape_evaluation (id, project_id, shape, intent, viable, evaluated_by, evaluated_at) VALUES (?,?,?,?,?,?,?)", [ulid(), pid, "full_acquisition", "integration", 0, U1, NOW]);
    runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "dealshape.viable_shapes")).toMatchObject({ status: "present", value_num: 1 });
  });

  test("#4 deadline var: no deadline record or no permits → missing; deadline inside the critical path → 'yes', outside → 'no'", () => {
    const pid = insertProject();
    const permitA = ulid();
    const permitB = ulid();
    db.run("INSERT INTO permit (id, project_id, name, statutory_days, status) VALUES (?,?,?,?,?)", [permitA, pid, "P-A", 365, "not_started"]);
    db.run("INSERT INTO permit (id, project_id, name, statutory_days, status) VALUES (?,?,?,?,?)", [permitB, pid, "P-B", 30, "not_started"]);
    db.run("INSERT INTO permit_edge (from_permit_id, to_permit_id) VALUES (?,?)", [permitA, permitB]);

    let runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "permit.critical_path_exceeds_incentive_deadline")).toMatchObject({ status: "missing" }); // no deadline yet

    // Critical path = 365+30 days ≈ 12.98 months. Deadline 3 months out → exceeded.
    const soon = new Date(FILL_NOW.getTime() + 90 * 86_400_000).toISOString();
    db.run("INSERT INTO project_incentive_deadline (id, project_id, incentive_ref, deadline, source, created_at) VALUES (?,?,?,?,?,?)", [ulid(), pid, "INC-001", soon, "test", NOW]);
    runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "permit.critical_path_exceeds_incentive_deadline")).toMatchObject({ status: "present", value_text: "yes" });

    // Deadline far outside the path → not exceeded.
    db.run("DELETE FROM project_incentive_deadline");
    const far = new Date(FILL_NOW.getTime() + 5 * 365 * 86_400_000).toISOString();
    db.run("INSERT INTO project_incentive_deadline (id, project_id, incentive_ref, deadline, source, created_at) VALUES (?,?,?,?,?,?)", [ulid(), pid, "INC-002", far, "test", NOW]);
    runId = insertRun(pid);
    fill(pid, runId);
    expect(snap(runId, "permit.critical_path_exceeds_incentive_deadline")).toMatchObject({ value_text: "no" });
  });
});
