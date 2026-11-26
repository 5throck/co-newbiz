// @version 1.0.0
/**
 * ADR-0208 slice 3 - synthetic rating, the ladder, the implied-cost cross-check and the issuance evidence
 * (db/lib/credit-synthetic.ts, credit-interest-facts.ts, wacc-reference.ts decideCreditRating).
 * Scratch SQLite built through the migration chain; no network.
 *
 * Covers: the registry table as shipped (Damodaran large non-financial, transcribed values), every band boundary
 * (lower-inclusive, upper-exclusive, below the first bound, open top), the interest hierarchy, summed interest paid,
 * same-year pairing, loss-making, zero interest, not-collected vs no-interest, financial-sector detection (and the biotech
 * name that must not match), the rating ladder (fresh bond > fresh bureau > synthetic > stale > default), the cross-check
 * threshold (1.9 / 2.0 / 2.1 pp), direction, below-Rf, no debt rows, single-year average, and the issuance window.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "credit-synthetic-"));
const DB_BEFORE = process.env.CO_NEWBIZ_DB_PATH;
process.env.CO_NEWBIZ_DB_PATH = join(TMP, "boot.sqlite");
const { runMigrations } = await import("../../db/migrate.ts");
const { getDb, resetDb } = await import("../../db/client.ts");
resetDb();
const DB_PATH = join(TMP, "store.sqlite");
runMigrations(DB_PATH);
const db = getDb(DB_PATH);
afterAll(() => {
  resetDb();
  if (DB_BEFORE === undefined) delete process.env.CO_NEWBIZ_DB_PATH;
  else process.env.CO_NEWBIZ_DB_PATH = DB_BEFORE;
});

const { ulid } = await import("../../db/lib/ulid.ts");
const { loadKrCreditRatingRegistry } = await import("../../db/lib/credit-spread-map.ts");
const synth = await import("../../db/lib/credit-synthetic.ts");
const { isFinancialSectorName, pickInterest } = await import("../../db/lib/credit-interest-facts.ts");
const { decideCreditRating } = await import("../../db/lib/wacc-reference.ts");
const repo = await import("../../db/repositories/dart-credit-rating.repository.ts");
const { CREDIT_RATING_PARSER_VERSION: V } = await import("../../db/lib/credit-rating-disclosure.ts");

const NOW = "2026-11-26T00:00:00.000Z";
const loaded = loadKrCreditRatingRegistry();
if (!loaded.ok) throw new Error(`registry: ${loaded.reason}`);
const REG = loaded.registry;

let sourceId = "";
beforeAll(() => {
  sourceId = ulid();
  db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)", [
    sourceId,
    "dart-cs",
    "A",
    NOW,
  ]);
});

const OP = "ifrs-full_ProfitLossFromOperatingActivities";
const INT_CF = "dart_AdjustmentsForInterestExpenses";
const INT_IS = "ifrs-full_InterestExpense";
const FIN = "ifrs-full_FinanceCosts";
const PAID_OP = "ifrs-full_InterestPaidClassifiedAsOperatingActivities";
const PAID_FIN = "ifrs-full_InterestPaidClassifiedAsFinancingActivities";
const PRETAX = "ifrs-full_ProfitLossBeforeTax";
const SHORT = "conewbiz_ShortTermBorrowings";
const LONG = "conewbiz_LongTermBorrowings";
const BONDS = "conewbiz_BondsIssued";

function period(year: number): string {
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
function fact(companyId: string, year: number, ifrsCode: string, value: number, revision = 1) {
  const acc = db.query("SELECT id FROM md_account WHERE ifrs_code = ?").get(ifrsCode) as { id: string };
  db.run(
    "INSERT INTO fact_financial (id, company_id, period_id, account_id, value, revision_no, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), companyId, period(year), acc.id, value, revision, sourceId, NOW],
  );
}
let n = 0;
function company(name = `cs-co-${++n}`, corp: string | null = null): string {
  const id = ulid();
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [id, name, corp, NOW]);
  return id;
}
const B = 1e9; // KRW 1 billion
const syn = (c: string) => synth.deriveSyntheticRating(db, c, REG);
const okSyn = (c: string) => {
  const r = syn(c);
  if (!r.ok) throw new Error(`expected a synthetic rating, got ${r.reason_code}`);
  return r;
};

describe("the shipped registry table (transcribed from the published page)", () => {
  test("provenance, contiguity and the published bands", () => {
    const t = REG.synthetic?.table;
    expect(t?.id).toBe("damodaran-large-non-financial-2026-01");
    expect(t?.url.startsWith("https://pages.stern.nyu.edu/")).toBe(true);
    expect(t?.maintainer).toBe("quant-methodologist");
    expect(t?.verifiedOn).toBe("2026-11-26");
    expect(t?.rows).toHaveLength(15);
    const rows = t?.rows ?? [];
    for (let i = 1; i < rows.length; i++) expect(rows[i]?.lowerX).toBe(rows[i - 1]?.upperX as number);
    expect(rows[0]?.lowerX).toBe(-100000);
    expect(rows[rows.length - 1]?.upperX).toBeNull();
    expect(rows.map((r) => [r.lowerX, r.rating, r.publishedLabel])).toEqual([
      [-100000, "D", "D2/D"],
      [0.2, "C", "C2/C"],
      [0.65, "CC", "Ca2/CC"],
      [0.8, "CCC", "Caa/CCC"],
      [1.25, "B-", "B3/B-"],
      [1.5, "B", "B2/B"],
      [1.75, "B+", "B1/B+"],
      [2, "BB", "Ba2/BB"],
      [2.25, "BB+", "Ba1/BB+"],
      [2.5, "BBB", "Baa2/BBB"],
      [3, "A-", "A3/A-"],
      [4.25, "A", "A2/A"],
      [5.5, "A+", "A1/A+"],
      [6.5, "AA", "Aa2/AA"],
      [8.5, "AAA", "Aaa/AAA"],
    ]);
  });
});

describe("bandForCoverage: lower-inclusive, upper-exclusive", () => {
  const rows = REG.synthetic?.table.rows ?? [];
  const r = (x: number) => synth.bandForCoverage(rows, x).rating;
  test("every published boundary belongs to the band it opens", () => {
    for (const b of rows.slice(1)) {
      expect(r(b.lowerX)).toBe(b.rating);
      expect(r(b.lowerX - 1e-9)).not.toBe(b.rating);
    }
  });
  test("named boundaries, loss-making, extreme values and the open top", () => {
    expect(r(0.199999)).toBe("D");
    expect(r(0.2)).toBe("C");
    expect(r(2.4999)).toBe("BB+");
    expect(r(2.5)).toBe("BBB");
    expect(r(2.9999)).toBe("BBB");
    expect(r(3)).toBe("A-");
    expect(r(8.4999)).toBe("AA");
    expect(r(8.5)).toBe("AAA");
    expect(r(1e9)).toBe("AAA");
    expect(r(0)).toBe("D");
    expect(r(-3.5)).toBe("D");
    expect(r(-1e9)).toBe("D"); // below the first lower bound: the first band
  });
  test("notches the publisher does not print are never produced", () => {
    const produced = new Set(rows.map((x) => x.rating));
    for (const missing of ["AA+", "AA-", "BBB+", "BBB-", "BB-"]) expect(produced.has(missing)).toBe(false);
  });
});

describe("deriveSyntheticRating", () => {
  test("coverage = operating income / interest expense of the latest year with both; rating from the table", () => {
    const c = company();
    fact(c, 2025, OP, 600 * B);
    fact(c, 2025, INT_CF, 100 * B);
    const r = okSyn(c);
    expect(r).toMatchObject({
      rating: "A+", // 6.0 is in [5.5, 6.5)
      coverage_x: 6,
      interest_source: "interest_expense",
      fiscal_year: 2025,
      table_id: "damodaran-large-non-financial-2026-01",
      loss_making: false,
      interest_is_proxy: false,
      operating_income_krw_million: 600_000,
      interest_expense_krw_million: 100_000,
    });
    expect(r.band.publishedLabel).toBe("A1/A+");
    expect(r.note).toContain("not a rating");
  });

  test("the boundary itself rounds into the better band (6.5 -> AA, just below -> A+)", () => {
    const hi = company();
    fact(hi, 2025, OP, 650 * B);
    fact(hi, 2025, INT_CF, 100 * B);
    expect(okSyn(hi).rating).toBe("AA");
    const lo = company();
    fact(lo, 2025, OP, 649 * B);
    fact(lo, 2025, INT_CF, 100 * B);
    expect(okSyn(lo).rating).toBe("A+");
  });

  test("hierarchy: interest expense > interest paid (operating + financing summed) > finance costs (proxy)", () => {
    const a = company();
    fact(a, 2025, OP, 300 * B);
    fact(a, 2025, INT_CF, 100 * B);
    fact(a, 2025, PAID_OP, 20 * B);
    fact(a, 2025, FIN, 500 * B);
    expect(okSyn(a)).toMatchObject({ interest_source: "interest_expense", coverage_x: 3 });

    const income = company(); // the income-statement interest expense wins over the cash-flow add-back
    fact(income, 2025, OP, 300 * B);
    fact(income, 2025, INT_IS, 150 * B);
    fact(income, 2025, INT_CF, 100 * B);
    expect(okSyn(income)).toMatchObject({ interest_source: "interest_expense", coverage_x: 2 });

    const paid = company(); // two rows with the same name in the filing: both are summed
    fact(paid, 2025, OP, 300 * B);
    fact(paid, 2025, PAID_OP, 20 * B);
    fact(paid, 2025, PAID_FIN, 80 * B);
    fact(paid, 2025, FIN, 500 * B);
    expect(okSyn(paid)).toMatchObject({ interest_source: "interest_paid", coverage_x: 3, interest_is_proxy: true });

    const fin = company();
    fact(fin, 2025, OP, 300 * B);
    fact(fin, 2025, FIN, 600 * B);
    expect(okSyn(fin)).toMatchObject({
      interest_source: "finance_costs",
      coverage_x: 0.5,
      rating: "C",
      interest_is_proxy: true,
    });
    expect(okSyn(fin).note).toContain("overstates interest");
  });

  test("magnitudes are used: a filer that signs interest paid as an outflow gives the same coverage", () => {
    const c = company();
    fact(c, 2025, OP, 300 * B);
    fact(c, 2025, PAID_OP, -20 * B);
    fact(c, 2025, PAID_FIN, -80 * B);
    expect(okSyn(c)).toMatchObject({ interest_source: "interest_paid", coverage_x: 3 });
  });

  test("loss-making: operating income <= 0 falls in the lowest band and is flagged", () => {
    const c = company();
    fact(c, 2025, OP, -365 * B);
    fact(c, 2025, FIN, 540 * B);
    expect(okSyn(c)).toMatchObject({ rating: "D", loss_making: true });
    expect(okSyn(c).coverage_x).toBeLessThan(0);
    const zero = company();
    fact(zero, 2025, OP, 0);
    fact(zero, 2025, INT_CF, 10 * B);
    expect(okSyn(zero)).toMatchObject({ rating: "D", loss_making: true, coverage_x: 0 });
  });

  test("same-year pairing: the newest year collected with the extended collector but no interest is 'no interest', not an older year's figure", () => {
    const c = company();
    fact(c, 2024, OP, 300 * B);
    fact(c, 2024, INT_CF, 100 * B);
    fact(c, 2025, OP, 500 * B);
    fact(c, 2025, PRETAX, 480 * B); // 2025 was collected (pre-tax present) and shows no interest
    const r = syn(c);
    expect(r).toMatchObject({ ok: false, reason_code: "synthetic_no_interest_expense", resync_hint: false });
  });

  test("a newest year that predates the extended collector falls back to the latest year that has both", () => {
    const c = company();
    fact(c, 2024, OP, 300 * B);
    fact(c, 2024, INT_CF, 100 * B);
    fact(c, 2025, OP, 999 * B); // old collector: operating income only
    expect(okSyn(c)).toMatchObject({ fiscal_year: 2024, coverage_x: 3 });
  });

  test("zero or missing interest, nothing collected, nothing at all: each has its own recorded reason", () => {
    const zero = company();
    fact(zero, 2025, OP, 100 * B);
    fact(zero, 2025, INT_CF, 0);
    fact(zero, 2025, FIN, 0);
    expect(syn(zero)).toMatchObject({ ok: false, reason_code: "synthetic_no_interest_expense" });

    const old = company(); // synced before the extension: operating income only
    fact(old, 2025, OP, 100 * B);
    expect(syn(old)).toMatchObject({ ok: false, reason_code: "synthetic_interest_not_collected", resync_hint: true });

    const none = company();
    expect(syn(none)).toMatchObject({ ok: false, reason_code: "synthetic_no_financials", resync_hint: false });
  });

  test("financial-sector companies skip the rung (by name); a biotech '...생명과학' does not match", () => {
    const bank = company("테스트은행");
    fact(bank, 2025, OP, 100 * B);
    fact(bank, 2025, INT_CF, 10 * B);
    expect(syn(bank)).toMatchObject({ ok: false, reason_code: "synthetic_not_applicable_financial" });
    const bio = company("테스트생명과학");
    fact(bio, 2025, OP, 100 * B);
    fact(bio, 2025, INT_CF, 10 * B);
    expect(syn(bio).ok).toBe(true);
  });

  test("a registry without a table cannot produce a synthetic rating", () => {
    const c = company();
    fact(c, 2025, OP, 100 * B);
    fact(c, 2025, INT_CF, 10 * B);
    const r = synth.deriveSyntheticRating(db, c, { ...REG, synthetic: null });
    expect(r).toMatchObject({ ok: false, reason_code: "synthetic_no_registry_table" });
  });
});

describe("isFinancialSectorName", () => {
  const rule = REG.synthetic as NonNullable<typeof REG.synthetic>;
  test("keywords anywhere, suffixes at the end, company-form words ignored", () => {
    for (const name of [
      "KB금융지주",
      "미래에셋증권",
      "삼성생명보험",
      "삼성생명",
      "삼성화재",
      "현대해상",
      "롯데카드",
      "(주)하나캐피탈",
      "주식회사 OO저축은행",
    ]) {
      expect(isFinancialSectorName(name, rule)).toBe(true);
    }
    for (const name of ["삼성전자", "한화솔루션", "코오롱생명과학", "대한항공", "", null]) {
      expect(isFinancialSectorName(name, rule)).toBe(false);
    }
  });
});

describe("the rating ladder (decideCreditRating)", () => {
  const syntheticOk = (rating = "A") => {
    const c = company();
    fact(c, 2025, OP, 450 * B);
    fact(c, 2025, INT_CF, 100 * B);
    const r = okSyn(c);
    expect(r.rating).toBe(rating);
    return r;
  };
  const disclosed = (basis: "disclosed" | "bureau", stale: boolean) =>
    ({
      ok: true,
      basis,
      instrument: basis === "bureau" ? "issuer_bureau" : "corporate_bond",
      rating: "A-",
      rated_on: "2025-01-01",
      stale,
      agencies: [],
      source_kind: "business_report",
      snapshot_id: "S1",
      source_rcept_no: "20260310000001",
      alternative: null,
      bureau:
        basis === "bureau"
          ? { agency: null, agency_raw: null, agency_carried: false, cashflow_grade: null, rows: [] }
          : null,
    }) as never;

  test("fresh bond > fresh bureau > synthetic", () => {
    const s = syntheticOk();
    expect(decideCreditRating(REG, disclosed("disclosed", false), s)).toMatchObject({
      source: "disclosed",
      rating: "A-",
    });
    expect(decideCreditRating(REG, disclosed("bureau", false), s)).toMatchObject({ source: "bureau", rating: "A-" });
    expect(decideCreditRating(REG, { ok: false, status: "not_disclosed" }, s)).toMatchObject({
      source: "synthetic",
      rating: "A",
      reason_code: "synthetic_rating",
      superseded: null,
    });
  });

  test("a STALE disclosed or bureau rating ranks below synthetic and stays visible as superseded", () => {
    const s = syntheticOk();
    const d = decideCreditRating(REG, disclosed("disclosed", true), s);
    expect(d).toMatchObject({
      source: "synthetic",
      superseded: { basis: "disclosed", rating: "A-", rated_on: "2025-01-01", source_rcept_no: "20260310000001" },
    });
    expect(d.reason).toContain("stale");
    expect(decideCreditRating(REG, disclosed("bureau", true), s)).toMatchObject({
      source: "synthetic",
      superseded: { basis: "bureau" },
    });
  });

  test("with no synthetic estimate a stale rating is used (as before), and with nothing the default carries both reasons", () => {
    expect(decideCreditRating(REG, disclosed("disclosed", true), null)).toMatchObject({ source: "disclosed" });
    const unavailable = syn(company());
    expect(unavailable.ok).toBe(false);
    expect(decideCreditRating(REG, disclosed("bureau", true), unavailable)).toMatchObject({ source: "bureau" });
    const d = decideCreditRating(REG, { ok: false, status: "not_disclosed" }, unavailable);
    expect(d).toMatchObject({
      source: "default",
      rating: "BBB-",
      reason_code: "no_disclosed_rating_and_synthetic_unavailable",
    });
    expect(d.reason).toContain("Synthetic rung:");
    expect(decideCreditRating(REG, { ok: false, status: "rating_not_collected" }, null)).toMatchObject({
      reason_code: "rating_not_collected",
    });
  });
});

describe("pickInterest", () => {
  const year = (over: Record<string, unknown>) =>
    ({
      fiscalYear: 2025,
      operatingIncomeKrw: 1,
      interestExpenseIsKrw: null,
      interestExpenseCfKrw: null,
      financeCostsKrw: null,
      interestPaidOperatingKrw: null,
      interestPaidFinancingKrw: null,
      debtByClass: {},
      collected: true,
      ...over,
    }) as never;
  test("zero and absent rungs fall through; nothing positive is null", () => {
    expect(pickInterest(year({ interestExpenseCfKrw: 0, financeCostsKrw: 5 }))).toEqual({
      source: "finance_costs",
      valueKrw: 5,
    });
    expect(pickInterest(year({ interestPaidOperatingKrw: 0, interestPaidFinancingKrw: 0 }))).toBeNull();
    expect(pickInterest(year({}))).toBeNull();
  });
});

describe("computeKdCrosscheck", () => {
  /** interest 50, average debt 1000 -> implied 5.00%. */
  const base = () => {
    const c = company();
    fact(c, 2025, OP, 300 * B);
    fact(c, 2025, INT_CF, 50 * B);
    fact(c, 2025, SHORT, 400 * B);
    fact(c, 2025, LONG, 600 * B);
    fact(c, 2024, SHORT, 500 * B);
    fact(c, 2024, BONDS, 500 * B);
    return c;
  };
  const check = (c: string, kd: number | null) => synth.computeKdCrosscheck(db, c, REG, kd);

  test("implied cost = interest / two-year average debt; amounts leave as INTEGER KRW millions", () => {
    const x = check(base(), 5);
    expect(x).toMatchObject({
      status: "ok",
      implied_cost_pct: 5,
      market_kd_pct: 5,
      gap_pp: 0,
      interest_source: "interest_expense",
      fiscal_year: 2025,
      interest_expense_krw_million: 50_000,
      avg_debt_krw_million: 1_000_000,
      debt_basis: "two_year_average",
      warn_gap_pp: 2,
    });
    expect(Number.isInteger(x.avg_debt_krw_million)).toBe(true);
  });

  test("threshold: 1.9 and 2.0 pp are not warnings, 2.1 pp is (both directions)", () => {
    const c = base();
    expect(check(c, 6.9)).toMatchObject({ status: "ok", gap_pp: 1.9 });
    expect(check(c, 7.0)).toMatchObject({ status: "ok", gap_pp: 2 });
    expect(check(c, 7.1)).toMatchObject({
      status: "warn",
      gap_pp: 2.1,
      direction: "market_above_actual",
      reason_code: "crosscheck_implied_far_below_market",
    });
    // the boundary and below carry no reason code
    expect(check(c, 7.0).reason_code).toBeNull();
    expect(check(c, 6.9).reason_code).toBeNull();
    expect(check(c, 3.0)).toMatchObject({ status: "ok", gap_pp: -2 });
    // implied cost far ABOVE the market: still a warning, but not the 'far below' reason
    expect(check(c, 2.9)).toMatchObject({
      status: "warn",
      gap_pp: -2.1,
      direction: "market_below_actual",
      reason_code: null,
    });
  });

  test("direction: market below the actual cost", () => {
    const c = base();
    expect(check(c, 2.5)).toMatchObject({ status: "warn", gap_pp: -2.5, direction: "market_below_actual" });
    expect(check(c, 4)).toMatchObject({ status: "ok", direction: "market_below_actual" });
  });

  test("implied cost below the risk-free rate is judged by the gap like any other (live case: 3.64% vs market Kd 10.36% warns)", () => {
    // interest 36.4bn on 1,000bn average debt -> implied 3.64%, below an Rf of 3.861%
    const c = company();
    fact(c, 2025, OP, 300 * B);
    fact(c, 2025, INT_CF, 36.4 * B);
    fact(c, 2025, LONG, 1000 * B);
    fact(c, 2024, LONG, 1000 * B);
    const x = check(c, 10.358);
    expect(x).toMatchObject({
      status: "warn",
      reason_code: "crosscheck_implied_far_below_market",
      implied_cost_pct: 3.64,
      market_kd_pct: 10.358,
      direction: "market_above_actual",
    });
    expect(x.gap_pp).toBeCloseTo(6.718, 6);
    expect(x.reason).toContain("3.64%");
    expect(x.reason).toContain("10.36%");
    expect(x.reason).toContain("policy-finance or low-rate borrowing");
    // below Rf but within the threshold of the market Kd: not a warning
    expect(check(c, 5.0)).toMatchObject({ status: "ok", reason_code: null });
  });

  test("unreliable is kept for unusable inputs only: a non-positive debt balance", () => {
    const c = company();
    fact(c, 2025, OP, 300 * B);
    fact(c, 2025, INT_CF, 50 * B);
    fact(c, 2025, LONG, 0);
    const x = check(c, 5);
    expect(x).toMatchObject({ status: "unreliable", reason_code: "crosscheck_unreliable_non_positive_debt" });
    expect(x.gap_pp).toBeNull();
  });

  test("a single year-end balance is used (and said) when the prior year has no borrowing row", () => {
    const c = company();
    fact(c, 2025, OP, 300 * B);
    fact(c, 2025, INT_CF, 50 * B);
    fact(c, 2025, LONG, 500 * B);
    expect(check(c, 10)).toMatchObject({
      debt_basis: "year_end",
      avg_debt_krw_million: 500_000,
      implied_cost_pct: 10,
      status: "ok",
    });
  });

  test("unavailable, each with its recorded reason: no debt rows, no market Kd, no interest, not collected, financial sector", () => {
    const noDebt = company();
    fact(noDebt, 2025, OP, 1);
    fact(noDebt, 2025, INT_CF, 5);
    expect(check(noDebt, 5)).toMatchObject({
      status: "unavailable",
      reason_code: "crosscheck_unavailable_no_debt_rows",
    });
    expect(check(base(), null)).toMatchObject({
      status: "unavailable",
      reason_code: "crosscheck_unavailable_no_market_kd",
      implied_cost_pct: 5,
    });
    const zero = company();
    fact(zero, 2025, OP, 1);
    fact(zero, 2025, PRETAX, 1);
    expect(check(zero, 5)).toMatchObject({ reason_code: "crosscheck_unavailable_no_interest_expense" });
    const old = company();
    fact(old, 2025, OP, 1);
    expect(check(old, 5)).toMatchObject({ reason_code: "crosscheck_unavailable_interest_not_collected" });
    expect(check(company(), 5)).toMatchObject({ reason_code: "crosscheck_unavailable_no_financials" });
    const bank = company("테스트은행");
    fact(bank, 2025, OP, 1);
    fact(bank, 2025, INT_CF, 5);
    expect(check(bank, 5)).toMatchObject({ reason_code: "crosscheck_unavailable_financial_sector" });
  });

  test("it only reports: the inputs are unchanged and a second call gives the same answer", () => {
    const c = base();
    expect(check(c, 8)).toEqual(check(c, 8));
  });
});

describe("listIssuanceEvidence", () => {
  const issue = (over: Record<string, unknown>) => ({
    issued_on: "2026-03-10",
    instrument: "corporate_bond",
    amount_krw_mn: 100_000,
    coupon_pct: 4.15,
    rating_raw: "AA-(NICE신용평가)",
    maturity_on: "2029-03-10",
    outstanding: true,
    excluded_reason: null,
    raw: "",
    ...over,
  });
  const put = (corp: string, rcept: string, issues: unknown[] | null) =>
    repo.insertCreditRatingSnapshot(db, {
      corpCode: corp,
      sourceKind: "business_report",
      sourceRceptNo: rcept,
      parserVersion: V,
      status: "section_present_no_bond_rating",
      ratings: [],
      issues,
      now: NOW,
    });
  const NOWD = new Date("2026-11-26T00:00:00Z");

  test("recent corporate-bond issues of the last 36 months, newest first; excluded and old issues are not shown", () => {
    put("00888001", "20260310000001", [
      issue({ issued_on: "2026-03-10", coupon_pct: 4.15 }),
      issue({ issued_on: "2024-05-02", coupon_pct: 4.9, maturity_on: "2027-05-02" }),
      issue({ issued_on: "2025-07-01", coupon_pct: 3.8, excluded_reason: "guaranteed" }),
      issue({ issued_on: "2023-10-01", coupon_pct: 5.5 }), // older than 36 months from 2026-11-26
      issue({ issued_on: "2025-01-01", instrument: "commercial_paper", coupon_pct: 3 }),
    ]);
    const r = synth.listIssuanceEvidence(db, "00888001", NOWD);
    expect(r.status).toBe("available");
    expect(r.rows.map((x) => [x.issued_on, x.coupon_pct])).toEqual([
      ["2026-03-10", 4.15],
      ["2024-05-02", 4.9],
    ]);
    expect(r.rows[0]).toMatchObject({
      amount_krw_million: 100_000,
      rating_raw: "AA-(NICE신용평가)",
      source_rcept_no: "20260310000001",
    });
  });

  test("window boundary: exactly 36 months is in, one day older is out", () => {
    put("00888002", "20260310000002", [
      issue({ issued_on: "2023-11-26" }),
      issue({ issued_on: "2023-11-25", coupon_pct: 9 }),
    ]);
    expect(synth.listIssuanceEvidence(db, "00888002", NOWD).rows.map((x) => x.issued_on)).toEqual(["2023-11-26"]);
  });

  test("recorded statuses: no corp code, not collected, issuance table unavailable (never 'no issues'), none in window", () => {
    expect(synth.listIssuanceEvidence(db, null, NOWD).status).toBe("no_dart_corp_code");
    expect(synth.listIssuanceEvidence(db, "00888003", NOWD).status).toBe("not_collected");
    put("00888004", "20260310000004", null);
    expect(synth.listIssuanceEvidence(db, "00888004", NOWD)).toEqual({ status: "issues_unavailable", rows: [] });
    put("00888005", "20260310000005", [issue({ issued_on: "2020-01-01" })]);
    expect(synth.listIssuanceEvidence(db, "00888005", NOWD)).toEqual({ status: "none_in_window", rows: [] });
  });

  test("the newest report with an issuance table is used; a newer report without one does not hide it", () => {
    put("00888006", "20250310000006", [issue({ issued_on: "2025-02-01", coupon_pct: 3.3 })]);
    put("00888006", "20260310000007", null);
    expect(synth.listIssuanceEvidence(db, "00888006", NOWD).rows.map((x) => x.coupon_pct)).toEqual([3.3]);
  });
});
