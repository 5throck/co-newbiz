// @version 1.0.0
/**
 * ADR-0208 slice 3 through the API: GET .../wacc/suggestions with the synthetic rung (rating, coverage, interest source,
 * period, apply-all inclusion, the ladder against disclosed / bureau ratings, loss-making, financial sector, the
 * re-sync hint, cross-check and issuance evidence in the payload), the pre-tax tax-bracket preference, and the
 * server-derived confirmation audit for credit_rating_basis "synthetic". Real route handlers + scratch SQLite.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wacc-credit-synthetic.sqlite";
const ENV_ORIGINALS: Record<string, string | undefined> = { CO_NEWBIZ_DB_PATH: process.env.CO_NEWBIZ_DB_PATH };
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { grantProjectMembership } = await import("../../db/lib/access-control.ts");
const { createProject } = await import("../../db/repositories/project.repository.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { RF_SERIES_ID, CORP_BOND_SERIES_ID, CORP_BOND_BBBM_SERIES_ID } = await import("../../db/lib/wacc-reference.ts");
const repo = await import("../../db/repositories/dart-credit-rating.repository.ts");
const { CREDIT_RATING_PARSER_VERSION: V, addMonthsIso } = await import("../../db/lib/credit-rating-disclosure.ts");
const { seoulToday } = await import("../../db/lib/iso-date.ts");

const NOW = new Date().toISOString();
const TODAY = seoulToday(new Date());
const ago = (months: number) => addMonthsIso(TODAY, -months);
const PW = "pw-sy-analyst-12345";
const USER = "sy-analyst";
let cookie = "";
let unitId = "";
let sourceId = "";
const B = 1e9;

const req = (path: string, init?: RequestInit) => nextRequest(path, init);

function monthPeriod(ym: string): string {
  const id = `M${ym}`;
  if (!db.query("SELECT 1 FROM md_period WHERE id = ?").get(id)) {
    db.run(
      "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
      [id, "month", `${ym}-01`, `${ym}-28`, Number(ym.slice(0, 4)), NOW],
    );
  }
  return id;
}
function obs(seriesId: string, ym: string, value: number) {
  db.run(
    "INSERT INTO fact_market_observation (series_id, period_id, revision_no, value, unit_id, source_id, content_hash, fetched_at) VALUES (?,?,?,?,?,?,?,?)",
    [seriesId, monthPeriod(ym), 1, value, unitId, sourceId, `h-${seriesId}-${ym}`, NOW],
  );
}
const clearObs = () => db.run("DELETE FROM fact_market_observation");
function seedFull(ym = "2026-10") {
  obs(RF_SERIES_ID, ym, 3.861);
  obs(CORP_BOND_SERIES_ID, ym, 4.549);
  obs(CORP_BOND_BBBM_SERIES_ID, ym, 10.358);
}
function yearPeriod(year: number): string {
  const ex = db.query("SELECT id FROM md_period WHERE period_type = 'year' AND fiscal_year = ?").get(year) as
    | { id: string }
    | undefined;
  if (ex) return ex.id;
  const id = ulid();
  db.run(
    "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
    [id, "year", `${year}-01-01`, `${year}-12-31`, year, NOW],
  );
  return id;
}
function fact(companyId: string, year: number, ifrsCode: string, value: number) {
  const acc = db.query("SELECT id FROM md_account WHERE ifrs_code = ?").get(ifrsCode) as { id: string };
  db.run(
    "INSERT INTO fact_financial (id, company_id, period_id, account_id, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), companyId, yearPeriod(year), acc.id, value, 1, sourceId, NOW],
  );
}
const OP = "ifrs-full_ProfitLossFromOperatingActivities";
const INT_CF = "dart_AdjustmentsForInterestExpenses";
const FIN = "ifrs-full_FinanceCosts";
const PRETAX = "ifrs-full_ProfitLossBeforeTax";
const SHORT = "conewbiz_ShortTermBorrowings";
const LONG = "conewbiz_LongTermBorrowings";

let seq = 0;
function mkCompany(name: string, corp: string | null = null): string {
  const id = ulid();
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [id, name, corp, NOW]);
  return id;
}
function mkProject(companyId: string): string {
  const p = createProject(`NP-SY-${++seq}`).id;
  db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [companyId, p]);
  grantProjectMembership(db, {
    projectId: p,
    userId: USER,
    projectRole: "lead",
    grantedBy: USER,
    needToKnowBasis: "synthetic credit rating test",
    now: NOW,
  });
  return p;
}
/** Coverage 4.5 -> A (op 450bn / interest 100bn); borrowings 1,000bn both years -> implied cost 10%. */
function arrange(corp: string | null = null, name = `sy-co-${seq + 1}`) {
  const c = mkCompany(name, corp);
  fact(c, 2025, OP, 450 * B);
  fact(c, 2025, INT_CF, 100 * B);
  fact(c, 2025, PRETAX, 400 * B);
  fact(c, 2025, SHORT, 400 * B);
  fact(c, 2025, LONG, 600 * B);
  fact(c, 2024, LONG, 1000 * B);
  return { companyId: c, projectId: mkProject(c) };
}

const suggestions = async (project: string) => {
  const res = await req(`/api/projects/${project}/wacc/suggestions`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()).data as {
    suggestions: Array<Record<string, any>>;
    apply_all_excluded: Array<Record<string, any>>;
    missing: string[];
  };
};
const credit = (d: { suggestions: Array<Record<string, any>> }) =>
  d.suggestions.find((s) => s.key === "credit_spread")!;

beforeAll(async () => {
  unitId = ulid();
  sourceId = ulid();
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [
    unitId,
    "PCT.SY",
    "dimensionless",
    1,
    NOW,
  ]);
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
    sourceId,
    "TESTECOS-SY",
    "A",
    NOW,
  ]);
  await createUser(db, { userId: USER, role: "analyst", password: PW, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [USER]);
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: USER, password: PW }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});
afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(ENV_ORIGINALS)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET .../wacc/suggestions - the synthetic rung", () => {
  test("no evidence rung but financials: synthetic rating from coverage, mapped to the spread, EXCLUDED from apply-all (user decision 2026-11-26)", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange();
    const d = await suggestions(projectId);
    const c = credit(d);
    expect(c).toMatchObject({
      rating: "A", // coverage 4.5 is in [4.25, 5.5)
      rating_source: "synthetic",
      rating_stale: false,
      reason_code: "synthetic_rating",
      spread_basis: "ecos_interpolated",
      derived: true,
      credit_rating_snapshot_id: null,
      rating_superseded: null,
    });
    expect(c.synthetic).toMatchObject({
      available: true,
      used: true,
      coverage_x: 4.5,
      interest_source: "interest_expense",
      interest_is_proxy: false,
      fiscal_year: 2025,
      table_id: "damodaran-large-non-financial-2026-01",
      published_label: "A2/A",
      band_lower_x: 4.25,
      band_upper_x: 5.5,
      operating_income_krw_million: 450_000,
      interest_expense_krw_million: 100_000,
      loss_making: false,
    });
    // A is notch 6; spread = s_AA- x r^2 with the 2026-10 anchors (design table: 1.454 pp)
    expect(c.value).toBeCloseTo(1.454, 2);
    expect(c.kd_indicative_pct).toBeCloseTo(3.861 + c.value, 6);
    // NOT part of apply-all (amends ADR-0208 decision 9): listed with its reason, individually applicable
    expect(d.apply_all_excluded.find((x) => x.key === "credit_spread")).toMatchObject({
      reason_code: "credit_rating_synthetic_basis",
    });
    expect(d.missing.some((m) => m.startsWith("credit_spread: credit_rating_synthetic_basis"))).toBe(true);
    expect(c.value).not.toBeNull();
    expect(c.note).toContain("synthetic estimate A");
  });

  test("the cross-check and the issuance status ride in the same entry; the number is untouched by the check", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange();
    const c = credit(await suggestions(projectId));
    // implied cost = 100bn / average(1,000bn, 1,000bn) = 10%; market Kd = Rf + spread = 3.861 + 1.454
    expect(c.crosscheck).toMatchObject({
      status: "warn",
      implied_cost_pct: 10,
      interest_source: "interest_expense",
      fiscal_year: 2025,
      interest_expense_krw_million: 100_000,
      avg_debt_krw_million: 1_000_000,
      debt_basis: "two_year_average",
      direction: "market_below_actual",
      warn_gap_pp: 2,
    });
    expect(c.crosscheck.market_kd_pct).toBeCloseTo(c.kd_indicative_pct, 6);
    expect(c.crosscheck.gap_pp).toBeCloseTo(c.kd_indicative_pct - 10, 5);
    expect(c.issuance_status).toBe("no_dart_corp_code");
    expect(c.issuance_evidence).toEqual([]);
  });

  test("a company without a DART code still gets the rung (it needs financials, not a filing)", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange(null);
    expect(credit(await suggestions(projectId))).toMatchObject({
      rating_source: "synthetic",
      disclosed_status: null,
      collect_hint: false,
    });
  });

  test("a company with a DART code and nothing cached: synthetic is used and the collection is still offered", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange("00666001");
    expect(credit(await suggestions(projectId))).toMatchObject({ rating_source: "synthetic", collect_hint: true });
  });

  test("ladder against stored ratings: a fresh disclosed rating wins; a stale one yields to synthetic and is returned as superseded", async () => {
    clearObs();
    seedFull();
    const fresh = arrange("00666002");
    repo.insertCreditRatingSnapshot(db, {
      corpCode: "00666002",
      sourceKind: "business_report",
      sourceRceptNo: "20260310000801",
      parserVersion: V,
      status: "parsed",
      ratings: [
        {
          source: "section",
          agency: "kis",
          agency_raw: "kis",
          instrument: "corporate_bond",
          grade: "A+",
          grade_raw: "A+",
          outlook: null,
          rated_on: ago(3),
          rated_on_precision: "day",
          excluded_reason: null,
          raw: "",
        },
      ],
      issues: null,
      now: NOW,
    });
    expect(credit(await suggestions(fresh.projectId))).toMatchObject({ rating: "A+", rating_source: "disclosed" });

    db.run("DELETE FROM dart_credit_rating_snapshot");
    repo.insertCreditRatingSnapshot(db, {
      corpCode: "00666002",
      sourceKind: "business_report",
      sourceRceptNo: "20260310000802",
      parserVersion: V,
      status: "parsed",
      ratings: [
        {
          source: "section",
          agency: "kis",
          agency_raw: "kis",
          instrument: "corporate_bond",
          grade: "AA-",
          grade_raw: "AA-",
          outlook: null,
          rated_on: ago(30),
          rated_on_precision: "day",
          excluded_reason: null,
          raw: "",
        },
      ],
      issues: null,
      now: NOW,
    });
    const c = credit(await suggestions(fresh.projectId));
    expect(c).toMatchObject({ rating: "A", rating_source: "synthetic", rating_stale: false });
    expect(c.rating_superseded).toEqual({
      basis: "disclosed",
      rating: "AA-",
      rated_on: ago(30),
      source_rcept_no: "20260310000802",
    });
  });

  test("a fresh bureau rating also beats synthetic", async () => {
    clearObs();
    seedFull();
    db.run("DELETE FROM dart_credit_rating_snapshot");
    const { projectId } = arrange("00666003");
    repo.insertCreditRatingSnapshot(db, {
      corpCode: "00666003",
      sourceKind: "business_report",
      sourceRceptNo: "20260310000803",
      parserVersion: V,
      status: "parsed",
      ratings: [
        {
          source: "section",
          agency: "nice-dnb",
          agency_raw: "NICE디앤비",
          instrument: "issuer_bureau",
          grade: "BBB",
          grade_raw: "BBB",
          outlook: null,
          rated_on: ago(2),
          rated_on_precision: "day",
          excluded_reason: null,
          raw: "",
          cashflow_grade_raw: "C+",
          agency_carried: false,
        },
      ],
      issues: null,
      now: NOW,
    });
    expect(credit(await suggestions(projectId))).toMatchObject({ rating: "BBB", rating_source: "bureau" });
  });

  test("issuance evidence from the cached issuance table shows next to the estimate", async () => {
    clearObs();
    seedFull();
    db.run("DELETE FROM dart_credit_rating_snapshot");
    const { projectId } = arrange("00666004");
    repo.insertCreditRatingSnapshot(db, {
      corpCode: "00666004",
      sourceKind: "business_report",
      sourceRceptNo: "20260310000804",
      parserVersion: V,
      status: "section_present_no_bond_rating",
      ratings: [],
      issues: [
        {
          issued_on: ago(6),
          instrument: "corporate_bond",
          amount_krw_mn: 200_000,
          coupon_pct: 4.35,
          rating_raw: "A+(한국신용평가)",
          maturity_on: addMonthsIso(TODAY, 30),
          outstanding: true,
          excluded_reason: null,
          raw: "",
        },
      ],
      now: NOW,
    });
    const c = credit(await suggestions(projectId));
    expect(c.rating_source).toBe("synthetic");
    expect(c.issuance_status).toBe("available");
    expect(c.issuance_evidence).toHaveLength(1);
    expect(c.issuance_evidence[0]).toMatchObject({
      amount_krw_million: 200_000,
      coupon_pct: 4.35,
      source_rcept_no: "20260310000804",
    });
  });

  test("loss-making: lowest band, flagged, the BBB- spread with the understatement chip - and excluded from apply-all like every synthetic rating", async () => {
    clearObs();
    seedFull();
    const c0 = mkCompany("sy-loss");
    fact(c0, 2025, OP, -365 * B);
    fact(c0, 2025, FIN, 540 * B);
    const d = await suggestions(mkProject(c0));
    const c = credit(d);
    expect(c).toMatchObject({ rating: "D", rating_source: "synthetic", spread_basis: "ecos_interpolated" });
    expect(c.synthetic).toMatchObject({ loss_making: true, interest_source: "finance_costs", interest_is_proxy: true });
    expect(c.flags).toContain("below_investment_grade_series_understates");
    expect(c.value).toBeCloseTo(6.497, 3);
    expect(d.apply_all_excluded.find((x) => x.key === "credit_spread")?.reason_code).toBe(
      "credit_rating_synthetic_basis",
    );
  });

  test("a synthetic rating whose spread fell back to the AA- legacy value is excluded from apply-all (the synthetic reason applies first)", async () => {
    clearObs();
    obs(RF_SERIES_ID, "2026-10", 3.861);
    obs(CORP_BOND_SERIES_ID, "2026-10", 4.549); // no BBB- anchor: BB+ (below the midpoint) cannot be mapped
    const c0 = mkCompany("sy-legacy");
    fact(c0, 2025, OP, 240 * B);
    fact(c0, 2025, INT_CF, 100 * B); // 2.4 -> BB+
    const d = await suggestions(mkProject(c0));
    const c = credit(d);
    expect(c).toMatchObject({ rating: "BB+", rating_source: "synthetic", spread_basis: "aa_minus_legacy" });
    expect(d.apply_all_excluded.find((x) => x.key === "credit_spread")?.reason_code).toBe(
      "credit_rating_synthetic_basis",
    );
  });

  test("financial-sector company: no synthetic rating, default with the recorded reason, cross-check unavailable", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange(null, "테스트은행");
    const c = credit(await suggestions(projectId));
    expect(c).toMatchObject({ rating: "BBB-", rating_source: "default" });
    expect(c.synthetic).toMatchObject({
      available: false,
      reason_code: "synthetic_not_applicable_financial",
      resync_hint: false,
    });
    expect(c.crosscheck).toMatchObject({
      status: "unavailable",
      reason_code: "crosscheck_unavailable_financial_sector",
    });
  });

  test("financials synced before the extended collector: default, synthetic unavailable WITH the re-sync hint", async () => {
    clearObs();
    seedFull();
    const c0 = mkCompany("sy-old");
    fact(c0, 2025, OP, 100 * B); // operating income only
    const c = credit(await suggestions(mkProject(c0)));
    expect(c).toMatchObject({ rating: "BBB-", rating_source: "default" });
    expect(c.synthetic).toMatchObject({
      available: false,
      reason_code: "synthetic_interest_not_collected",
      resync_hint: true,
    });
    expect(c.reason).toContain("Synthetic rung:");
  });
});

describe("tax-rate bracket with collected pre-tax income", () => {
  test("pre-tax income is preferred over operating income once collected; operating income is the fallback", async () => {
    const withPretax = mkCompany("sy-tax-1");
    fact(withPretax, 2025, OP, 5000 * B);
    fact(withPretax, 2025, PRETAX, 150 * B);
    const a = (await suggestions(mkProject(withPretax))).suggestions.find((s) => s.key === "tax_rate")!;
    expect(a).toMatchObject({
      basis: "bracket_estimate",
      income_account: "pretax_income",
      estimated_income_krw_million: 150_000,
    });
    const opOnly = mkCompany("sy-tax-2");
    fact(opOnly, 2025, OP, 5000 * B);
    const b = (await suggestions(mkProject(opOnly))).suggestions.find((s) => s.key === "tax_rate")!;
    expect(b).toMatchObject({ income_account: "operating_income", estimated_income_krw_million: 5_000_000 });
    expect(a.value).not.toBe(b.value); // a different bracket: the preference changes the suggestion
  });
});

// ── POST .../wacc confirmation audit with credit_rating_basis "synthetic" ──
const CAPM = (spread: Record<string, unknown>) => [
  { key: "wacc.risk_free", value: 0.03, kind: "live", source_label: "ECOS", anchor_ref: "src:ecos" },
  { key: "wacc.erp", value: 0.05, kind: "user" },
  { key: "wacc.beta_unlevered", value: 1.0, kind: "derived" },
  { key: "wacc.target_de", value: 0.5, kind: "user" },
  { key: "wacc.tax_rate", value: 0.24, kind: "user" },
  spread,
];
async function confirm(project: string, spread: Record<string, unknown>) {
  return req(`/api/projects/${project}/wacc`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ wacc: 0.09, mode: "capm", components: CAPM(spread) }),
  });
}
const spreadAudit = (runId: string) =>
  (
    db
      .query("SELECT target FROM audit_log WHERE action = 'assumption_set' AND target LIKE ?")
      .all(`${runId}:wacc.debt_spread:%`) as Array<{ target: string }>
  ).map((a) => a.target);
const rationaleOf = (runId: string) =>
  (
    db
      .query("SELECT rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.debt_spread'")
      .get(runId) as { rationale: string }
  ).rationale;
const runCount = (project: string) =>
  (db.query("SELECT COUNT(*) AS n FROM run WHERE project_id = ?").get(project) as { n: number }).n;

describe("POST /api/projects/[id]/wacc - synthetic credit-rating audit (server-derived)", () => {
  const applied = (over: Record<string, unknown> = {}) => ({
    key: "wacc.debt_spread",
    value: 0.01454,
    kind: "user",
    source_label: "synthetic A",
    anchor_ref: "src:ecos",
    as_of: "2026-10",
    credit_rating_basis: "synthetic",
    reference_as_of: "2026-10",
    ...over,
  });

  test("accepted: stays kind=user; rating, coverage, interest source and period are recorded from the server re-derivation", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange();
    const res = await confirm(projectId, applied());
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    expect(
      db.query("SELECT kind FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.debt_spread'").get(runId),
    ).toEqual({ kind: "user" });
    const r = rationaleOf(runId);
    expect(r).toContain("credit_rating=A;");
    expect(r).toContain("credit_rating_source=synthetic");
    expect(r).toContain("credit_rating_coverage_x=4.5");
    expect(r).toContain("credit_rating_interest_source=interest_expense");
    expect(r).toContain("credit_rating_period=FY2025");
    expect(r).toContain("credit_rating_confidence=estimate");
    expect(r).toContain("spread_basis=ecos_interpolated");
    expect(r).not.toContain("credit_rating_snapshot_id");
    expect(spreadAudit(runId)).toEqual([
      `${runId}:wacc.debt_spread:user:credit_rating=A:credit_rating_source=synthetic:spread_basis=ecos_interpolated:edited_from_reference=false`,
    ]);
  });

  test("the edited flag is derived by the server (a client false is ignored when the value differs)", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange();
    const res = await confirm(projectId, applied({ value: 0.03, edited_from_reference: false }));
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    expect(rationaleOf(runId)).toContain("edited_from_reference: true");
    expect(spreadAudit(runId)[0]).toEndWith("edited_from_reference=true");
  });

  test("the client cannot relabel the basis: 'default' or 'disclosed' while the estimate applies, 'synthetic' while it does not - 400, no run", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange();
    const before = runCount(projectId);
    const asDefault = await confirm(projectId, applied({ credit_rating_basis: "default" }));
    expect(asDefault.status).toBe(400);
    expect(((await asDefault.json()) as any).error.message).toContain(
      "does not match the server-derived basis 'synthetic'",
    );
    const noEvidence = mkCompany("sy-noev");
    const noEvidenceProject = mkProject(noEvidence);
    const claim = await confirm(noEvidenceProject, applied());
    expect(claim.status).toBe(400);
    expect(((await claim.json()) as any).error.message).toContain("does not match the server-derived basis 'default'");
    expect(runCount(projectId)).toBe(before);
    expect(runCount(noEvidenceProject)).toBe(0);
  });

  test("a snapshot id is for disclosed and bureau only: synthetic with one is 400", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange();
    const res = await confirm(projectId, applied({ credit_rating_snapshot_id: ulid() }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.message).toContain(
      "only with credit_rating_basis 'disclosed' or 'bureau'",
    );
  });

  test("a stale ratio of the same company changes nothing: a manual spread audits exactly as before", async () => {
    clearObs();
    seedFull();
    const { projectId } = arrange();
    const manual = await confirm(projectId, {
      key: "wacc.debt_spread",
      value: 0.02,
      kind: "user",
      rationale: "analyst judgement",
    });
    expect(manual.status).toBe(201);
    const m = (await manual.json()).data.run_id as string;
    expect(spreadAudit(m)).toEqual([`${m}:wacc.debt_spread:user`]);
  });
});
