// @version 1.0.0
/**
 * Synthetic credit rating, implied-cost cross-check and bond-issuance evidence (ADR-0208 slice 3, design
 * 2026-11-26-wacc-credit-rating-spread sections 5.2 and 7). READ-ONLY and deterministic: the same stored facts and
 * registry give the same result, which is what lets the confirmation audit re-derive them (db/lib/wacc.ts).
 *
 * Synthetic rung: coverage x = operating income / interest expense of the latest fiscal year that has both, mapped
 * through the registry's published coverage-to-rating table (lower-inclusive, upper-exclusive). It is an ESTIMATE, not a
 * rating: the table is global-scale and US-calibrated, coverage uses reported operating income over one year, and the
 * interest source may be a proxy (see credit-interest-facts.ts). Skipped for financial-sector companies. Zero or missing
 * interest has its own recorded reason (never a rating).
 *
 * Cross-check: implied cost = interest expense / average interest-bearing debt (two-year average when the prior year
 * end exists). Compared with the market-built Kd; warns beyond the registry gap. It NEVER changes the number.
 */
import type { Database } from "bun:sqlite";
import { listCreditRatingSnapshots } from "../repositories/dart-credit-rating.repository.ts";
import { addMonthsIso, CREDIT_RATING_PARSER_VERSION, type CreditIssueRow } from "./credit-rating-disclosure.ts";
import {
  type InterestSource,
  isFinancialSectorName,
  pickInterest,
  readCompanyCreditFacts,
  totalDebt,
  type YearCreditFacts,
} from "./credit-interest-facts.ts";
import type { CoverageBand, CreditRatingRegistry } from "./credit-spread-map.ts";
import { seoulToday } from "./iso-date.ts";

export type { InterestSource } from "./credit-interest-facts.ts";

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const toMillion = (krw: number): number => Math.round(krw / 1e6);

export type SyntheticReasonCode =
  | "synthetic_no_registry_table"
  | "synthetic_not_applicable_financial"
  | "synthetic_no_financials"
  | "synthetic_interest_not_collected"
  | "synthetic_no_interest_expense";

export type SyntheticResult =
  | {
      ok: true;
      rating: string;
      /** Operating income / interest expense, 4 decimals. */
      coverage_x: number;
      interest_source: InterestSource;
      fiscal_year: number;
      table_id: string;
      band: CoverageBand;
      /** INTEGER KRW millions (ADR-0061). */
      operating_income_krw_million: number;
      interest_expense_krw_million: number;
      /** Operating income at or below zero: coverage <= 0 falls in the table's lowest band. */
      loss_making: boolean;
      /** True when the interest figure is finance costs (overstates interest) or interest paid (cash basis). */
      interest_is_proxy: boolean;
      note: string;
    }
  | { ok: false; reason_code: SyntheticReasonCode; reason: string; resync_hint: boolean };

/** The band a coverage value falls in: lower-inclusive, upper-exclusive; below the first lower bound is the first band. */
export function bandForCoverage(rows: readonly CoverageBand[], x: number): CoverageBand {
  for (const b of rows) {
    if (x >= b.lowerX && (b.upperX === null || x < b.upperX)) return b;
  }
  return x < rows[0].lowerX ? rows[0] : (rows[rows.length - 1] as CoverageBand);
}

/** The latest year with operating income and a usable interest figure (the design's "both exist"), or why none. */
function selectCoverageYear(
  years: readonly YearCreditFacts[],
  anyCollected: boolean,
):
  | { ok: true; year: YearCreditFacts; interest: NonNullable<ReturnType<typeof pickInterest>> }
  | {
      ok: false;
      reason_code: Exclude<SyntheticReasonCode, "synthetic_no_registry_table" | "synthetic_not_applicable_financial">;
    } {
  const withOp = years.filter((y) => y.operatingIncomeKrw !== null);
  if (withOp.length === 0) return { ok: false, reason_code: "synthetic_no_financials" };
  if (!anyCollected) return { ok: false, reason_code: "synthetic_interest_not_collected" };
  const latest = withOp[0] as YearCreditFacts;
  // The newest year was collected with the extended collector and holds no usable interest: the company has none
  // (never fall back to an older year's interest and mix periods).
  if (latest.collected) {
    const p = pickInterest(latest);
    return p ? { ok: true, year: latest, interest: p } : { ok: false, reason_code: "synthetic_no_interest_expense" };
  }
  // The newest year predates the extended collector: take the latest year that has both (the design's rule).
  for (const y of withOp) {
    const p = pickInterest(y);
    if (p) return { ok: true, year: y, interest: p };
  }
  return { ok: false, reason_code: "synthetic_interest_not_collected" };
}

const REASONS: Record<SyntheticReasonCode, string> = {
  synthetic_no_registry_table: "The region registry carries no coverage-to-rating table.",
  synthetic_not_applicable_financial:
    "The company looks like a financial-sector company by name: interest is an operating cost there, so interest coverage is not meaningful and no synthetic rating is built.",
  synthetic_no_financials: "No operating income is stored for this company; sync its DART financials first.",
  synthetic_interest_not_collected:
    "No interest expense, pre-tax income or borrowing data is stored for this company yet: re-sync its DART financials so the extended collector fills them.",
  synthetic_no_interest_expense:
    "The latest fiscal year shows no interest expense (zero or absent), so interest coverage is undefined and no synthetic rating is built.",
};

function companyName(db: Database, companyId: string): string | null {
  return (
    (db.query("SELECT name_ko FROM md_company WHERE id = ?").get(companyId) as { name_ko: string | null } | undefined)
      ?.name_ko ?? null
  );
}

/** Synthetic rating of a company (ADR-0208 D3). Never throws; a miss carries its recorded reason. */
export function deriveSyntheticRating(
  db: Database,
  companyId: string,
  registry: CreditRatingRegistry,
): SyntheticResult {
  const syn = registry.synthetic;
  const fail = (code: SyntheticReasonCode): SyntheticResult => ({
    ok: false,
    reason_code: code,
    reason: REASONS[code],
    resync_hint: code === "synthetic_interest_not_collected",
  });
  if (!syn) return fail("synthetic_no_registry_table");
  if (isFinancialSectorName(companyName(db, companyId), syn)) return fail("synthetic_not_applicable_financial");
  const facts = readCompanyCreditFacts(db, companyId);
  const pick = selectCoverageYear(facts.years, facts.anyCollected);
  if (!pick.ok) return fail(pick.reason_code);
  const op = pick.year.operatingIncomeKrw as number;
  const x = op / pick.interest.valueKrw;
  const band = bandForCoverage(syn.table.rows, x);
  const proxy = pick.interest.source !== "interest_expense";
  const sourceText =
    pick.interest.source === "interest_expense"
      ? "interest expense"
      : pick.interest.source === "interest_paid"
        ? "interest paid (operating plus financing activities; cash basis)"
        : "finance costs (a proxy that includes FX and derivative losses and so overstates interest; the rating comes out conservative)";
  const loss = op <= 0;
  return {
    ok: true,
    rating: band.rating,
    coverage_x: round4(x),
    interest_source: pick.interest.source,
    fiscal_year: pick.year.fiscalYear,
    table_id: syn.table.id,
    band,
    operating_income_krw_million: toMillion(op),
    interest_expense_krw_million: toMillion(pick.interest.valueKrw),
    loss_making: loss,
    interest_is_proxy: proxy,
    note:
      `Interest coverage ${round4(x)}x (FY${pick.year.fiscalYear} operating income / ${sourceText}) maps to ${band.rating} in the ` +
      `registry table ${syn.table.id} (as of ${syn.table.asOf}). A synthetic estimate, not a rating: global-scale, US-calibrated, one fiscal year, ` +
      `reported operating income without lease or R&D adjustment${loss ? "; operating income is not positive, so the lowest band applies" : ""}.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Cross-check: implied actual borrowing cost vs the market-built Kd.
// ---------------------------------------------------------------------------------------------------------------

export type CrosscheckStatus = "ok" | "warn" | "unreliable" | "unavailable";
export type CrosscheckReasonCode =
  | "crosscheck_unavailable_financial_sector"
  | "crosscheck_unavailable_no_financials"
  | "crosscheck_unavailable_interest_not_collected"
  | "crosscheck_unavailable_no_interest_expense"
  | "crosscheck_unavailable_no_debt_rows"
  | "crosscheck_unavailable_no_market_kd"
  | "crosscheck_unreliable_non_positive_debt"
  | "crosscheck_implied_far_below_market";

export interface KdCrosscheck {
  status: CrosscheckStatus;
  reason_code: CrosscheckReasonCode | null;
  reason: string | null;
  /** Interest expense / average interest-bearing debt, percent points (null when unavailable). */
  implied_cost_pct: number | null;
  market_kd_pct: number | null;
  /** market - implied, percent points. */
  gap_pp: number | null;
  direction: "market_above_actual" | "market_below_actual" | null;
  interest_source: InterestSource | null;
  fiscal_year: number | null;
  /** INTEGER KRW millions (ADR-0061). */
  interest_expense_krw_million: number | null;
  avg_debt_krw_million: number | null;
  /** `two_year_average` (FY and FY-1 year-end) or `year_end` (the prior year-end balance is missing). */
  debt_basis: "two_year_average" | "year_end" | null;
  warn_gap_pp: number;
}

const CROSSCHECK_REASONS: Record<CrosscheckReasonCode, string> = {
  crosscheck_unavailable_financial_sector:
    "Financial-sector company: interest is an operating cost, so the cost-of-debt check is not meaningful.",
  crosscheck_unavailable_no_financials:
    "No operating income is stored for this company; sync its DART financials first.",
  crosscheck_unavailable_interest_not_collected:
    "No interest expense or borrowing data is stored yet: re-sync the company's DART financials.",
  crosscheck_unavailable_no_interest_expense:
    "The latest fiscal year shows no interest expense, so there is no actual cost to compare.",
  crosscheck_unavailable_no_debt_rows:
    "No interest-bearing borrowing row (borrowings, bonds, lease liabilities) was found on the balance sheet, so the implied cost cannot be computed.",
  crosscheck_unavailable_no_market_kd: "The market-built Kd is not available (risk-free rate or spread missing).",
  crosscheck_unreliable_non_positive_debt:
    "The interest-bearing debt balance is zero or negative, so the implied cost cannot be trusted.",
  // Carries the figures at run time (see computeKdCrosscheck); this is the template without them.
  crosscheck_implied_far_below_market:
    "The implied actual borrowing cost is far below the market Kd: check for policy-finance or low-rate borrowing.",
};

/**
 * Implied Kd against the market Kd. `marketKdPct` is Rf + the mapped spread (percent points); Warns when
 * |market - implied| > registry `warn_gap_pp` in EITHER direction (the boundary itself is not a warning), including an
 * implied cost below the risk-free rate (a user-approved change 2026-11-26: such a cost is far below the market and worth
 * a look, e.g. policy-finance or low-rate borrowing). When the implied cost is more than `warn_gap_pp` below the market
 * Kd the warning carries reason_code `crosscheck_implied_far_below_market`. `unreliable` is kept for unusable inputs only
 * (a non-positive debt balance). Never changes any number.
 */
export function computeKdCrosscheck(
  db: Database,
  companyId: string,
  registry: CreditRatingRegistry,
  marketKdPct: number | null,
): KdCrosscheck {
  const base: KdCrosscheck = {
    status: "unavailable",
    reason_code: null,
    reason: null,
    implied_cost_pct: null,
    market_kd_pct: marketKdPct,
    gap_pp: null,
    direction: null,
    interest_source: null,
    fiscal_year: null,
    interest_expense_krw_million: null,
    avg_debt_krw_million: null,
    debt_basis: null,
    warn_gap_pp: registry.warnGapPp,
  };
  const unavailable = (code: CrosscheckReasonCode, extra: Partial<KdCrosscheck> = {}): KdCrosscheck => ({
    ...base,
    ...extra,
    status: code === "crosscheck_unreliable_non_positive_debt" ? "unreliable" : "unavailable",
    reason_code: code,
    reason: CROSSCHECK_REASONS[code],
  });
  if (registry.synthetic && isFinancialSectorName(companyName(db, companyId), registry.synthetic)) {
    return unavailable("crosscheck_unavailable_financial_sector");
  }
  const facts = readCompanyCreditFacts(db, companyId);
  const pick = selectCoverageYear(facts.years, facts.anyCollected);
  if (!pick.ok) {
    const map = {
      synthetic_no_financials: "crosscheck_unavailable_no_financials",
      synthetic_interest_not_collected: "crosscheck_unavailable_interest_not_collected",
      synthetic_no_interest_expense: "crosscheck_unavailable_no_interest_expense",
    } as const;
    return unavailable(map[pick.reason_code]);
  }
  const debtNow = totalDebt(pick.year);
  const common = {
    interest_source: pick.interest.source,
    fiscal_year: pick.year.fiscalYear,
    interest_expense_krw_million: toMillion(pick.interest.valueKrw),
  };
  if (debtNow === null) return unavailable("crosscheck_unavailable_no_debt_rows", common);
  if (debtNow <= 0) return unavailable("crosscheck_unreliable_non_positive_debt", common);
  const prior = facts.years.find((y) => y.fiscalYear === pick.year.fiscalYear - 1);
  const debtPrior = prior ? totalDebt(prior) : null;
  const twoYear = debtPrior !== null && debtPrior > 0;
  const avgDebt = twoYear ? (debtNow + (debtPrior as number)) / 2 : debtNow;
  const withDebt = {
    ...common,
    avg_debt_krw_million: toMillion(avgDebt),
    debt_basis: twoYear ? ("two_year_average" as const) : ("year_end" as const),
  };
  const implied = round6((pick.interest.valueKrw / avgDebt) * 100);
  if (marketKdPct === null) {
    return unavailable("crosscheck_unavailable_no_market_kd", { ...withDebt, implied_cost_pct: implied });
  }
  const gap = round6(marketKdPct - implied);
  const warn = Math.abs(gap) > registry.warnGapPp;
  const farBelow = gap > registry.warnGapPp; // implied cost is more than warn_gap_pp below the market Kd
  return {
    ...base,
    ...withDebt,
    status: warn ? "warn" : "ok",
    reason_code: farBelow ? "crosscheck_implied_far_below_market" : null,
    reason: farBelow
      ? `The implied actual borrowing cost ${implied.toFixed(2)}% is far below the market Kd ${marketKdPct.toFixed(2)}% (more than ${registry.warnGapPp.toFixed(1)} pp): check for policy-finance or low-rate borrowing.`
      : null,
    implied_cost_pct: implied,
    gap_pp: gap,
    direction: gap > 0 ? "market_above_actual" : "market_below_actual",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Issuance evidence (informational): recent corporate-bond issues from the DART issuance table.
// ---------------------------------------------------------------------------------------------------------------

export type IssuanceStatus =
  | "available"
  | "no_dart_corp_code"
  | "not_collected"
  | "issues_unavailable"
  | "none_in_window";

export interface IssuanceEvidenceRow {
  issued_on: string;
  /** INTEGER KRW millions (ADR-0061); null when the table's unit was not stated. */
  amount_krw_million: number | null;
  /** Coupon in percent points, as filed (not adjusted). */
  coupon_pct: number | null;
  /** Rating at issue, as written in the filing. */
  rating_raw: string;
  maturity_on: string | null;
  outstanding: boolean | null;
  source_rcept_no: string;
}

export const ISSUANCE_WINDOW_MONTHS = 36;
const ISSUANCE_LIMIT = 5;

/**
 * The most recent corporate-bond issues of the last 36 months from the newest business report that has an issuance
 * table. Guaranteed, secured, structured and foreign-scale issues (excluded by the parser) are not shown: their coupon is
 * not the issuer's own cost. A report whose table was not found is `issues_unavailable`, never "no issues".
 */
export function listIssuanceEvidence(
  db: Database,
  corpCode: string | null,
  now: Date,
): { status: IssuanceStatus; rows: IssuanceEvidenceRow[] } {
  if (!corpCode) return { status: "no_dart_corp_code", rows: [] };
  const snaps = listCreditRatingSnapshots(db, corpCode, CREDIT_RATING_PARSER_VERSION).filter(
    (s) => s.source_kind === "business_report",
  );
  if (snaps.length === 0) return { status: "not_collected", rows: [] };
  const withTable = snaps.find((s) => s.issues_json !== null);
  if (!withTable) return { status: "issues_unavailable", rows: [] };
  let issues: CreditIssueRow[] = [];
  try {
    const v = JSON.parse(withTable.issues_json as string) as unknown;
    issues = Array.isArray(v) ? (v as CreditIssueRow[]) : [];
  } catch {
    return { status: "issues_unavailable", rows: [] };
  }
  const since = addMonthsIso(seoulToday(now), -ISSUANCE_WINDOW_MONTHS);
  const rows = issues
    .filter(
      (i) =>
        i.instrument === "corporate_bond" && i.excluded_reason === null && i.issued_on !== null && i.issued_on >= since,
    )
    .sort((a, b) => ((a.issued_on as string) < (b.issued_on as string) ? 1 : -1))
    .slice(0, ISSUANCE_LIMIT)
    .map(
      (i): IssuanceEvidenceRow => ({
        issued_on: i.issued_on as string,
        amount_krw_million: i.amount_krw_mn,
        coupon_pct: i.coupon_pct,
        rating_raw: i.rating_raw,
        maturity_on: i.maturity_on,
        outstanding: i.outstanding,
        source_rcept_no: withTable.source_rcept_no,
      }),
    );
  return { status: rows.length > 0 ? "available" : "none_in_window", rows };
}
