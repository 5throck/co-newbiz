// @version 1.0.0
// ADR-0187 P3 (finding M1): S10 checks beyond sources = uses - uses reconcile to the
// S8 adopted investment (+/-5%), downside DSCR headroom (>= 1.2x), funding evidence
// on every source. Unit level (scratch SQLite) plus the engine integration on the
// seeded demo deals.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-s10-checks.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { ulid } = await import("../../db/lib/ulid.ts");
const s10 = await import("../../app/web-next/lib/s10-checks.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { blocker } = await import("../../app/web-next/lib/process-blocker-keys.ts");
const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");

const NOW = new Date().toISOString();
const OLD = "2026-10-01T00:00:00.000Z";

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function project(createdAt = NOW): string {
  const id = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [id, `S10-${id.slice(-8)}`, createdAt]);
  return id;
}
function fin(projectId: string, kind: "source" | "use", amount: number, evidence?: { kind: string; ref: string }, name = `${kind}-${ulid().slice(-4)}`) {
  db.run(
    "INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at, evidence_kind, evidence_ref) VALUES (?,?,?,?,?,?,?,?,?)",
    [ulid(), projectId, kind, name, amount, "t", NOW, evidence?.kind ?? null, evidence?.ref ?? null],
  );
}
/** An adopted case whose single capex line spends `capex` (KRW millions) once (start_year 0). */
function adoptCase(projectId: string, capex: number | null, unit: string | null = "KRW_M"): string {
  const model = ulid();
  db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,'investment_return','m',5,'t',?)", [model, projectId, NOW]);
  if (capex !== null) {
    db.run(
      "INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, created_by, created_at, unit) VALUES (?,?,'capex','c',?,0,0,'t',?,?)",
      [ulid(), model, capex, NOW, unit],
    );
  }
  db.run(
    "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json) VALUES (?,?,?,?,'t','s8_case_adopt','done','human','t',?,?,?)",
    [ulid(), "project", projectId, projectId, NOW, NOW, JSON.stringify({ model_id: model })],
  );
  return model;
}
function covenantSimulation(projectId: string, tests: Array<[string, string, number, number, number]>) {
  const run = ulid();
  const sim = ulid();
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [run, projectId, "s", "h", "t", NOW]);
  db.run("INSERT INTO simulation (id, run_id, seed, iterations, discount_rate, created_at) VALUES (?,?,?,?,?,?)", [sim, run, 1, 10, 0.08, NOW]);
  for (const [period, key, threshold, projected, breached] of tests) {
    db.run("INSERT INTO covenant_test (simulation_id, period_id, covenant_key, threshold, projected_value, breached) VALUES (?,?,?,?,?,?)", [sim, period, key, threshold, projected, breached]);
  }
}
const debt = (projectId: string) => db.run("INSERT INTO debt_instrument (id, project_id, principal, rate_type, rate) VALUES (?,?,?,?,?)", [ulid(), projectId, 1000, "fixed", 0.05]);

describe("D2 thresholds are named constants with their owner-confirmed starting values", () => {
  test("values", () => {
    expect(s10.S10_USES_RECONCILIATION_TOLERANCE).toBe(0.05);
    expect(s10.S10_MIN_DOWNSIDE_DSCR).toBe(1.2);
    expect(s10.ADR_0187_P3_PREDICATE_DATE).toBe("2026-10-28");
  });
});

describe("(a) uses reconcile to the S8 adopted investment (+/-5%)", () => {
  test("boundary: exactly 5% passes, just over blocks (both directions)", () => {
    for (const [uses, blocks] of [[1000, false], [1050, false], [950, false], [1051, true], [949, true], [1100, true], [900, true]] as const) {
      const p = project();
      adoptCase(p, 1000);
      fin(p, "use", uses);
      const r = s10.s10UsesReconciliation(db, p);
      expect(r.missing.length > 0).toBe(blocks);
      expect(r.advisories).toEqual([]);
      if (blocks) {
        expect(r.missing).toEqual([blocker("s10.uses_reconcile_adopted_investment")]);
        expect(r.blockers[0]).toContain("허용 오차 ±5% 초과");
      }
    }
  });
  test("not derivable: no adopted case / no capex lines / unit not KRW_M / non-positive -> advisory only, never a block, never a silent pass", () => {
    const cases: Array<[string, (p: string) => void]> = [
      ["채택 Business Case가 없습니다", () => {}],
      ["capex 행이 없습니다", (p) => void adoptCase(p, null)],
      ["KRW_M으로 명시되어 있지 않습니다", (p) => void adoptCase(p, 1000, null)],
      ["양수가 아닙니다", (p) => void adoptCase(p, -500)],
    ];
    for (const [why, setup] of cases) {
      const p = project();
      setup(p);
      fin(p, "use", 777);
      const r = s10.s10UsesReconciliation(db, p);
      expect(r.missing).toEqual([]);
      expect(r.blockers).toEqual([]);
      expect(r.advisories.length).toBe(1);
      expect(r.advisories[0]).toContain(why);
      expect(r.advisories[0]).toContain("777");
    }
  });
  test("an empty plan is the balance blocker's job, not this check's", () => {
    const p = project();
    adoptCase(p, 1000);
    expect(s10.s10UsesReconciliation(db, p)).toEqual({ blockers: [], missing: [], advisories: [] });
  });
});

describe("(b) downside covenant headroom (DSCR >= 1.2x)", () => {
  test("no debt: not applicable", () => {
    expect(s10.s10CovenantHeadroom(db, project())).toEqual({ blockers: [], missing: [], advisories: [] });
  });
  test("debt without any simulation / without DSCR evidence blocks", () => {
    const a = project();
    debt(a);
    const ra = s10.s10CovenantHeadroom(db, a);
    expect(ra.missing).toEqual([blocker("s10.downside_covenant_headroom")]);
    expect(ra.blockers[0]).toContain("구조 시뮬레이션이 없습니다");
    const b = project();
    debt(b);
    covenantSimulation(b, [["2027", "NetLev", 3.5, 3.0, 0]]);
    expect(s10.s10CovenantHeadroom(db, b).blockers[0]).toContain("DSCR 커버넌트 테스트가 없습니다");
  });
  test("boundary: minimum projected DSCR of exactly 1.2 passes, below blocks, a breach blocks", () => {
    const mk = (min: number, breached = 0) => {
      const p = project();
      debt(p);
      covenantSimulation(p, [["2027", "DSCR", 1.1, 1.8, 0], ["2028", "DSCR", 1.1, min, breached]]);
      return s10.s10CovenantHeadroom(db, p);
    };
    expect(mk(1.2).missing).toEqual([]);
    expect(mk(1.5).missing).toEqual([]);
    const low = mk(1.19);
    expect(low.missing).toEqual([blocker("s10.downside_covenant_headroom")]);
    expect(low.blockers[0]).toContain("기준 1.2배 미만");
    expect(mk(1.3, 1).blockers[0]).toContain("위반");
  });
  test("the latest simulation decides", () => {
    const p = project();
    debt(p);
    covenantSimulation(p, [["2027", "DSCR", 1.1, 0.9, 1]]);
    db.run("UPDATE simulation SET created_at = '2026-01-01T00:00:00.000Z'");
    covenantSimulation(p, [["2027", "DSCR", 1.1, 1.6, 0]]);
    expect(s10.s10CovenantHeadroom(db, p).missing).toEqual([]);
  });
});

describe("(c) funding evidence on every source", () => {
  test("every source needs evidence_kind and a non-blank evidence_ref", () => {
    const p = project();
    fin(p, "source", 500, { kind: "commitment_letter", ref: "doc-1" }, "Bank");
    fin(p, "source", 500, undefined, "Parent");
    fin(p, "source", 100, { kind: "internal_approval", ref: "   " }, "Fund");
    fin(p, "use", 1100);
    const r = s10.s10FundingEvidence(db, p);
    expect(r.missing).toEqual([blocker("s10.funding_evidence")]);
    expect(r.blockers[0]).toContain("2건");
    expect(r.blockers[0]).toContain("Parent");
    const ok = project();
    fin(ok, "source", 500, { kind: "term_sheet", ref: "ts" });
    fin(ok, "use", 500);
    expect(s10.s10FundingEvidence(db, ok)).toEqual({ blockers: [], missing: [], advisories: [] });
  });
});

describe("engine integration (flow.spec 2.16.0 S10 completionCriteria 2-4)", () => {
  test("the seeded brownfield demo is S10-complete; stripping source evidence re-opens S10 with the stable label", async () => {
    const bf = await seedS1ToS12Demo();
    const clean = evaluateProcess({ type: "project", id: bf.projectId });
    expect(clean.completedStages).toContain("S10");
    db.run("UPDATE financing_sources_uses SET evidence_ref = NULL WHERE project_id = ? AND kind = 'source'", [bf.projectId]);
    const ev = evaluateProcess({ type: "project", id: bf.projectId });
    expect(ev.completedStages).not.toContain("S10");
    expect(ev.currentStage).toBe("S10");
    expect(ev.requiredArtifacts).toContain(blocker("s10.funding_evidence"));
    expect(ev.blockers.join("\n")).toContain("자금 확정성 증빙이 없는 조달원");
  });
  test("a non-derivable adopted investment is an advisory in blockers, not a missing artifact", async () => {
    const bf = await seedS1ToS12Demo(); // demo capex lines carry no unit -> not derivable
    db.run("UPDATE financing_sources_uses SET evidence_ref = NULL WHERE project_id = ? AND kind = 'source' AND name LIKE 'Equity%'", [bf.projectId]);
    const ev = evaluateProcess({ type: "project", id: bf.projectId });
    expect(ev.currentStage).toBe("S10");
    expect(ev.blockers.some((b) => b.includes("대사할 수 없습니다"))).toBe(true);
    expect(ev.requiredArtifacts).not.toContain(blocker("s10.uses_reconcile_adopted_investment"));
  });
  test("grandfathering: a project whose earliest pin and creation predate the P3 date keeps the legacy S10 predicate", async () => {
    const bf = await seedS1ToS12Demo();
    db.run("UPDATE financing_sources_uses SET evidence_ref = NULL, evidence_kind = NULL WHERE project_id = ?", [bf.projectId]);
    expect(evaluateProcess({ type: "project", id: bf.projectId }).completedStages).not.toContain("S10");
    db.run("UPDATE md_project SET created_at = ? WHERE id = ?", [OLD, bf.projectId]);
    db.run("UPDATE project_policy_pin SET pinned_at = ? WHERE project_id = ?", [OLD, bf.projectId]);
    expect(s10.s10M1Grandfathered(db, { id: bf.projectId, created_at: OLD })).toBe(true);
    expect(evaluateProcess({ type: "project", id: bf.projectId }).completedStages).toContain("S10");
  });
});
