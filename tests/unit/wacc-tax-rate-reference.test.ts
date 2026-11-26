// @version 1.0.0
/**
 * ADR-0207 addendum - statutory marginal corporate tax rate reference: registry reader, bracket
 * boundaries, income lookup (fact_financial), fallbacks, GET .../wacc/suggestions (KR / non-KR /
 * no company / no financials) and the confirmation audit on POST .../wacc. Real route handlers +
 * scratch SQLite; the registry is the shipped region-profiles/KR.yaml (read-only).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-wacc-tax-rate-reference.sqlite";
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
const tax = await import("../../db/lib/tax-rate-reference.ts");

const NOW = "2026-11-26T00:00:00.000Z";
const USER = "tax-analyst";
const PW = "pw-tax-analyst-12345";
const EOK = 100_000_000; // 1 eok KRW

let cookie = "";
let projectKr = "";
let projectNoCompany = "";
let projectOther = "";
let projectLoss = "";
let projectNoFin = "";
let companyProfit = "";
let companyLoss = "";
let companyNoFin = "";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}

function newCompany(label: string): string {
  const id = crypto.randomUUID();
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?, ?, ?)", [id, label, NOW]);
  return id;
}
function periodFor(year: number): string {
  const existing = db.query("SELECT id FROM md_period WHERE period_type = 'year' AND fiscal_year = ?").get(year) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?, 'year', ?, ?, ?, ?)",
    [id, `${year}-01-01`, `${year}-12-31`, year, NOW],
  );
  return id;
}
function accountFor(ifrs: string): string {
  const row = db.query("SELECT id FROM md_account WHERE ifrs_code = ?").get(ifrs) as { id: string } | undefined;
  if (row) return row.id;
  const id = crypto.randomUUID();
  db.run("INSERT INTO md_account (id, ifrs_code, name_ko, name_en, created_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    ifrs,
    `test-${ifrs}`,
    `test-${ifrs}`,
    NOW,
  ]);
  return id;
}
const OPERATING = "ifrs-full_ProfitLossFromOperatingActivities";
const PRETAX = "ifrs-full_ProfitLossBeforeTax";
function addFact(company: string, ifrs: string, year: number, value: number, revision = 1) {
  db.run(
    "INSERT INTO fact_financial (id, company_id, period_id, account_id, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,NULL,?)",
    [crypto.randomUUID(), company, periodFor(year), accountFor(ifrs), value, revision, NOW],
  );
}

function newProject(no: string, companyId: string | null, scopeRegions?: string[]): string {
  const p = createProject(no).id;
  if (companyId) db.run("UPDATE md_project SET company_id = ? WHERE id = ?", [companyId, p]);
  if (scopeRegions) {
    const opp = crypto.randomUUID();
    db.run(
      "INSERT INTO opportunity (id, name, status, created_at, created_by, target_scope_json) VALUES (?, 'tax-test', 'assessed', ?, 'test', ?)",
      [
        opp,
        NOW,
        JSON.stringify({ regions: scopeRegions, segments: [], unit_basis: "krw_m_year", set_by: "test", set_at: NOW }),
      ],
    );
    db.run("UPDATE md_project SET source_opportunity_id = ? WHERE id = ?", [opp, p]);
  }
  grantProjectMembership(db, {
    projectId: p,
    userId: USER,
    projectRole: "lead",
    grantedBy: USER,
    needToKnowBasis: "tax rate reference test",
    now: NOW,
  });
  return p;
}

beforeAll(async () => {
  await createUser(db, { userId: USER, role: "analyst", password: PW, createdBy: "test", now: NOW });
  approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: USER, password: PW }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];

  companyProfit = newCompany("tax-profit");
  addFact(companyProfit, OPERATING, 2023, 150 * EOK); // older year, ignored
  addFact(companyProfit, OPERATING, 2024, 5 * 100 * EOK); // 500 eok = 50,000 million -> 20bn..300bn bracket
  companyLoss = newCompany("tax-loss");
  addFact(companyLoss, OPERATING, 2024, -30 * EOK);
  companyNoFin = newCompany("tax-nofin");

  projectKr = newProject("NP-TAX-KR-1", companyProfit, ["kr"]);
  projectLoss = newProject("NP-TAX-LOSS-1", companyLoss, ["kr"]);
  projectNoFin = newProject("NP-TAX-NOFIN-1", companyNoFin, ["kr"]);
  projectNoCompany = newProject("NP-TAX-NOCO-1", null);
  projectOther = newProject("NP-TAX-OTHER-1", companyProfit, ["na"]);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
  for (const [k, v] of Object.entries(ENV_ORIGINALS)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const reg = tax.loadKrTaxRegistry();
if (!reg.ok) throw new Error("shipped KR tax registry must load");
const general = reg.registry.schedules.find((s) => s.id === "general-domestic")!;
const sincere = reg.registry.schedules.find((s) => s.id === "sincere-filing-corp")!;

// ── registry reader + bracket boundaries (pure) ──
describe("tax-rate-reference registry reader", () => {
  test("shipped KR registry loads: default general-domestic, 4 brackets 11 / 22 / 24.2 / 27.5, provenance present", () => {
    expect(reg.registry.default_schedule_id).toBe("general-domestic");
    expect(reg.registry.effective_from).toBe("2026-01-01");
    expect(reg.registry.verified_on).toBe("2026-11-26");
    expect(reg.registry.maintainer).toBe("financial-analyst");
    expect(reg.registry.local_rate_ratio).toBe(0.1);
    expect(general.brackets.map((b) => b.combined_rate_pct)).toEqual([11, 22, 24.2, 27.5]);
    expect(sincere.brackets.map((b) => b.combined_rate_pct)).toEqual([22, 24.2, 27.5]);
    expect(general.url.startsWith("https://")).toBe(true);
  });

  test("bracket boundaries are upper-inclusive (an income equal to the bound stays in that bracket)", () => {
    const rate = (sc: typeof general, krw: number) => tax.selectBracket(sc, krw).combined_rate_pct;
    expect(rate(general, 1)).toBe(11);
    expect(rate(general, 2 * EOK)).toBe(11);
    expect(rate(general, 2 * EOK + 1)).toBe(22);
    expect(rate(general, 200 * EOK)).toBe(22);
    expect(rate(general, 200 * EOK + 1)).toBe(24.2);
    expect(rate(general, 3000 * EOK)).toBe(24.2);
    expect(rate(general, 3000 * EOK + 1)).toBe(27.5);
    expect(rate(general, 10 ** 15)).toBe(27.5);
    // the sincere-filing schedule has no 10% bracket
    expect(rate(sincere, 1)).toBe(22);
    expect(rate(sincere, 200 * EOK)).toBe(22);
    expect(rate(sincere, 200 * EOK + 1)).toBe(24.2);
    expect(rate(sincere, 3000 * EOK + 1)).toBe(27.5);
  });

  test("bracket id is <schedule>.<lower_krw> and resolves back through the audit helper", () => {
    expect(tax.taxBracketId("general-domestic", general.brackets[1])).toBe("general-domestic.200000000");
    expect(tax.isValidTaxBracketId("general-domestic.200000000")).toBe(true);
    expect(tax.isValidTaxBracketId("has space")).toBe(false);
    expect(tax.isValidTaxBracketId(7)).toBe(false);
  });

  test("missing section and malformed registries give an unavailable result, never a value", () => {
    const none = tax.parseTaxRegistry({});
    expect(none).toMatchObject({ ok: false, reason_code: "tax_rate_no_registry" });
    const section = (over: Record<string, unknown>) => ({
      corporate_tax_rates: {
        source: "s",
        verified_on: "2026-11-26",
        maintainer: "m",
        data: {
          effective_from: "2026-01-01",
          default_schedule_id: "a",
          local_rate_ratio: 0.1,
          schedules: [
            {
              id: "a",
              statute_ref: "x",
              local_statute_ref: "y",
              url: "https://example.org",
              brackets: [
                { lower_krw: 0, upper_krw: 100, national_rate_pct: 10, local_rate_pct: 1, combined_rate_pct: 11 },
                { lower_krw: 100, upper_krw: null, national_rate_pct: 20, local_rate_pct: 2, combined_rate_pct: 22 },
              ],
            },
          ],
          ...over,
        },
      },
    });
    expect(tax.parseTaxRegistry(section({}))).toMatchObject({ ok: true });
    for (const bad of [
      { schedules: "nope" },
      { default_schedule_id: "missing" },
      { effective_from: "yesterday" },
      { local_rate_ratio: "x" },
      { schedules: [{ id: "a" }] },
      {
        schedules: [
          {
            id: "a",
            statute_ref: "x",
            local_statute_ref: "y",
            url: "https://example.org",
            // gap between brackets (100 -> 200)
            brackets: [
              { lower_krw: 0, upper_krw: 100, national_rate_pct: 10, local_rate_pct: 1, combined_rate_pct: 11 },
              { lower_krw: 200, upper_krw: null, national_rate_pct: 20, local_rate_pct: 2, combined_rate_pct: 22 },
            ],
          },
        ],
      },
    ]) {
      expect(tax.parseTaxRegistry(section(bad))).toMatchObject({ ok: false, reason_code: "tax_rate_registry_error" });
    }
    expect(tax.loadKrTaxRegistry("/nonexistent/KR.yaml")).toMatchObject({
      ok: false,
      reason_code: "tax_rate_no_registry",
    });
  });
});

// ── suggestion builder (pure) ──
describe("buildTaxRateSuggestion", () => {
  const found = (valueKrw: number, account: "pretax_income" | "operating_income" = "operating_income") =>
    ({ status: "found", value_krw: valueKrw, fiscal_year: 2025, account, ifrs_code: "x" }) as const;
  const asSuggestion = (r: ReturnType<typeof tax.buildTaxRateSuggestion>) => {
    if (r.value === null) throw new Error(`expected a value, got ${r.reason_code}`);
    return r;
  };

  test("positive income selects that bracket's combined rate with the full evidence trail", () => {
    const s = asSuggestion(tax.buildTaxRateSuggestion("KR", found(500 * EOK), reg));
    expect(s).toMatchObject({
      key: "tax_rate",
      value: 24.2,
      basis: "bracket_estimate",
      schedule_id: "general-domestic",
      bracket_id: "general-domestic.20000000000",
      as_of: "2026-01-01",
      effective_from: "2026-01-01",
      verified_on: "2026-11-26",
      anchor_ref: general.url,
      statute_ref: general.statute_ref,
      local_statute_ref: general.local_statute_ref,
      income_account: "operating_income",
      estimated_income_krw_million: 50000,
      income_period: "2025",
      fallback_reason_code: null,
      fallback_reason: null,
      local_rate_adjustment_pct: 50,
    });
    expect(s.bracket).toEqual({
      lower_krw_million: 20000,
      upper_krw_million: 300000,
      national_rate_pct: 22,
      local_rate_pct: 2.2,
      combined_rate_pct: 24.2,
    });
    expect(s.source_label).toContain(general.statute_ref);
    expect(s.note).toContain("FY2025");
    expect(s.note).toContain("not taxable income");
    expect(s.note).toContain("+/-50%");
    expect(s.note).toContain("50,000 KRW million");
  });

  test("each bracket and the pre-tax account label", () => {
    const rate = (krw: number) => asSuggestion(tax.buildTaxRateSuggestion("KR", found(krw), reg)).value;
    expect(rate(1 * EOK)).toBe(11);
    expect(rate(2 * EOK)).toBe(11);
    expect(rate(2 * EOK + 1)).toBe(22);
    expect(rate(200 * EOK + 1)).toBe(24.2);
    expect(rate(3000 * EOK + 1)).toBe(27.5);
    const pre = asSuggestion(tax.buildTaxRateSuggestion("KR", found(10 * EOK, "pretax_income"), reg));
    expect(pre.income_account).toBe("pretax_income");
    expect(pre.note).toContain("pre-tax income");
    expect(pre.note).not.toContain("not collected");
    const op = asSuggestion(tax.buildTaxRateSuggestion("KR", found(10 * EOK), reg));
    expect(op.note).toContain("operating income");
    expect(op.note).toContain("not collected");
  });

  test("API money is integer KRW millions (rounded, never a float)", () => {
    const s = asSuggestion(tax.buildTaxRateSuggestion("KR", found(1_234_567_891), reg));
    expect(s.estimated_income_krw_million).toBe(1235);
    expect(Number.isInteger(s.estimated_income_krw_million)).toBe(true);
    expect(Number.isInteger(s.bracket.lower_krw_million)).toBe(true);
  });

  test("no company / no financials / zero / negative income fall back to the top bracket with a reason", () => {
    for (const [input, code] of [
      [{ status: "no_company" }, "tax_income_no_company"],
      [{ status: "no_financials" }, "tax_income_no_financials"],
      [found(0), "tax_income_not_positive"],
      [found(-5 * EOK), "tax_income_not_positive"],
    ] as const) {
      const s = asSuggestion(tax.buildTaxRateSuggestion("KR", input, reg));
      expect(s).toMatchObject({
        value: 27.5,
        basis: "top_bracket_fallback",
        fallback_reason_code: code,
        bracket_id: "general-domestic.300000000000",
      });
      expect(typeof s.fallback_reason).toBe("string");
      expect(s.note).toContain("Top bracket used");
      expect(s.note).toContain("not taxable income");
    }
    // a non-positive found income still reports which figure it was
    const loss = asSuggestion(tax.buildTaxRateSuggestion("KR", found(-5 * EOK), reg));
    expect(loss.estimated_income_krw_million).toBe(-500);
    expect(loss.income_period).toBe("2025");
  });

  test("non-KR market is null with a reason code, regardless of income", () => {
    expect(tax.buildTaxRateSuggestion("OTHER", found(10 * EOK))).toMatchObject({
      key: "tax_rate",
      value: null,
      reason_code: "tax_rate_market_not_kr",
    });
  });

  test("a missing or broken registry gives null with the loader's reason code", () => {
    const missing = tax.parseTaxRegistry({});
    expect(tax.buildTaxRateSuggestion("KR", found(10 * EOK), missing)).toMatchObject({
      value: null,
      reason_code: "tax_rate_no_registry",
    });
    const broken = tax.parseTaxRegistry({ corporate_tax_rates: { data: {} } });
    expect(tax.buildTaxRateSuggestion("KR", found(10 * EOK), broken)).toMatchObject({
      value: null,
      reason_code: "tax_rate_registry_error",
    });
  });
});

// ── income lookup ──
describe("lookupTaxableIncomeProxy", () => {
  test("no company id / no income facts", () => {
    expect(tax.lookupTaxableIncomeProxy(db, null)).toEqual({ status: "no_company" });
    expect(tax.lookupTaxableIncomeProxy(db, companyNoFin)).toEqual({ status: "no_financials" });
  });

  test("latest fiscal year wins; operating income is the proxy while pre-tax income is not collected", () => {
    expect(tax.lookupTaxableIncomeProxy(db, companyProfit)).toMatchObject({
      status: "found",
      value_krw: 500 * EOK,
      fiscal_year: 2024,
      account: "operating_income",
    });
  });

  test("pre-tax income is preferred within the latest year; an older pre-tax row does not beat a newer operating row; latest revision wins", () => {
    const c = newCompany("tax-lookup");
    addFact(c, PRETAX, 2022, 99 * EOK); // older pre-tax
    addFact(c, OPERATING, 2024, 7 * EOK, 1);
    expect(tax.lookupTaxableIncomeProxy(db, c)).toMatchObject({
      fiscal_year: 2024,
      account: "operating_income",
      value_krw: 7 * EOK,
    });
    addFact(c, PRETAX, 2024, 6 * EOK);
    expect(tax.lookupTaxableIncomeProxy(db, c)).toMatchObject({
      fiscal_year: 2024,
      account: "pretax_income",
      value_krw: 6 * EOK,
    });
    addFact(c, PRETAX, 2024, 8 * EOK, 2); // restated
    expect(tax.lookupTaxableIncomeProxy(db, c)).toMatchObject({ account: "pretax_income", value_krw: 8 * EOK });
  });
});

// ── GET suggestions ──
async function suggestions(project: string, c = cookie) {
  const res = await req(`/api/projects/${project}/wacc/suggestions`, { headers: { cookie: c } });
  expect(res.status).toBe(200);
  const json = await res.json();
  return {
    data: json.data as {
      suggestions: Array<Record<string, any>>;
      apply_all_excluded: Array<Record<string, any>>;
      missing: string[];
    },
    meta: json.meta as Record<string, any>,
  };
}
const taxOf = (b: { data: { suggestions: Array<Record<string, any>> } }) =>
  b.data.suggestions.find((s) => s.key === "tax_rate")!;

describe("GET /api/projects/[id]/wacc/suggestions - tax_rate", () => {
  test("KR project with income: bracket estimate from the latest operating income, in the standard suggestion shape", async () => {
    const body = await suggestions(projectKr);
    expect(body.data.suggestions.map((s) => s.key)).toEqual([
      "risk_free",
      "credit_spread",
      "observed_de",
      "erp",
      "tax_rate",
    ]);
    expect(taxOf(body)).toMatchObject({
      key: "tax_rate",
      value: 24.2,
      basis: "bracket_estimate",
      income_account: "operating_income",
      income_period: "2024",
      estimated_income_krw_million: 50000,
      bracket: { lower_krw_million: 20000, upper_krw_million: 300000, combined_rate_pct: 24.2 },
      anchor_ref: general.url,
      source_label: expect.stringContaining(general.statute_ref),
      fallback_reason_code: null,
    });
    // eligible for apply-all: never listed as excluded or missing
    expect(body.data.apply_all_excluded.some((x) => x.key === "tax_rate")).toBe(false);
    expect(body.data.missing.some((m) => m.startsWith("tax_rate"))).toBe(false);
    expect(body.meta.suggestion_count).toBeGreaterThanOrEqual(2); // erp + tax_rate always count
  });

  test("loss-making subject falls back to the top bracket with reason tax_income_not_positive", async () => {
    const t = taxOf(await suggestions(projectLoss));
    expect(t).toMatchObject({
      value: 27.5,
      basis: "top_bracket_fallback",
      fallback_reason_code: "tax_income_not_positive",
      estimated_income_krw_million: -3000,
    });
  });

  test("subject with no collected financials falls back with reason tax_income_no_financials", async () => {
    const t = taxOf(await suggestions(projectNoFin));
    expect(t).toMatchObject({
      value: 27.5,
      basis: "top_bracket_fallback",
      fallback_reason_code: "tax_income_no_financials",
    });
    expect(t.estimated_income_krw_million).toBeNull();
  });

  test("no bound company: tax_rate survives the early return as a top-bracket fallback", async () => {
    const body = await suggestions(projectNoCompany);
    expect(body.data.suggestions.map((s) => s.key)).toEqual(["erp", "tax_rate"]);
    expect(taxOf(body)).toMatchObject({
      value: 27.5,
      basis: "top_bracket_fallback",
      fallback_reason_code: "tax_income_no_company",
    });
    expect(body.meta.suggestion_count).toBe(2);
  });

  test("project that declared a non-KR scope gets a null tax_rate with reason_code, and is not counted", async () => {
    const body = await suggestions(projectOther);
    expect(taxOf(body)).toMatchObject({ key: "tax_rate", value: null, reason_code: "tax_rate_market_not_kr" });
    expect(typeof taxOf(body).reason).toBe("string");
  });

  test("access is unchanged: anonymous 401, non-member 404", async () => {
    expect((await req(`/api/projects/${projectKr}/wacc/suggestions`)).status).toBe(401);
    await createUser(db, {
      userId: "tax-outsider",
      role: "analyst",
      password: "pw-outsider-12345",
      createdBy: "test",
      now: NOW,
    });
    approveUser(db, { userId: "tax-outsider", approvedBy: "test", now: NOW });
    db.run("UPDATE app_user SET must_change_password = 0");
    const res = await req("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId: "tax-outsider", password: "pw-outsider-12345" }),
    });
    const outsider = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
    expect((await req(`/api/projects/${projectKr}/wacc/suggestions`, { headers: { cookie: outsider } })).status).toBe(
      404,
    );
  });
});

// ── POST confirmation audit ──
const CAPM = (taxComponent: Record<string, unknown>) => [
  { key: "wacc.risk_free", value: 0.03, kind: "live", source_label: "ECOS", anchor_ref: "src:ecos" },
  { key: "wacc.erp", value: 0.055, kind: "user" },
  { key: "wacc.beta_unlevered", value: 1.0, kind: "derived" },
  { key: "wacc.target_de", value: 0.5, kind: "user" },
  taxComponent,
  { key: "wacc.cost_of_debt", value: 0.05, kind: "user" },
];
async function confirm(
  project: string,
  taxComponent: Record<string, unknown>,
  other?: (c: Record<string, any>) => Record<string, any>,
) {
  const comps = CAPM(taxComponent);
  return req(`/api/projects/${project}/wacc`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ wacc: 0.09, mode: "capm", components: other ? comps.map(other) : comps }),
  });
}
const taxAudit = (runId: string) =>
  (
    db
      .query("SELECT target FROM audit_log WHERE action = 'assumption_set' AND target LIKE ?")
      .all(`${runId}:wacc.tax_rate:%`) as Array<{ target: string }>
  ).map((a) => a.target);
const runCount = (project: string) =>
  (db.query("SELECT COUNT(*) AS n FROM run WHERE project_id = ?").get(project) as { n: number }).n;
const BRACKET = "general-domestic.20000000000"; // 24.2%

describe("POST /api/projects/[id]/wacc - tax reference audit", () => {
  test("applied bracket as-is: row stays kind=user with citation notes; audit carries basis/bracket/edited=false", async () => {
    const res = await confirm(projectKr, {
      key: "wacc.tax_rate",
      value: 0.242,
      kind: "user",
      source_label: "statutory",
      anchor_ref: general.url,
      tax_reference_basis: "bracket_estimate",
      tax_reference_bracket_id: BRACKET,
      edited_from_reference: true, // client claim is ignored - the server derives it from the bracket
    });
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    const row = db
      .query("SELECT kind, anchor_ref, rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.tax_rate'")
      .get(runId) as any;
    expect(row).toMatchObject({ kind: "user", anchor_ref: general.url });
    expect(row.rationale).toContain("tax_reference_bracket=" + BRACKET);
    expect(row.rationale).toContain("tax_reference_basis=bracket_estimate");
    expect(row.rationale).not.toContain("edited_from_reference");
    expect(taxAudit(runId)).toEqual([
      `${runId}:wacc.tax_rate:user:tax_reference_basis=bracket_estimate:tax_reference_bracket=${BRACKET}:edited_from_reference=false`,
    ]);
  });

  test("changed number after applying: edited is derived server-side (even when the client says false) and lands in note + audit", async () => {
    const res = await confirm(projectKr, {
      key: "wacc.tax_rate",
      value: 0.22,
      kind: "user",
      tax_reference_basis: "top_bracket_fallback",
      tax_reference_bracket_id: BRACKET,
      edited_from_reference: false,
    });
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    const row = db
      .query("SELECT rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.tax_rate'")
      .get(runId) as any;
    expect(row.rationale).toContain("edited_from_reference: true");
    expect(taxAudit(runId)).toEqual([
      `${runId}:wacc.tax_rate:user:tax_reference_basis=top_bracket_fallback:tax_reference_bracket=${BRACKET}:edited_from_reference=true`,
    ]);
  });

  test("bracket id without basis is allowed (basis recorded as null)", async () => {
    const res = await confirm(projectKr, {
      key: "wacc.tax_rate",
      value: 0.242,
      kind: "user",
      tax_reference_bracket_id: BRACKET,
    });
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    expect(taxAudit(runId)).toEqual([
      `${runId}:wacc.tax_rate:user:tax_reference_basis=null:tax_reference_bracket=${BRACKET}:edited_from_reference=false`,
    ]);
  });

  test("manual tax rate keeps the pre-existing audit target and rationale (no suffix)", async () => {
    const res = await confirm(projectKr, { key: "wacc.tax_rate", value: 0.24, kind: "user", source_label: "typed" });
    expect(res.status).toBe(201);
    const runId = (await res.json()).data.run_id as string;
    expect(taxAudit(runId)).toEqual([`${runId}:wacc.tax_rate:user`]);
    const row = db
      .query("SELECT rationale FROM assumption WHERE run_id = ? AND assumption_key = 'wacc.tax_rate'")
      .get(runId) as any;
    expect(row.rationale).not.toContain("tax_reference");
  });

  test("an unregistered bracket id is 400 invalid_request and creates no run", async () => {
    const before = runCount(projectKr);
    const res = await confirm(projectKr, {
      key: "wacc.tax_rate",
      value: 0.242,
      kind: "user",
      tax_reference_bracket_id: "general-domestic.12345",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("invalid_request");
    expect(runCount(projectKr)).toBe(before);
  });

  test("malformed tax-reference fields are 400: bad id shape, bad basis, basis without id, fields on another component", async () => {
    const before = runCount(projectKr);
    for (const bad of [
      { key: "wacc.tax_rate", value: 0.24, kind: "user", tax_reference_bracket_id: "has space" },
      { key: "wacc.tax_rate", value: 0.24, kind: "user", tax_reference_bracket_id: 42 },
      {
        key: "wacc.tax_rate",
        value: 0.24,
        kind: "user",
        tax_reference_bracket_id: BRACKET,
        tax_reference_basis: "guess",
      },
      { key: "wacc.tax_rate", value: 0.24, kind: "user", tax_reference_basis: "bracket_estimate" },
      { key: "wacc.tax_rate", value: 0.24, kind: "user", edited_from_reference: "true" },
    ]) {
      expect((await confirm(projectKr, bad)).status).toBe(400);
    }
    const onOther = await confirm(projectKr, { key: "wacc.tax_rate", value: 0.24, kind: "user" }, (c) =>
      c.key === "wacc.erp" ? { ...c, tax_reference_bracket_id: BRACKET } : c,
    );
    expect(onOther.status).toBe(400);
    const editedOnOther = await confirm(projectKr, { key: "wacc.tax_rate", value: 0.24, kind: "user" }, (c) =>
      c.key === "wacc.risk_free" ? { ...c, edited_from_reference: true } : c,
    );
    expect(editedOnOther.status).toBe(400);
    expect(runCount(projectKr)).toBe(before);
  });
});
