// @version 1.0.0
/**
 * Brownfield per-target revenue anchor regression — the S8 valuation scale
 * bug: a target company with 몇백억 revenue was valued at 몇억 because year-1
 * revenue came from market-size × 0.5% capture (a greenfield from-scratch
 * entry model), not the acquired company's actual revenue base.
 *
 * Proves:
 *  (a) a target with DART revenue facts anchors year-1 revenue on the
 *      company's LATEST annual revenue (원 → KRW millions), scenario delta
 *      still applied on top;
 *  (b) a target without company facts keeps the market-capture fallback,
 *      capture-rate provenance stamped in the note;
 *  (c) the valuation SCALE follows the anchor — the anchored target's p50 NPV
 *      is two orders larger than the fallback target's;
 *  (d) greenfield/project-level inputs (caseInputsForProject) gain NO anchor —
 *      the legacy numbers are untouched.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case-revenue-anchor.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { ulid } = await import("../../db/lib/ulid.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const {
  caseInputsForTarget,
  caseInputsForProject,
  generateBusinessCases,
  buildS8JobSpec,
  runSeededSimulation,
  recordBusinessCaseParams,
  fadedExitDcf,
  recommendTargetsFromDb,
  methodsMixedAcrossTargets,
  ACQUISITION_EV_REVENUE_DEFAULT,
} = await import("../../app/web-next/lib/business-case-generator.ts");
const { runSimJob } = await import("../../app/web-next/lib/sim-engine.ts");

const NOW = new Date().toISOString();
let projectId = "";
let targetAId = "";
let targetBId = "";
const companyAId = ulid();
const DART_CORP_CODE = "00345678";
// 로보티즈-shaped series (원): latest 2025 = 29,127,949,488 → 29,127.95 KRW-M.
const REVENUE_WON: Array<[year: number, value: number]> = [
  [2023, 22_358_193_241],
  [2024, 25_856_449_323],
  [2025, 29_127_949_488],
];
const ANCHOR_KRW_M = REVENUE_WON[2][1] / 1e6;

beforeAll(async () => {
  await createUser(db, { userId: "anchor-test", role: "analyst", password: "pw-anchor-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "anchor-test", approvedBy: "test", now: NOW });

  // Brownfield opportunity with NO market facts — the fallback that produced
  // the bug (market_size NULL → 50,000 KRW-M → year-1 2.5억 for every target).
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, "매출 앵커 검증 기회", "휴머노이드 로봇", "selected", "anchor-test", NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, "brownfield", "m_and_a", "test route", "anchor-test", NOW],
  );
  for (const gate of ["screening", "pre_fs", "target_screening"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", "anchor-test", NOW]);
  }

  // Target A: linked to a company with 3 years of DART revenue facts.
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [companyAId, "㈜앵커대상", DART_CORP_CODE, NOW]);
  const sourceId = ulid();
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [sourceId, "dart", "A", NOW]);
  const accountId = (db.query("SELECT id FROM md_account WHERE name_ko = '매출액'").get() as { id: string }).id;
  for (const [year, value] of REVENUE_WON) {
    let periodId = (db.query("SELECT id FROM md_period WHERE period_type='year' AND fiscal_year=?").get(year) as { id: string } | undefined)?.id;
    if (!periodId) {
      periodId = ulid();
      db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)", [periodId, "year", `${year}-01-01`, `${year}-12-31`, year, NOW]);
    }
    db.run(
      "INSERT INTO fact_financial (id, company_id, period_id, account_id, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), companyAId, periodId, accountId, value, 1, sourceId, NOW],
    );
  }

  targetAId = ulid();
  targetBId = ulid();
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, status, rank, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?)`,
    [targetAId, oppId, "앵커대상", DART_CORP_CODE, "shortlisted", 1, NOW, NOW, targetBId, oppId, "실적없는대상", null, "shortlisted", 2, NOW, NOW],
  );
  projectId = promoteOpportunity(oppId, { promotedBy: "anchor-test", needToKnowBasis: "revenue anchor test" }).project.id;
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("brownfield per-target revenue anchor", () => {
  test("(a) target with DART facts anchors on latest annual revenue", () => {
    const inputs = caseInputsForTarget(projectId, { id: targetAId, companyId: companyAId });
    expect(inputs.revenueAnchor).toBeDefined();
    expect(inputs.revenueAnchor!.krwM).toBeCloseTo(ANCHOR_KRW_M, 6);
    expect(inputs.revenueAnchor!.source).toContain("DART");
    expect(inputs.revenueAnchor!.source).toContain("2025");
    // The growth model also carries the level for consumers of the resolver.
    expect(inputs.growthModel?.companyRevenue?.krwM).toBeCloseTo(ANCHOR_KRW_M, 6);
  });

  test("(b) target without company facts keeps the market-capture fallback", () => {
    const inputs = caseInputsForTarget(projectId, { id: targetBId, companyId: null });
    expect(inputs.revenueAnchor).toBeUndefined();
    expect(inputs.growthModel?.companyRevenue).toBeNull();
  });

  test("(c) generation: anchored lines, scale, and note provenance", async () => {
    const result = await generateBusinessCases(projectId, { actor: "anchor-test" });
    expect(result.status).toBe("done");

    // Target A: revenue line = latest DART revenue (base delta ×1.0), upside ×1.2.
    const aBaseRev = revenueLineOf(db, projectId, targetAId, "base");
    expect(aBaseRev).toBeCloseTo(ANCHOR_KRW_M, 4);
    const aUpsideRev = revenueLineOf(db, projectId, targetAId, "upside");
    expect(aUpsideRev).toBeCloseTo(ANCHOR_KRW_M * 1.2, 3);

    // Target B: market-capture fallback (50,000 KRW-M × 0.005 = 250).
    const bBaseRev = revenueLineOf(db, projectId, targetBId, "base");
    expect(bBaseRev).toBeCloseTo(250, 6);

    // Scale: the anchored target's p50 NPV must dwarf the fallback's — the
    // ~100× revenue gap must survive into the valuation, not collapse it.
    // Acquisition pricing (entry 3×/exit 3× on ~291억 anchor, 5% growth):
    // deterministic NPV ≈ 7,000 KRW-M — hundreds of 억, the right order for
    // paying 3× revenue for a 몇백억 business.
    const aP50 = p50Of(db, projectId, targetAId, "base", "market_forward");
    const bP50 = p50Of(db, projectId, targetBId, "base", "market_forward");
    expect(aP50).toBeGreaterThan(5_000); // ≥ 500억 at a benchmark-priced entry
    expect(aP50).toBeLessThan(12_000);
    expect(bP50).toBeLessThan(1_000);
    expect(aP50 / bP50).toBeGreaterThan(50);

    // Provenance: anchored note stamps revenue_anchor + acquisition multiples,
    // fallback stamps capture_rate.
    const aNote = noteOf(db, projectId, targetAId, "base");
    expect(aNote).toContain("revenue_anchor=대상 회사 최신 연매출 2025 (DART)");
    expect(aNote).toContain(`acq_ev=${ACQUISITION_EV_REVENUE_DEFAULT.toFixed(2)}x`);
    expect(aNote).toContain(`exit_ev=${ACQUISITION_EV_REVENUE_DEFAULT.toFixed(2)}x`);
    expect(aNote).not.toContain("capture_rate=");
    const bNote = noteOf(db, projectId, targetBId, "base");
    expect(bNote).toContain("capture_rate=0.005");
    expect(bNote).not.toContain("revenue_anchor=");
  });

  test("(e) acquisition pricing: entry = anchor × benchmark multiple, exit driver in the job-spec, IRR priced in", () => {
    const inputs = caseInputsForTarget(projectId, { id: targetAId, companyId: companyAId });
    expect(inputs.acquisition).toBeDefined();
    expect(inputs.acquisition!.evRevenue).toBe(ACQUISITION_EV_REVENUE_DEFAULT);
    const spec = buildS8JobSpec(inputs, "base", "market_forward");
    const drivers = (spec.cases as Array<{ drivers: Record<string, { value?: number }> }>)[0].drivers;
    expect(drivers.initial_investment!.value).toBeCloseTo(ANCHOR_KRW_M * ACQUISITION_EV_REVENUE_DEFAULT, 4);
    expect(drivers.exit_ev_revenue!.value).toBe(ACQUISITION_EV_REVENUE_DEFAULT);
    // Scenario-independence: the price is negotiated once — every scenario
    // pays the SAME entry, only post-deal performance varies.
    const upside = buildS8JobSpec(inputs, "upside", "market_forward");
    const upsideDrivers = (upside.cases as Array<{ drivers: Record<string, { value?: number }> }>)[0].drivers;
    expect(upsideDrivers.initial_investment!.value).toBeCloseTo(ANCHOR_KRW_M * ACQUISITION_EV_REVENUE_DEFAULT, 4);
    expect(upsideDrivers.revenue_y1!.value).toBeCloseTo(ANCHOR_KRW_M * 1.2, 4);
    // IRR with a market-priced entry stays defined and bounded (the pre-fix
    // 0.5×-of-revenue entry made IRR absurdly high; a multiple-priced entry
    // prices the deal realistically).
    const p50 = db
      .query(
        `SELECT v.irr FROM valuation_simulation v JOIN business_case_model m ON m.id = v.model_id
         WHERE m.project_id = ? AND m.target_id = ? AND v.scenario = 'base' AND m.variant = 'market_forward' AND v.percentile = 'p50'
         ORDER BY m.created_at DESC LIMIT 1`,
      )
      .get(projectId, targetAId) as { irr: number | null };
    expect(p50.irr).not.toBeNull();
    expect(p50.irr!).toBeGreaterThan(0.02);
    expect(p50.irr!).toBeLessThan(0.5);
  });

  test("(f) engine ↔ TS fallback equivalence on the acquisition contract (noise-free)", async () => {
    // sigmaOverride 0 → both paths become deterministic; the engine and the
    // in-process simulator must agree on the acquisition-priced NPV exactly.
    const inputs = caseInputsForTarget(projectId, { id: targetAId, companyId: companyAId });
    const quiet = {
      ...inputs,
      bcParams: { ...inputs.bcParams!, sigmaOverride: 0, sigmaOverrideSource: "test", iterations: 500 },
    };
    const ts = runSeededSimulation(quiet, "base", "market_forward");
    const job = await runSimJob(buildS8JobSpec(quiet, "base", "market_forward"));
    expect(job).not.toBeNull();
    const engineCase = job!.cases[0];
    expect(engineCase).toBeDefined();
    expect(engineCase.npv.p50).toBeCloseTo(ts.p50, 4);
    expect(engineCase.npv.p05).toBeCloseTo(ts.p05, 4);
    expect(engineCase.npv.p95).toBeCloseTo(ts.p95, 4);
  });

  test("(h) fade-DCF cross-check: exact value, structure identity, note fragments, param plumbing", async () => {
    const inputs = caseInputsForTarget(projectId, { id: targetAId, companyId: companyAId });
    const wacc = inputs.wacc.value;

    // Independent re-implementation (deliberately not importing generator
    // internals): anchor × margins × ramp, growth fading to terminal, exit at
    // the same multiple — the default 10y/3% cross-check value.
    const expectedNpv = (() => {
      const exitX = ACQUISITION_EV_REVENUE_DEFAULT;
      const H = 10, gT = 0.03, g1 = 0.05, margin = 1 - 0.6 - 0.1;
      const ramp = [0.4, 0.7, 0.9, 1, 1];
      let rev = ANCHOR_KRW_M, npv = -(ANCHOR_KRW_M * exitX);
      for (let t = 1; t <= H; t++) {
        if (t > 1) rev *= 1 + g1 + (gT - g1) * ((t - 2) / (H - 2));
        npv += (rev * margin * (ramp[t - 1] ?? 1)) / Math.pow(1 + wacc, t);
      }
      return npv + (rev * exitX) / Math.pow(1 + wacc, H);
    })();

    const xcheck = fadedExitDcf(inputs, "base", "market_forward");
    expect(xcheck).not.toBeNull();
    expect(xcheck!.horizon).toBe(10);
    expect(xcheck!.terminalGrowth).toBeCloseTo(0.03, 6);
    expect(xcheck!.npv).toBeCloseTo(expectedNpv, 4);
    expect(xcheck!.irr).not.toBeNull();

    // Structure identity: fade disabled (terminal = case growth) and the
    // cross-check window equal to the primary horizon → the cross-check IS
    // the primary deterministic structure (exact agreement by construction).
    const noFade = fadedExitDcf(
      { ...inputs, bcParams: { ...inputs.bcParams!, fadeHorizonYears: 5, growthTerminal: 0.05 } },
      "base",
      "market_forward",
    );
    const primary = (() => {
      const exitX = ACQUISITION_EV_REVENUE_DEFAULT, margin = 1 - 0.6 - 0.1;
      const ramp = [0.4, 0.7, 0.9, 1, 1];
      let rev = ANCHOR_KRW_M, npv = -(ANCHOR_KRW_M * exitX);
      for (let t = 1; t <= 5; t++) {
        if (t > 1) rev *= 1.05;
        npv += (rev * margin * (ramp[t - 1] ?? 1)) / Math.pow(1 + wacc, t);
      }
      return npv + (rev * exitX) / Math.pow(1 + wacc, 5);
    })();
    expect(noFade!.npv).toBeCloseTo(primary, 4);

    // Not acquisition-priced (fallback target / greenfield) → no cross-check.
    expect(fadedExitDcf(caseInputsForTarget(projectId, { id: targetBId, companyId: null }), "base")).toBeNull();
    expect(fadedExitDcf(caseInputsForProject(projectId), "base")).toBeNull();

    // Note fragments (from the (c) generation — acquisition pricing active).
    const aNote = noteOf(db, projectId, targetAId, "base");
    expect(aNote).toContain("xcheck=fade-dcf");
    expect(aNote).toContain("xcheck_horizon=10");
    expect(aNote).toContain("xcheck_terminal_growth=0.0300");
    expect(aNote).toMatch(/xcheck_fade_npv=\d+(\.\d+)?/);
    expect(noteOf(db, projectId, targetBId, "base")).not.toContain("xcheck=");

    // Param plumbing: user fade_horizon_years/growth_terminal flow through
    // record → resolve into the cross-check.
    await recordBusinessCaseParams(db, {
      projectId,
      params: { fade_horizon_years: 15, growth_terminal: 0.02 },
      rationale: "장기 전망 반영 — 교차검증 창구 확대 (test)",
      actor: "anchor-test",
    });
    const adjusted = caseInputsForTarget(projectId, { id: targetAId, companyId: companyAId });
    const adjustedX = fadedExitDcf(adjusted, "base", "market_forward");
    expect(adjustedX!.horizon).toBe(15);
    expect(adjustedX!.terminalGrowth).toBeCloseTo(0.02, 6);
    expect(adjustedX!.npv).not.toBeCloseTo(xcheck!.npv, 1);
  });

  test("(i) unit chain: 원(DART) → 억원(분석) → KRW-M(라인·시뮬레이션·스냅샷) 일관성 + 단위 컬럼", () => {
    // Migration 0134: every money row states its unit explicitly.
    const lines = db
      .query(
        `SELECT l.category, l.annual_amount_krw_m, l.unit FROM business_case_line l
         JOIN business_case_model m ON m.id = l.model_id
         JOIN valuation_simulation v ON v.model_id = m.id AND v.percentile = 'p50' AND v.scenario = 'base'
         WHERE m.project_id = ? AND m.target_id = ? AND m.variant = 'market_forward'
         ORDER BY m.created_at DESC, l.category LIMIT 3`,
      )
      .all(projectId, targetAId) as Array<{ category: string; annual_amount_krw_m: number; unit: string | null }>;
    expect(lines.length).toBe(3);
    for (const l of lines) expect(l.unit).toBe("KRW_M");

    // The exact 원 → KRW-M chain: the DART fact for FY2025 is stored in 원;
    // the generated revenue line must be that value / 1e6 — NOT /1e8 (억원
    // leak) nor /1e12 (the 2026-10-10 환산 오류 this test guards against).
    const revenueLine = lines.find((l) => l.category === "revenue")!;
    expect(revenueLine.annual_amount_krw_m).toBeCloseTo(REVENUE_WON[2][1] / 1e6, 6);

    // Simulation rows state the unit; NPV scale is sane relative to the
    // anchor (a unit/scale regression makes this ratio absurd).
    const sims = db
      .query(
        `SELECT v.percentile, v.npv_krw_m, v.unit FROM valuation_simulation v
         JOIN business_case_model m ON m.id = v.model_id
         WHERE m.project_id = ? AND m.target_id = ? AND v.scenario = 'base' AND m.variant = 'market_forward'
         ORDER BY m.created_at DESC LIMIT 3`,
      )
      .all(projectId, targetAId) as Array<{ percentile: string; npv_krw_m: number; unit: string | null }>;
    expect(sims.length).toBe(3);
    for (const s of sims) {
      expect(s.unit).toBe("KRW_M");
      expect(Math.abs(s.npv_krw_m) / ANCHOR_KRW_M).toBeGreaterThan(0.05);
      expect(Math.abs(s.npv_krw_m) / ANCHOR_KRW_M).toBeLessThan(100);
    }

    // The persisted job-spec (execution contract) carries the same KRW-M
    // values and declares each driver's unit.
    const drivers = latestDrivers(db, projectId, targetAId, "base");
    expect(drivers.revenue_y1!.value).toBeCloseTo(REVENUE_WON[2][1] / 1e6, 6);
    expect(drivers.revenue_y1!.source).toContain("DART");
    expect(drivers.initial_investment!.value).toBeCloseTo((REVENUE_WON[2][1] / 1e6) * ACQUISITION_EV_REVENUE_DEFAULT, 4);
    expect(drivers.exit_ev_revenue!.value).toBe(ACQUISITION_EV_REVENUE_DEFAULT);

    // API read path surfaces the line unit (listBusinessCases).
    const apiLine = db
      .query(
        `SELECT l.unit FROM business_case_line l JOIN business_case_model m ON m.id = l.model_id
         WHERE m.project_id = ? AND m.target_id = ? ORDER BY m.created_at DESC, l.id DESC LIMIT 1`,
      )
      .get(projectId, targetAId) as { unit: string | null };
    expect(apiLine.unit).toBe("KRW_M");
  });

  test("(j) comparison basis: anchored vs fallback targets are labeled and a mixed basis is detected", () => {
    const rows = recommendTargetsFromDb(projectId);
    expect(rows.length).toBe(2);
    const byName = new Map(rows.map((r) => [r.companyName, r]));
    // Target A (DART facts) is anchored on company revenue; target B (no
    // company) rides the market-capture fallback — the SAME table, so the
    // read model must expose the basis and flag the mix.
    expect(byName.get("앵커대상")!.anchorMethod).toBe("company_revenue");
    expect(byName.get("실적없는대상")!.anchorMethod).toBe("market_capture");
    expect(methodsMixedAcrossTargets(rows)).toBe(true);
    // One basis only → no warning (the normal brownfield state).
    expect(methodsMixedAcrossTargets(rows.filter((r) => r.anchorMethod === "company_revenue"))).toBe(false);
    // No cases yet → null basis, no mix.
    expect(methodsMixedAcrossTargets(rows.map((r) => ({ ...r, anchorMethod: null })))).toBe(false);
  });

  test("(g) overrides: the exit knob (bc.exit_ev_revenue) is a separate decision; the direct ratio knob wins over both (2026-10-19 entry/exit split)", async () => {
    // 1) Exit knob pinned at 4× — the entry stays at the band-default multiple (3.0
    //    placeholder; no band confirmed in this fixture), the exit follows the knob.
    await recordBusinessCaseParams(db, {
      projectId,
      params: { exit_ev_revenue: 4 },
      rationale: "처분 배수 별도 확정 — 진입보다 보수적 회수 가정 (test)",
      actor: "anchor-test",
    });
    await generateBusinessCases(projectId, { actor: "anchor-test" });
    let drivers = latestDrivers(db, projectId, targetAId, "base");
    expect(drivers.initial_investment!.value).toBeCloseTo(ANCHOR_KRW_M * 3, 4);
    expect(drivers.exit_ev_revenue!.value).toBe(4);
    expect(noteOf(db, projectId, targetAId, "base")).toContain("exit_ev=4.00x");

    // 2) User pins the direct ratio knob — the ratio model wins and the
    // acquisition pricing (entry AND exit) is off.
    await recordBusinessCaseParams(db, {
      projectId,
      params: { initial_investment_ratio: 0.5 },
      rationale: "인수가 아닌 시설 투자 기준으로 재검토 (test)",
      actor: "anchor-test",
    });
    await generateBusinessCases(projectId, { actor: "anchor-test" });
    drivers = latestDrivers(db, projectId, targetAId, "base");
    const y1 = drivers.revenue_y1!.value as number;
    expect(drivers.initial_investment!.value).toBeCloseTo(y1 * 0.5, 4);
    expect(drivers.exit_ev_revenue).toBeUndefined();
    expect(noteOf(db, projectId, targetAId, "base")).not.toContain("acq_ev=");
  });

  test("(d) greenfield/project-level inputs gain no anchor (legacy numbers untouched)", () => {
    const inputs = caseInputsForProject(projectId);
    expect(inputs.revenueAnchor).toBeUndefined();
    // Promotion provisionally binds md_project.company_id to the rank-1
    // target's company, so the growth model may KNOW that revenue — but the
    // project-level path (greenfield semantics, legacy seeds) must not adopt
    // it as an anchor. Only the per-target path does.
  });
});

function revenueLineOf(db: ReturnType<typeof getDb>, projectId: string, targetId: string, scenario: string): number {
  const row = db
    .query(
      `SELECT l.annual_amount_krw_m FROM business_case_line l
       JOIN business_case_model m ON m.id = l.model_id
       JOIN valuation_simulation v ON v.model_id = m.id AND v.percentile = 'p50'
       WHERE m.project_id = ? AND m.target_id = ? AND v.scenario = ? AND l.category = 'revenue'
       ORDER BY m.created_at DESC LIMIT 1`,
    )
    .get(projectId, targetId, scenario) as { annual_amount_krw_m: number };
  if (!row) throw new Error(`revenue line not found: ${targetId}/${scenario}`);
  return row.annual_amount_krw_m;
}

function p50Of(db: ReturnType<typeof getDb>, projectId: string, targetId: string, scenario: string, variant: string): number {
  const row = db
    .query(
      `SELECT v.npv_krw_m FROM valuation_simulation v
       JOIN business_case_model m ON m.id = v.model_id
       WHERE m.project_id = ? AND m.target_id = ? AND v.scenario = ? AND m.variant = ? AND v.percentile = 'p50'
       ORDER BY m.created_at DESC LIMIT 1`,
    )
    .get(projectId, targetId, scenario, variant) as { npv_krw_m: number };
  if (!row) throw new Error(`p50 not found: ${targetId}/${scenario}/${variant}`);
  return row.npv_krw_m;
}

function latestDrivers(
  db: ReturnType<typeof getDb>,
  projectId: string,
  targetId: string,
  scenario: string,
): Record<string, { value?: number | number[]; source?: string }> {
  const row = db
    .query(
      `SELECT m.inputs_json FROM business_case_model m
       JOIN valuation_simulation v ON v.model_id = m.id AND v.percentile = 'p50'
       WHERE m.project_id = ? AND m.target_id = ? AND v.scenario = ? AND m.variant = 'market_forward'
       ORDER BY m.created_at DESC LIMIT 1`,
    )
    .get(projectId, targetId, scenario) as { inputs_json: string };
  if (!row) throw new Error(`snapshot not found: ${targetId}/${scenario}`);
  const parsed = JSON.parse(row.inputs_json) as { cases: Array<{ drivers: Record<string, { value?: number | number[]; source?: string }> }> };
  return parsed.cases[0].drivers;
}

function noteOf(db: ReturnType<typeof getDb>, projectId: string, targetId: string, scenario: string): string {
  const row = db
    .query(
      `SELECT v.note FROM valuation_simulation v
       JOIN business_case_model m ON m.id = v.model_id
       WHERE m.project_id = ? AND m.target_id = ? AND v.scenario = ? AND v.percentile = 'p50'
       ORDER BY m.created_at DESC LIMIT 1`,
    )
    .get(projectId, targetId, scenario) as { note: string };
  if (!row) throw new Error(`note not found: ${targetId}/${scenario}`);
  return row.note;
}
