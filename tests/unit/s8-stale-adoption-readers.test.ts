// @version 1.0.0
/**
 * Remaining adoption readers under ADR-0206 (design 2026-11-24-s8-excluded-target-handling, addendum 2026-11-25).
 *
 * A stale adoption (the adopted case's target left the Short List) must be surfaced by every reader that reads the
 * adoption record directly, never silently used as current and never altered: backtest, covenant-dscr (and with it the
 * S10 headroom check and the covenant snapshot variable), greenfield-execution adopted capex (tranche reconciliation and
 * the S10 uses reconciliation) and the S11 process-flow adopted-case artifact. Greenfield cases carry no target, so
 * they are never stale.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s8-stale-adoption-readers.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { resolveS8Staleness } = await import("../../app/web-next/lib/business-case.ts");
const { goStaleTargetCheck } = await import("../../app/web-next/lib/gate-write-checks.ts");
const { runBacktest } = await import("../../app/web-next/lib/backtest.ts");
const { computeDownsideDscr } = await import("../../app/web-next/lib/covenant-dscr.ts");
const { adoptedCaseCapex, trancheReconciliation } = await import("../../app/web-next/lib/greenfield-execution.ts");
const { s10UsesReconciliation, s10CovenantHeadroom } = await import("../../app/web-next/lib/s10-checks.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { fillSnapshot } = await import("../../db/lib/snapshot-filler.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const bf = seedS1ToS12Demo();
const gf = await seedGreenfieldS1ToS12Demo();
const TARGET = "demo-s1-s12-target-1";
const STALE_NOTE = /no longer on the Short List/;

const setTarget = (status: "shortlisted" | "excluded") =>
  db.run("UPDATE brownfield_target SET status = ? WHERE id = ?", [status, TARGET]);

/** Selection + adoption rows, byte for byte: the readers must never alter a human record. */
const humanRecords = () =>
  db
    .query(
      "SELECT id, stage, status, started_by, started_at, meta_json FROM process_run WHERE project_id = ? AND stage IN ('s8_target_select','s8_case_adopt') ORDER BY id",
    )
    .all(bf.projectId);

function covenantSnapshot(): { status: string; value_num: number | null; evidence_ref: string | null } {
  const runId = ulid();
  db.run("INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)", [
    runId,
    bf.projectId,
    `hash-${runId.slice(-6)}`,
    "tester",
    new Date().toISOString(),
  ]);
  fillSnapshot({ runId, projectId: bf.projectId, now: new Date() }, db);
  return db
    .query(
      "SELECT status, value_num, evidence_ref FROM project_variable_snapshot WHERE run_id = ? AND var_key = 'risk.covenants_breached'",
    )
    .get(runId) as { status: string; value_num: number | null; evidence_ref: string | null };
}

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("stale adoption readers (ADR-0206 addendum)", () => {
  const before = humanRecords();
  let healthyOrg: ReturnType<typeof runBacktest>["org"];

  test("healthy: the adoption is current and every reader reports it normally", () => {
    expect(resolveS8Staleness(bf.projectId).adoption).toBeNull();
    healthyOrg = runBacktest(db, () => true).org;
    expect(healthyOrg.stale_adoption_excluded).toBe(0);
    expect(healthyOrg.insufficient).toBeGreaterThanOrEqual(1); // the demo project has no scorecard: counted, not excluded
    expect(adoptedCaseCapex(bf.projectId, db).stale).toBeUndefined();
    expect(trancheReconciliation(bf.projectId, db).findings.map((f) => f.code)).not.toContain("adopted_case_stale");
    expect(s10UsesReconciliation(db, bf.projectId).advisories.join("\n")).not.toMatch(STALE_NOTE);
  });

  test("backtest: a stale adopted case leaves the corpus and is counted, never scored", () => {
    setTarget("excluded");
    const res = runBacktest(db, () => true);
    expect(res.rows.find((r) => r.project_id === bf.projectId)).toBeUndefined();
    expect(res.org.stale_adoption_excluded).toBe(1);
    expect(res.org.insufficient).toBe(healthyOrg.insufficient - 1);
    expect(res.org.scored).toBe(healthyOrg.scored);
  });

  test("greenfield-execution adopted capex: no total from a stale case, a named finding instead", () => {
    const capex = adoptedCaseCapex(bf.projectId, db);
    expect(capex).toMatchObject({ modelId: "demo-s1-s12-business-case", total: null, stale: true });
    const rec = trancheReconciliation(bf.projectId, db);
    const codes = rec.findings.map((f) => f.code);
    expect(codes).toContain("adopted_case_stale");
    expect(codes).not.toContain("no_adopted_case");
    expect(rec.case.capex_total_krw_m).toBeNull();
    expect(rec.matches).toBe(false);
  });

  test("S10 uses reconciliation: the advisory names the stale adoption instead of 'no capex rows'", () => {
    const out = s10UsesReconciliation(db, bf.projectId);
    expect(out.blockers).toEqual([]);
    expect(out.advisories.join("\n")).toMatch(STALE_NOTE);
  });

  test("covenant-dscr, S10 headroom and the covenant snapshot variable: stale, never computed or zero", () => {
    db.run(
      "INSERT INTO debt_instrument (id, project_id, lender, principal, rate_type, rate, maturity, amortization) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), bf.projectId, "Bank A", 1000, "fixed", 5, "5 years", "annuity"],
    );
    const report = computeDownsideDscr(db, bf.projectId);
    expect(report).toMatchObject({
      status: "insufficient_evidence",
      reason: "stale_adopted_case",
      min_dscr: null,
      case_id: null,
    });
    expect(report.periods).toEqual([]);
    expect(report.message).toMatch(STALE_NOTE);

    const headroom = s10CovenantHeadroom(db, bf.projectId);
    expect(headroom.blockers.join("\n")).toMatch(STALE_NOTE);

    expect(covenantSnapshot()).toEqual({ status: "stale", value_num: null, evidence_ref: "s8-stale-adopted-target" });
  });

  test("a stale adoption is derived state: the selection/adoption rows are untouched and recovery is automatic", () => {
    expect(humanRecords()).toEqual(before);
    setTarget("shortlisted");
    expect(resolveS8Staleness(bf.projectId).adoption).toBeNull();
    expect(computeDownsideDscr(db, bf.projectId).reason).not.toBe("stale_adopted_case");
    expect(covenantSnapshot().status).not.toBe("stale");
    expect(adoptedCaseCapex(bf.projectId, db).stale).toBeUndefined();
    expect(runBacktest(db, () => true).org.stale_adoption_excluded).toBe(0);
    expect(humanRecords()).toEqual(before);
  });

  test("greenfield (no target axis) is never stale: the adopted capex and DSCR paths are unchanged", () => {
    expect(resolveS8Staleness(gf.projectId).adoption).toBeNull();
    const capex = adoptedCaseCapex(gf.projectId, db);
    expect(capex.stale).toBeUndefined();
    expect(capex.modelId).not.toBeNull();
    expect(computeDownsideDscr(db, gf.projectId).reason).not.toBe("stale_adopted_case");
  });

  test("process-flow S11: a stale adopted case is not a usable IC input (same blocker key, stated reason)", () => {
    // The debt row from the DSCR test would hold S10 on the stale case; this test isolates the S11 artifact.
    db.run("DELETE FROM debt_instrument WHERE project_id = ?", [bf.projectId]);
    const healthy = evaluateProcess({ type: "project", id: bf.projectId }).stages.find((s) => s.id === "S11");
    expect(healthy?.status).toBe("complete");
    expect(healthy?.blockers.join("\n")).not.toMatch(STALE_NOTE);

    // Selection moves to a second shortlisted target that has its own case (so S8 stays complete); only the adoption
    // stays on the excluded target.
    const opp = (
      db.query("SELECT source_opportunity_id AS o FROM md_project WHERE id = ?").get(bf.projectId) as { o: string }
    ).o;
    const stamp = "2026-01-01T00:00:00.000Z";
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES ('s8-stale-tb', ?, 'BBB', 'shortlisted', 2, ?, ?)",
      [opp, stamp, stamp],
    );
    db.run(
      `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
       VALUES ('s8-stale-sel2','project',?,?,'t','s8_target_select','done','web','tester','2999-01-01T00:00:00Z','2999-01-01T00:00:00Z',?)`,
      [bf.projectId, bf.projectId, JSON.stringify({ target_id: "s8-stale-tb" })],
    );
    const cols = (t: string) =>
      (db.query(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    const model = db.query("SELECT * FROM business_case_model WHERE id = 'demo-s1-s12-business-case'").get() as Record<
      string,
      unknown
    >;
    const mc = cols("business_case_model");
    db.run(
      `INSERT INTO business_case_model (${mc.join(",")}) VALUES (${mc.map(() => "?").join(",")})`,
      mc.map((c) => (c === "id" ? "s8-stale-bmodel" : c === "target_id" ? "s8-stale-tb" : model[c])),
    );
    const vc = cols("valuation_simulation");
    for (const v of db
      .query("SELECT * FROM valuation_simulation WHERE model_id = 'demo-s1-s12-business-case'")
      .all() as Array<Record<string, unknown>>) {
      db.run(
        `INSERT INTO valuation_simulation (${vc.join(",")}) VALUES (${vc.map(() => "?").join(",")})`,
        vc.map((c) => (c === "id" ? `s8-stale-${v.id}` : c === "model_id" ? "s8-stale-bmodel" : v[c])),
      );
    }
    setTarget("excluded");
    const s11 = evaluateProcess({ type: "project", id: bf.projectId }).stages.find((s) => s.id === "S11");
    expect(s11?.status).toBe("current");
    expect(s11?.blockers.join("\n")).toMatch(STALE_NOTE);
    expect(s11?.missing).toContain("s11.adopted_business_case");
  });
});

// DEC-20261128-01 (design addendum REQ-W10-2/REQ-W10-6 item 3): a regeneration archives the
// adopted round, and the latest adoption then reads as `adopted_superseded` — ROUND-based, so it
// applies without any target axis (greenfield) and with the target dimension entirely clean.
// The readers must surface the stale state through their existing contracts; no record is altered.
describe("superseded adoption readers (adopted_superseded, DEC-20261128-01)", () => {
  const ADOPTED_BF = "demo-s1-s12-business-case";
  const SUPERSEDED_AT = "2999-01-01T00:00:00.000Z";
  const archiveModel = (id: string) =>
    db.run("UPDATE business_case_model SET archived_at = ?, archived_by = ? WHERE id = ?", [
      SUPERSEDED_AT,
      "tester",
      id,
    ]);
  let healthyBacktestOrg: ReturnType<typeof runBacktest>["org"];

  test("round-based staleness with a clean target dimension; the fs GO block answers it", async () => {
    // Start from the healthy demo state: drop the fixture rows the ADR-0206 S11 test added
    // (its second selection record and its per-target case), target back on the Short List.
    db.run("DELETE FROM process_run WHERE id = 's8-stale-sel2'");
    db.run("DELETE FROM valuation_simulation WHERE model_id = 's8-stale-bmodel'");
    db.run("DELETE FROM business_case_model WHERE id = 's8-stale-bmodel'");
    db.run("DELETE FROM brownfield_target WHERE id = 's8-stale-tb'");
    setTarget("shortlisted");
    const before = resolveS8Staleness(bf.projectId);
    expect(before.adoption).toBeNull();
    expect(before.any).toBe(false);
    healthyBacktestOrg = runBacktest(db, () => true).org;
    expect(healthyBacktestOrg.stale_adoption_excluded).toBe(0);

    // The regeneration's supersession: the adopted round's model row is archived.
    archiveModel(ADOPTED_BF);
    const st = resolveS8Staleness(bf.projectId);
    expect(st.adoption).toBe("adopted_superseded");
    expect(st.any).toBe(true);

    // Family `target` (fs GO block): same 409 contract, now naming the round-based reason.
    const denied = goStaleTargetCheck({ entityType: "project", entityId: bf.projectId, gate: "fs", actor: "tester" });
    expect(denied?.status).toBe(409);
    const body = (await (denied as Response).json()) as {
      error: { code: string; details: { adoption: string | null } };
    };
    expect(body.error.code).toBe("target_not_shortlisted");
    expect(body.error.details.adoption).toBe("adopted_superseded");
  });

  test("backtest: the superseded adopted case leaves the corpus and is counted", () => {
    const res = runBacktest(db, () => true);
    expect(res.rows.find((r) => r.project_id === bf.projectId)).toBeUndefined();
    expect(res.org.stale_adoption_excluded).toBe(1);
    expect(res.org.insufficient).toBe(healthyBacktestOrg.insufficient - 1);
    expect(res.org.scored).toBe(healthyBacktestOrg.scored);
  });

  test("greenfield-execution and covenant readers: stale surfaces, never old-round figures", () => {
    expect(adoptedCaseCapex(bf.projectId, db)).toMatchObject({ modelId: ADOPTED_BF, total: null, stale: true });
    const rec = trancheReconciliation(bf.projectId, db);
    expect(rec.findings.map((f) => f.code)).toContain("adopted_case_stale");
    expect(rec.matches).toBe(false);
    expect(s10UsesReconciliation(db, bf.projectId).advisories.join("\n")).not.toBe("");

    // Debt row re-added (the S11 test above removed it): the covenant verdict refuses to compute.
    db.run(
      "INSERT INTO debt_instrument (id, project_id, lender, principal, rate_type, rate, maturity, amortization) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), bf.projectId, "Bank A", 1000, "fixed", 5, "5 years", "annuity"],
    );
    const report = computeDownsideDscr(db, bf.projectId);
    expect(report).toMatchObject({ status: "insufficient_evidence", reason: "stale_adopted_case", min_dscr: null });
    expect(report.periods).toEqual([]);
    expect(s10CovenantHeadroom(db, bf.projectId).blockers.join("\n")).toMatch(STALE_NOTE);
    expect(covenantSnapshot()).toEqual({ status: "stale", value_num: null, evidence_ref: "s8-stale-adopted-target" });

    // The regeneration also produced a fresh round (as every regeneration does): clone the
    // adopted case as a new ACTIVE row so S8 can complete on the fresh set. The stale debt row
    // would hold S10 (and with it S11) on the stale case — the same isolation the ADR-0206
    // S11 test applies — so it is removed before the process-level assertions.
    db.run("DELETE FROM debt_instrument WHERE project_id = ?", [bf.projectId]);
    const cols = (t: string) =>
      (db.query(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    const model = db.query("SELECT * FROM business_case_model WHERE id = ?").get(ADOPTED_BF) as Record<string, unknown>;
    const mc = cols("business_case_model");
    db.run(
      `INSERT INTO business_case_model (${mc.join(",")}) VALUES (${mc.map(() => "?").join(",")})`,
      mc.map((c) => (c === "id" ? "s8-fresh-bmodel" : c === "archived_at" || c === "archived_by" ? null : model[c])),
    );
    const vc = cols("valuation_simulation");
    for (const v of db.query("SELECT * FROM valuation_simulation WHERE model_id = ?").all(ADOPTED_BF) as Array<
      Record<string, unknown>
    >) {
      db.run(
        `INSERT INTO valuation_simulation (${vc.join(",")}) VALUES (${vc.map(() => "?").join(",")})`,
        vc.map((c) => (c === "id" ? `s8-fresh-${v.id}` : c === "model_id" ? "s8-fresh-bmodel" : v[c])),
      );
    }
    // S8 completes on the fresh active set (the archived adopted case does not hold it open)…
    expect(evaluateProcess({ type: "project", id: bf.projectId }).completedStages).toContain("S8");
    // …while S11 refuses the superseded adoption as an IC input: it was complete on the healthy
    // adoption (the transition the ADR-0206 suite pins), the supersession re-opens it with the
    // same blocker key.
    const s11 = evaluateProcess({ type: "project", id: bf.projectId }).stages.find((s) => s.id === "S11");
    expect(s11?.status).toBe("current");
    expect(s11?.missing).toContain("s11.adopted_business_case");
  });

  test("greenfield (no target axis): the round-based reason applies without a target", () => {
    const gfAdoptedId = adoptedCaseCapex(gf.projectId, db).modelId;
    expect(gfAdoptedId).not.toBeNull();
    const before = runBacktest(db, () => true).org;
    expect(before.stale_adoption_excluded).toBe(1); // the superseded brownfield case above

    archiveModel(gfAdoptedId!);
    const st = resolveS8Staleness(gf.projectId);
    expect(st.adoption).toBe("adopted_superseded");
    expect(st.selection).toBeNull();
    expect(st.adopted_target).toBeNull();
    expect(st.target_ids).toEqual([]);

    const denied = goStaleTargetCheck({ entityType: "project", entityId: gf.projectId, gate: "fs", actor: "tester" });
    expect(denied?.status).toBe(409);
    expect(adoptedCaseCapex(gf.projectId, db).stale).toBe(true);
    const res = runBacktest(db, () => true);
    expect(res.rows.find((r) => r.project_id === gf.projectId)).toBeUndefined();
    expect(res.org.stale_adoption_excluded).toBe(2);
  });
});
