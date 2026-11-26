// @version 1.0.0
/**
 * ADR-0208 slice 1 - credit-rating-aware spread suggestion: GET .../wacc/suggestions (rating fields, basis
 * ladder, ECOS month alignment, apply-all exclusion of the default rating, no-company behaviour) and the
 * server-derived confirmation audit on POST .../wacc (rating / source / spread basis re-derived from stored
 * ECOS evidence, client edited flag ignored, kd_ge_ke warning). Real route handlers + scratch SQLite.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wacc-credit-spread-reference.sqlite";
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
const { RF_SERIES_ID, CORP_BOND_SERIES_ID, CORP_BOND_BBBM_SERIES_ID, deriveCreditSpreadAt } = await import(
  "../../db/lib/wacc-reference.ts"
);

const NOW = "2026-11-26T00:00:00.000Z";
const USER = "cs-analyst";
const PW = "pw-cs-analyst-12345";
let cookie = "";
let unitId = "";
let sourceId = "";
let companyId = "";

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
/** ECOS 2026-10 illustration of the design: KTB 3.861, AA- 4.549, BBB- 10.358. */
function seedFull(ym = "2026-10") {
  obs(RF_SERIES_ID, ym, 3.861);
  obs(CORP_BOND_SERIES_ID, ym, 4.549);
  obs(CORP_BOND_BBBM_SERIES_ID, ym, 10.358);
}

function newProject(no: string, withCompany = true): string {
  const p = createProject(no).id;
  if (withCompany) db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [companyId, p]);
  grantProjectMembership(db, {
    projectId: p,
    userId: USER,
    projectRole: "lead",
    grantedBy: USER,
    needToKnowBasis: "credit spread reference test",
    now: NOW,
  });
  return p;
}
async function suggestions(project: string) {
  const res = await req(`/api/projects/${project}/wacc/suggestions`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()).data as {
    suggestions: Array<Record<string, any>>;
    apply_all_excluded: Array<Record<string, any>>;
    missing: string[];
  };
}
const credit = (d: { suggestions: Array<Record<string, any>> }) =>
  d.suggestions.find((s) => s.key === "credit_spread")!;

let projectA = "";
let projectNoCompany = "";

beforeAll(async () => {
  unitId = ulid();
  sourceId = ulid();
  db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)", [
    unitId,
    "PCT.CS",
    "dimensionless",
    1,
    NOW,
  ]);
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
    sourceId,
    "TESTECOS-CS",
    "A",
    NOW,
  ]);
  await createUser(db, { userId: USER, role: "analyst", password: PW, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: USER, password: PW }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  companyId = ulid();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?, 'cs-test-company', ?)", [companyId, NOW]);
  projectA = newProject("NP-CS-1");
  projectNoCompany = newProject("NP-CS-NOCO-1", false);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(ENV_ORIGINALS)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET .../wacc/suggestions - credit_spread", () => {
  test("all three ECOS series: default BBB- is mapped to the BBB- anchor with full provenance fields", async () => {
    clearObs();
    seedFull();
    const d = await suggestions(projectA);
    const c = credit(d);
    expect(c.key).toBe("credit_spread");
    expect(c.value).toBeCloseTo(6.497, 6); // percent points, BBB- yield minus KTB 3y of the same month
    expect(c.as_of).toBe("2026-10");
    expect(c.anchor_ref).toBe("src:ecos");
    expect(c).toMatchObject({
      rating: "BBB-",
      rating_source: "default",
      rating_stale: false,
      rating_agencies: [],
      rating_instrument: null,
      source_rcept_no: null,
      spread_basis: "ecos_interpolated",
      derived: false,
      flags: [],
      synthetic: null,
      crosscheck: null,
      issuance_evidence: [],
      // ADR-0208 slice 2: home-page links of the registered agencies are a human verification aid, always offered
      agency_links: [
        { agency: "korea-ratings", home_url: "https://www.korearatings.com" },
        { agency: "kis", home_url: "https://www.kisrating.com" },
        { agency: "nice", home_url: "https://www.nicerating.com" },
      ],
      // the test company has no DART corp code: the disclosed rung cannot run, so there is nothing to collect
      collect_hint: false,
      disclosed_status: "no_dart_corp_code",
      credit_rating_snapshot_id: null,
      reason_code: "no_disclosed_rating_and_synthetic_unavailable",
      spread_reason_code: null,
    });
    expect(typeof c.reason).toBe("string");
    expect(c.series_used).toEqual([
      { role: "ktb_3y", series_id: RF_SERIES_ID, value_pct: 3.861 },
      { role: "aa_minus", series_id: CORP_BOND_SERIES_ID, value_pct: 4.549 },
      { role: "bbb_minus", series_id: CORP_BOND_BBBM_SERIES_ID, value_pct: 10.358 },
    ]);
    expect(c.anchors).toMatchObject({
      as_of: "2026-10",
      ktb_pct: 3.861,
      aa_minus_pct: 4.549,
      bbb_minus_pct: 10.358,
      upper_notch: 4,
      lower_notch: 10,
    });
    expect(c.anchors.aa_minus_spread_pp).toBeCloseTo(0.688, 6);
    expect(c.anchors.bbb_minus_spread_pp).toBeCloseTo(6.497, 6);
    expect(c.note).toContain("default placeholder");
    // Kd indicative = latest Rf + spread; the Ke comparison needs the form's beta and stays with the caller
    expect(c.kd_indicative_pct).toBeCloseTo(10.358, 6);
  });

  test("the default rating is excluded from apply-all with a reason code and listed in missing", async () => {
    clearObs();
    seedFull();
    const d = await suggestions(projectA);
    expect(d.apply_all_excluded).toHaveLength(1);
    expect(d.apply_all_excluded[0]).toMatchObject({ key: "credit_spread", reason_code: "credit_rating_default_basis" });
    expect(d.apply_all_excluded[0].reason).toContain("BBB-");
    expect(d.missing.some((m) => m.startsWith("credit_spread: credit_rating_default_basis"))).toBe(true);
    // existing keys keep their place and values
    expect(d.suggestions.map((s) => s.key)).toEqual(["risk_free", "credit_spread", "observed_de", "erp", "tax_rate"]);
    expect(d.suggestions[0]).toMatchObject({ key: "risk_free", value: 3.861, as_of: "2026-10" });
  });

  test("anchors are read at ONE month: the latest month where KTB, AA- and BBB- all exist", async () => {
    clearObs();
    seedFull("2026-09");
    obs(RF_SERIES_ID, "2026-10", 3.9); // newer KTB + AA-, no BBB- that month
    obs(CORP_BOND_SERIES_ID, "2026-10", 4.6);
    const c = credit(await suggestions(projectA));
    expect(c.as_of).toBe("2026-09");
    expect(c.value).toBeCloseTo(6.497, 6);
    expect(c.anchors.ktb_pct).toBe(3.861);
    // Rf of the suggestions stays the latest ECOS risk_free entry
    const d = await suggestions(projectA);
    expect(d.suggestions[0]).toMatchObject({ key: "risk_free", value: 3.9, as_of: "2026-10" });
  });

  test("BBB- series not collected: falls soft to the AA- legacy spread, never a placeholder, still excluded from apply-all", async () => {
    clearObs();
    obs(RF_SERIES_ID, "2026-10", 3.861);
    obs(CORP_BOND_SERIES_ID, "2026-10", 4.549);
    const d = await suggestions(projectA);
    const c = credit(d);
    expect(c.value).toBeCloseTo(0.688, 6);
    expect(c).toMatchObject({
      rating: "BBB-",
      rating_source: "default",
      spread_basis: "aa_minus_legacy",
      spread_reason_code: "anchor_missing",
    });
    expect(c.spread_reason).toContain("legacy");
    expect(d.apply_all_excluded.map((x) => x.key)).toEqual(["credit_spread"]);
  });

  test("no ECOS data at all: null entry with the legacy reason; nothing to exclude from apply-all", async () => {
    clearObs();
    const d = await suggestions(projectA);
    const c = credit(d);
    expect(c.value).toBeNull();
    expect(typeof c.reason).toBe("string");
    expect(d.apply_all_excluded).toEqual([]);
  });

  test("no company bound: no credit suggestion (unchanged), no credit apply-all exclusion", async () => {
    clearObs();
    seedFull();
    const d = await suggestions(projectNoCompany);
    expect(d.suggestions.map((s) => s.key)).toEqual(["erp", "tax_rate"]);
    expect(d.apply_all_excluded.some((x) => x.key === "credit_spread")).toBe(false);
  });

  test("an outsider cannot read the suggestions (404, not 403)", async () => {
    await createUser(db, {
      userId: "cs-outsider",
      role: "analyst",
      password: "pw-outsider-12345",
      createdBy: "test",
      now: NOW,
    });
    approveUser(db, { userId: "cs-outsider", approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const res = await req("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: "cs-outsider", password: "pw-outsider-12345" }),
    });
    const outsider = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
    const r = await req(`/api/projects/${projectA}/wacc/suggestions`, { headers: { cookie: outsider } });
    expect(r.status).toBe(404);
  });
});

describe("deriveCreditSpreadAt (audit re-derivation)", () => {
  test("re-derives rating, source and basis from stored ECOS at a given month; unknown month fails", () => {
    clearObs();
    seedFull("2026-10");
    const r = deriveCreditSpreadAt(db, "2026-10");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r).toMatchObject({ rating: "BBB-", rating_source: "default" });
      expect(r.mapped.basis).toBe("ecos_interpolated");
      expect(r.mapped.spreadPct).toBeCloseTo(6.497, 6);
    }
    expect(deriveCreditSpreadAt(db, "2026-08")).toMatchObject({ ok: false, reason_code: "no_ecos_observations" });
  });
});

// ── POST .../wacc confirmation audit ──
const CAPM = (spread: Record<string, unknown>, extra: Array<Record<string, unknown>> = []) => [
  { key: "wacc.risk_free", value: 0.03, kind: "live", source_label: "ECOS", anchor_ref: "src:ecos" },
  { key: "wacc.erp", value: 0.05, kind: "user" },
  { key: "wacc.beta_unlevered", value: 1.0, kind: "derived" },
  { key: "wacc.target_de", value: 0.5, kind: "user" },
  { key: "wacc.tax_rate", value: 0.24, kind: "user" },
  spread,
  ...extra,
];
async function confirm(spread: Record<string, unknown>, project = projectA) {
  return req(`/api/projects/${project}/wacc`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ wacc: 0.09, mode: "capm", components: CAPM(spread) }),
  });
}
const spreadAudit = (runId: string) =>
  db
    .query("SELECT target FROM audit_log WHERE action = 'assumption_set' AND target LIKE ?")
    .all(`${runId}:wacc.debt_spread:%`) as Array<{ target: string }>;
const runCount = () =>
  (db.query("SELECT COUNT(*) AS n FROM run WHERE project_id = ?").get(projectA) as { n: number }).n;
const rationaleOf = (runId: string) =>
  db
    .query("SELECT kind, rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.debt_spread'")
    .get(runId) as { kind: string; rationale: string };

describe("POST /api/projects/[id]/wacc - credit-rating audit (server-derived)", () => {
  const applied = (over: Record<string, unknown> = {}) => ({
    key: "wacc.debt_spread",
    value: 0.06497,
    kind: "user",
    source_label: "ECOS rating-mapped spread",
    anchor_ref: "src:ecos",
    as_of: "2026-10",
    credit_rating_basis: "default",
    reference_as_of: "2026-10",
    ...over,
  });

  test("applied default reference: stays kind=user; rating / source / spread basis are recorded from the server re-derivation", async () => {
    clearObs();
    seedFull();
    const res = await confirm(applied());
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    const row = rationaleOf(runId);
    expect(row.kind).toBe("user");
    expect(row.rationale).toContain("credit_rating=BBB-");
    expect(row.rationale).toContain("credit_rating_source=default");
    expect(row.rationale).toContain("spread_basis=ecos_interpolated");
    expect(row.rationale).toContain("reference_as_of=2026-10");
    expect(row.rationale).not.toContain("edited_from_reference");
    expect(spreadAudit(runId).map((a) => a.target)).toEqual([
      `${runId}:wacc.debt_spread:user:credit_rating=BBB-:credit_rating_source=default:spread_basis=ecos_interpolated:edited_from_reference=false`,
    ]);
  });

  test("the edited flag is derived by the server: client flag false is ignored when the value differs, true when it does not", async () => {
    clearObs();
    seedFull();
    const edited = await confirm(applied({ value: 0.05, edited_from_reference: false }));
    expect(edited.status).toBe(201);
    const runA = (await edited.json()).data.run_id as string;
    expect(rationaleOf(runA).rationale).toContain("edited_from_reference: true");
    expect(spreadAudit(runA)[0].target).toEndWith("edited_from_reference=true");

    const same = await confirm(applied({ edited_from_reference: true }));
    expect(same.status).toBe(201);
    const runB = (await same.json()).data.run_id as string;
    expect(rationaleOf(runB).rationale).not.toContain("edited_from_reference");
    expect(spreadAudit(runB)[0].target).toEndWith("edited_from_reference=false");
  });

  test("the cited month is re-derived (an older month carries its own anchors)", async () => {
    clearObs();
    seedFull("2026-10");
    obs(RF_SERIES_ID, "2026-07", 3.0);
    obs(CORP_BOND_SERIES_ID, "2026-07", 3.9);
    obs(CORP_BOND_BBBM_SERIES_ID, "2026-07", 8.4);
    const res = await confirm(applied({ value: 0.054, reference_as_of: "2026-07", as_of: "2026-07" }));
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    expect(rationaleOf(runId).rationale).toContain("reference_as_of=2026-07");
    expect(spreadAudit(runId)[0].target).toEndWith("edited_from_reference=false"); // 8.4 - 3.0 = 5.4 pp
  });

  test("manual spread audits exactly as before (no credit suffix, no credit notes)", async () => {
    const res = await confirm({ key: "wacc.debt_spread", value: 0.02, kind: "user", rationale: "analyst judgement" });
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    expect(spreadAudit(runId).map((a) => a.target)).toEqual([`${runId}:wacc.debt_spread:user`]);
    expect(rationaleOf(runId).rationale).toBe("analyst judgement");
  });

  test("a cited month with no ECOS evidence is 400 and creates no run", async () => {
    clearObs();
    seedFull();
    const before = runCount();
    const res = await confirm(applied({ reference_as_of: "2026-03" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("invalid_request");
    expect(runCount()).toBe(before);
  });

  test("a basis the server cannot resolve (disclosed / synthetic) is 400 and creates no run", async () => {
    clearObs();
    seedFull();
    const before = runCount();
    for (const basis of ["disclosed", "synthetic"]) {
      const res = await confirm(applied({ credit_rating_basis: basis }));
      expect(res.status).toBe(400);
    }
    expect(runCount()).toBe(before);
  });

  test("malformed credit fields are 400: bad basis, bad month, missing partner field, wrong component", async () => {
    clearObs();
    seedFull();
    for (const bad of [
      applied({ credit_rating_basis: "aaa" }),
      applied({ credit_rating_basis: 1 }),
      applied({ reference_as_of: "2026-13" }),
      applied({ reference_as_of: "2026-10-01" }),
      applied({ reference_as_of: 202610 }),
      applied({ reference_as_of: undefined }),
      applied({ credit_rating_basis: undefined }),
    ]) {
      const res = await confirm(bad);
      expect(res.status).toBe(400);
    }
    const res = await req(`/api/projects/${projectA}/wacc`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        wacc: 0.09,
        mode: "capm",
        components: CAPM({ key: "wacc.debt_spread", value: 0.02, kind: "user" }).map((c) =>
          c.key === "wacc.tax_rate" ? { ...c, credit_rating_basis: "default", reference_as_of: "2026-10" } : c,
        ),
      }),
    });
    expect(res.status).toBe(400);
  });

  test("kd_ge_ke: a market-built Kd at or above Ke is a warning only, never a block", async () => {
    // Ke = 0.03 + 1.38 x 0.05 = 0.099; Kd = 0.03 + 0.10 = 0.13
    const high = await confirm({ key: "wacc.debt_spread", value: 0.1, kind: "user" });
    expect(high.status).toBe(201);
    expect((await high.json()).data.warnings).toContain("kd_ge_ke");
    const low = await confirm({ key: "wacc.debt_spread", value: 0.02, kind: "user" });
    expect(low.status).toBe(201);
    expect((await low.json()).data.warnings).not.toContain("kd_ge_ke");
  });
});
