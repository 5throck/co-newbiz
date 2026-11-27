// @version 1.0.0
/**
 * ADR-0208 slice 4 - spread basis precedence with stored KOFIA grade yields, through the API: GET .../wacc/suggestions and
 * the server-derived confirmation audit. Real route handlers + scratch SQLite; the KOFIA day is stored with the real collector
 * over the recorded fixtures (2026-11-26: A 4.934, KTB 3y 3.612, BBB- 10.070 ...).
 * Covers: kofia_grade outranks the ECOS bases (value = grade yield - same-date KTB, as-of month, kofia detail with date/series/
 * source URL, anchor_ref src:kofia, series_used, Kd = ECOS Rf + spread); no KOFIA data keeps ecos_interpolated; a newer ECOS month
 * wins over older KOFIA data; a rating KOFIA does not publish (D, BB+ and below) falls back to ECOS; stored data is read with the
 * collection switch OFF; the confirmation audit re-derives basis, date and series from the cited month (and the ECOS month with no
 * KOFIA data stays ecos_interpolated); apply-all exclusions are unchanged.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_PATH = "db/data/test-wacc-kofia-spread.sqlite";
const ENV_ORIGINALS: Record<string, string | undefined> = {
  CO_NEWBIZ_DB_PATH: process.env.CO_NEWBIZ_DB_PATH,
  CO_NEWBIZ_KOFIA_COLLECT: process.env.CO_NEWBIZ_KOFIA_COLLECT,
};
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
delete process.env.CO_NEWBIZ_KOFIA_COLLECT;
// Hermetic: the repo-root .env (CO_NEWBIZ_KOFIA_COLLECT=on on a dev machine) must not be re-read into the unset switch.
const restoreRootEnv = await (await import("./helpers/isolate-root-env.ts")).isolateRootEnv();
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
const { collectKofiaGradeYields } = await import("../../app/web-next/lib/kofia-collector.ts");
const { KOFIA_PAGE_URL } = await import("../../db/lib/kofia-grade-yield.ts");

const NOW = new Date().toISOString();
const PW = "pw-kf-analyst-12345";
const USER = "kf-analyst";
const B = 1e9;
let cookie = "";
let unitId = "";
let sourceId = "";
const req = (path: string, init?: RequestInit) => nextRequest(path, init);
const fx = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "kofia", name), "utf8");

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
function seedEcos(ym = "2026-10") {
  obs(RF_SERIES_ID, ym, 3.861);
  obs(CORP_BOND_SERIES_ID, ym, 4.549);
  obs(CORP_BOND_BBBM_SERIES_ID, ym, 10.358);
}
/** Store the recorded KOFIA day 2026-11-26 through the real collector (switch on only for the call). */
async function seedKofia() {
  process.env.CO_NEWBIZ_KOFIA_COLLECT = "on";
  try {
    await collectKofiaGradeYields(db, new Date(), {
      async post(body: string) {
        const fn = body.match(/<pfmFnName>(\w+)<\/pfmFnName>/)?.[1];
        return fx(
          fn === "getExistMaxDate"
            ? "get-exist-max-date.xml"
            : fn === "getHeadList"
              ? "get-head-list.xml"
              : "select-day-average.xml",
        );
      },
    });
  } finally {
    delete process.env.CO_NEWBIZ_KOFIA_COLLECT;
  }
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

let seq = 0;
/** Coverage 4.5 -> synthetic rating A (op 450bn / interest 100bn); a loss-making company -> synthetic D. */
function arrange(opIncome = 450 * B) {
  const c = ulid();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [c, `kf-co-${++seq}`, NOW]);
  fact(c, 2025, OP, opIncome);
  fact(c, 2025, INT_CF, 100 * B);
  const p = createProject(`NP-KF-${seq}`).id;
  db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [c, p]);
  grantProjectMembership(db, {
    projectId: p,
    userId: USER,
    projectRole: "lead",
    grantedBy: USER,
    needToKnowBasis: "kofia spread test",
    now: NOW,
  });
  return p;
}
const suggestions = async (project: string) => {
  const res = await req(`/api/projects/${project}/wacc/suggestions`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()).data as {
    suggestions: Array<Record<string, any>>;
    apply_all_excluded: Array<Record<string, any>>;
  };
};
const credit = (d: { suggestions: Array<Record<string, any>> }) =>
  d.suggestions.find((s) => s.key === "credit_spread")!;

beforeAll(async () => {
  unitId = ulid();
  sourceId = ulid();
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [
    unitId,
    "PCT.KF",
    "dimensionless",
    1,
    NOW,
  ]);
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
    sourceId,
    "TESTECOS-KF",
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
  restoreRootEnv();
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(ENV_ORIGINALS)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET .../wacc/suggestions - basis precedence", () => {
  test("no KOFIA data: the ECOS interpolation, no kofia detail (unchanged behaviour, switch off)", async () => {
    clearObs();
    seedEcos();
    const c = credit(await suggestions(arrange()));
    expect(c).toMatchObject({ rating: "A", spread_basis: "ecos_interpolated", kofia: null, kofia_latest_date: null });
    expect(c.value).toBeCloseTo(1.454, 2);
  });

  test("KOFIA stored (same month as ECOS or newer): kofia_grade = grade yield - same-date KTB; Kd = ECOS Rf + spread", async () => {
    clearObs();
    seedEcos();
    await seedKofia();
    const d = await suggestions(arrange());
    const c = credit(d);
    expect(c).toMatchObject({
      rating: "A",
      rating_source: "synthetic",
      spread_basis: "kofia_grade",
      derived: false,
      flags: [],
      as_of: "2026-11",
      anchor_ref: "src:kofia",
      kofia_latest_date: "2026-11-26",
    });
    expect(c.value).toBeCloseTo(4.934 - 3.612, 6); // 1.322, not the 1.454 interpolation
    expect(c.kofia).toMatchObject({
      date: "2026-11-26",
      grade: "A",
      tenor: "3y",
      grade_yield_pct: 4.934,
      ktb_pct: 3.612,
      series_id: "kofia:corp-public-unsecured:A:3y",
      ktb_series_id: "kofia:ktb:3y",
      source_url: KOFIA_PAGE_URL,
    });
    expect(c.source_label).toContain("2026-11-26");
    expect(c.series_used).toEqual([
      { role: "ktb_3y", series_id: "kofia:ktb:3y", value_pct: 3.612 },
      { role: "grade_yield", series_id: "kofia:corp-public-unsecured:A:3y", value_pct: 4.934 },
    ]);
    // anchors line: KOFIA AA- / BBB- of the same date, KTB of the same date
    expect(c.anchors).toMatchObject({ as_of: "2026-11", ktb_pct: 3.612, aa_minus_pct: 4.274, bbb_minus_pct: 10.07 });
    // Rf of the suggestion stays the ECOS risk_free entry (3.861 of 2026-10)
    expect(c.kd_indicative_pct).toBeCloseTo(3.861 + (4.934 - 3.612), 6);
    expect(d.suggestions.find((s) => s.key === "risk_free")?.value).toBeCloseTo(3.861, 6);
    // the rating is a synthetic estimate: still excluded from apply-all, as before
    expect(d.apply_all_excluded.map((x) => x.reason_code)).toContain("credit_rating_synthetic_basis");
  });

  test("works without any ECOS data (KOFIA alone)", async () => {
    clearObs();
    await seedKofia();
    const c = credit(await suggestions(arrange()));
    expect(c.spread_basis).toBe("kofia_grade");
    expect(c.value).toBeCloseTo(1.322, 6);
  });

  test("a newer ECOS month wins over older KOFIA data", async () => {
    clearObs();
    seedEcos("2026-12");
    await seedKofia(); // 2026-11-26
    const c = credit(await suggestions(arrange()));
    expect(c.spread_basis).toBe("ecos_interpolated");
    expect(c.as_of).toBe("2026-12");
    expect(c.kofia).toBeNull();
    expect(c.kofia_latest_date).toBe("2026-11-26"); // still reported for the collect row
  });

  test("a rating KOFIA does not publish (loss-making -> D) falls back to the ECOS bases", async () => {
    clearObs();
    seedEcos();
    await seedKofia();
    const c = credit(await suggestions(arrange(-10 * B)));
    expect(c.rating).toBe("D");
    expect(c.spread_basis).toBe("ecos_interpolated");
    expect(c.kofia).toBeNull();
    expect(c.flags).toContain("below_investment_grade_series_understates");
  });

  test("the default BBB- rating uses the KOFIA BBB- yield (10.070 - 3.612)", async () => {
    clearObs();
    seedEcos();
    await seedKofia();
    const c0 = ulid();
    db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", [c0, "kf-noev", NOW]);
    const p = createProject(`NP-KF-${++seq}`).id;
    db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [c0, p]);
    grantProjectMembership(db, {
      projectId: p,
      userId: USER,
      projectRole: "lead",
      grantedBy: USER,
      needToKnowBasis: "kofia spread test",
      now: NOW,
    });
    const c = credit(await suggestions(p));
    expect(c).toMatchObject({ rating: "BBB-", rating_source: "default", spread_basis: "kofia_grade" });
    expect(c.value).toBeCloseTo(10.07 - 3.612, 6);
  });
});

// ── POST .../wacc confirmation audit ──
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
const rationaleOf = (runId: string) =>
  (
    db
      .query("SELECT rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.debt_spread'")
      .get(runId) as { rationale: string }
  ).rationale;
const spreadAudit = (runId: string) =>
  (
    db
      .query("SELECT target FROM audit_log WHERE action = 'assumption_set' AND target LIKE ?")
      .all(`${runId}:wacc.debt_spread:%`) as Array<{ target: string }>
  ).map((a) => a.target);

describe("POST /api/projects/[id]/wacc - the server re-derives the KOFIA basis", () => {
  const applied = (over: Record<string, unknown> = {}) => ({
    key: "wacc.debt_spread",
    value: 0.01322,
    kind: "user",
    source_label: "KOFIA A",
    anchor_ref: "src:kofia",
    as_of: "2026-11",
    credit_rating_basis: "synthetic",
    reference_as_of: "2026-11",
    ...over,
  });

  test("the cited KOFIA month: basis, date and series come from the re-derivation; unchanged value is not edited", async () => {
    clearObs();
    seedEcos();
    await seedKofia();
    const project = arrange();
    const res = await confirm(project, applied());
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    const r = rationaleOf(runId);
    expect(r).toContain("spread_basis=kofia_grade");
    expect(r).toContain("kofia_date=2026-11-26");
    expect(r).toContain("kofia_series=kofia:corp-public-unsecured:A:3y");
    expect(r).toContain("reference_as_of=2026-11");
    expect(r).not.toContain("edited_from_reference");
    expect(spreadAudit(runId)).toEqual([
      `${runId}:wacc.debt_spread:user:credit_rating=A:credit_rating_source=synthetic:spread_basis=kofia_grade:edited_from_reference=false`,
    ]);
  });

  test("the edited flag is derived against the KOFIA spread (the ECOS-interpolated 1.454 is 'edited')", async () => {
    clearObs();
    seedEcos();
    await seedKofia();
    const res = await confirm(arrange(), applied({ value: 0.01454, edited_from_reference: false }));
    expect(res.status).toBe(201);
    expect(rationaleOf((await res.json()).data.run_id)).toContain("edited_from_reference: true");
  });

  test("the ECOS month (no KOFIA data in it) is still re-derived as ecos_interpolated", async () => {
    clearObs();
    seedEcos();
    await seedKofia();
    const res = await confirm(arrange(), applied({ value: 0.01454, as_of: "2026-10", reference_as_of: "2026-10" }));
    expect(res.status).toBe(201);
    const r = rationaleOf((await res.json()).data.run_id);
    expect(r).toContain("spread_basis=ecos_interpolated");
    expect(r).not.toContain("kofia_date");
    expect(r).not.toContain("edited_from_reference");
  });

  test("a month with neither KOFIA nor ECOS data cannot be re-derived: 400, no run", async () => {
    clearObs();
    seedEcos();
    await seedKofia();
    const project = arrange();
    const res = await confirm(project, applied({ as_of: "2026-03", reference_as_of: "2026-03" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.message).toContain("cannot be re-derived");
    expect((db.query("SELECT COUNT(*) AS n FROM run WHERE project_id = ?").get(project) as { n: number }).n).toBe(0);
  });
});
