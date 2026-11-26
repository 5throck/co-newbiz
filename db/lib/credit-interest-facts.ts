// @version 1.0.0
/**
 * Reader of the stored credit-rating inputs of one company (ADR-0208 slice 3, design
 * 2026-11-26-wacc-credit-rating-spread sections 5.2 and 7). READ-ONLY over `fact_financial` (latest revision per
 * account and year); the collector that fills them is app/web-next/lib/dart-client.ts (db/lib/dart-financial-accounts.ts).
 *
 * Values are raw KRW as filed (the fact_financial convention). Money leaving the API is converted to INTEGER KRW
 * millions by the callers (ADR-0061); ratios here are unit-free.
 *
 * Interest-expense hierarchy (recorded as `interest_source` on every result that uses it):
 *   1. `interest_expense`  interest expense: the income-statement row when present, else the cash-flow add-back
 *   2. `interest_paid`     interest paid, operating plus financing activities (two rows with the same name in the filing)
 *   3. `finance_costs`     finance costs: includes FX and derivative losses, so it OVERSTATES interest (coverage is
 *                          understated and the rating comes out conservative); flagged as a proxy
 * Magnitudes are used (|value|): filers differ on the sign of interest rows; a zero or missing figure is "no interest".
 */
import type { Database } from "bun:sqlite";
import { BORROWING_CLASS_LIST, type BorrowingClassCode, CREDIT_INPUT_CODES } from "./dart-financial-accounts.ts";
import type { SyntheticRegistry } from "./credit-spread-map.ts";

export type InterestSource = "interest_expense" | "interest_paid" | "finance_costs";

const OPERATING_INCOME = "ifrs-full_ProfitLossFromOperatingActivities";
const INTEREST_EXPENSE_IS = "ifrs-full_InterestExpense";
const INTEREST_EXPENSE_CF = "dart_AdjustmentsForInterestExpenses";
const FINANCE_COSTS = "ifrs-full_FinanceCosts";
const INTEREST_PAID_OPERATING = "ifrs-full_InterestPaidClassifiedAsOperatingActivities";
const INTEREST_PAID_FINANCING = "ifrs-full_InterestPaidClassifiedAsFinancingActivities";

export interface YearCreditFacts {
  fiscalYear: number;
  operatingIncomeKrw: number | null;
  interestExpenseIsKrw: number | null;
  interestExpenseCfKrw: number | null;
  financeCostsKrw: number | null;
  interestPaidOperatingKrw: number | null;
  interestPaidFinancingKrw: number | null;
  /** Interest-bearing balances by class (year-end, raw KRW); a class with no matching row is absent. */
  debtByClass: Partial<Record<BorrowingClassCode, number>>;
  /** True when ANY of the slice-3 accounts (interest, pre-tax, borrowings) was stored for the year. */
  collected: boolean;
}

export interface CompanyCreditFacts {
  /** Newest fiscal year first. */
  years: YearCreditFacts[];
  /** True when any year of the company carries a slice-3 account: the extended collector has run for it. */
  anyCollected: boolean;
}

/** Latest-revision facts of the accounts the synthetic rating and the cross-check read, per fiscal year. */
export function readCompanyCreditFacts(db: Database, companyId: string): CompanyCreditFacts {
  const codes = [OPERATING_INCOME, ...CREDIT_INPUT_CODES];
  const marks = codes.map(() => "?").join(", ");
  const rows = db
    .query(
      `SELECT a.ifrs_code AS ifrs_code, f.value AS value, per.fiscal_year AS fiscal_year
       FROM fact_financial f
       JOIN md_account a ON a.id = f.account_id
       JOIN md_period per ON per.id = f.period_id
       WHERE f.company_id = ? AND a.ifrs_code IN (${marks})
         AND f.revision_no = (SELECT MAX(f2.revision_no) FROM fact_financial f2
                              WHERE f2.company_id = f.company_id AND f2.period_id = f.period_id AND f2.account_id = f.account_id)
       ORDER BY per.fiscal_year DESC`,
    )
    .all(companyId, ...codes) as Array<{ ifrs_code: string; value: number; fiscal_year: number }>;
  const byYear = new Map<number, YearCreditFacts>();
  const slot = (y: number): YearCreditFacts => {
    let v = byYear.get(y);
    if (!v) {
      v = {
        fiscalYear: y,
        operatingIncomeKrw: null,
        interestExpenseIsKrw: null,
        interestExpenseCfKrw: null,
        financeCostsKrw: null,
        interestPaidOperatingKrw: null,
        interestPaidFinancingKrw: null,
        debtByClass: {},
        collected: false,
      };
      byYear.set(y, v);
    }
    return v;
  };
  let anyCollected = false;
  for (const r of rows) {
    const y = slot(r.fiscal_year);
    switch (r.ifrs_code) {
      case OPERATING_INCOME:
        y.operatingIncomeKrw = r.value;
        continue;
      case INTEREST_EXPENSE_IS:
        y.interestExpenseIsKrw = r.value;
        break;
      case INTEREST_EXPENSE_CF:
        y.interestExpenseCfKrw = r.value;
        break;
      case FINANCE_COSTS:
        y.financeCostsKrw = r.value;
        break;
      case INTEREST_PAID_OPERATING:
        y.interestPaidOperatingKrw = r.value;
        break;
      case INTEREST_PAID_FINANCING:
        y.interestPaidFinancingKrw = r.value;
        break;
      default:
        if ((BORROWING_CLASS_LIST as readonly string[]).includes(r.ifrs_code)) {
          y.debtByClass[r.ifrs_code as BorrowingClassCode] = r.value;
        }
    }
    y.collected = true;
    anyCollected = true;
  }
  return { years: [...byYear.values()].sort((a, b) => b.fiscalYear - a.fiscalYear), anyCollected };
}

export interface PickedInterest {
  source: InterestSource;
  /** Magnitude, raw KRW, > 0. */
  valueKrw: number;
}

const mag = (v: number | null): number | null => (v === null ? null : Math.abs(v));

/** Interest figure of one year by the hierarchy above; null when none of the rungs holds a positive figure. */
export function pickInterest(y: YearCreditFacts): PickedInterest | null {
  const expense = mag(y.interestExpenseIsKrw) ?? mag(y.interestExpenseCfKrw);
  if (expense !== null && expense > 0) return { source: "interest_expense", valueKrw: expense };
  const paidParts = [mag(y.interestPaidOperatingKrw), mag(y.interestPaidFinancingKrw)].filter(
    (v): v is number => v !== null,
  );
  const paid = paidParts.reduce((a, b) => a + b, 0);
  if (paidParts.length > 0 && paid > 0) return { source: "interest_paid", valueKrw: paid };
  const fin = mag(y.financeCostsKrw);
  if (fin !== null && fin > 0) return { source: "finance_costs", valueKrw: fin };
  return null;
}

/** Total interest-bearing debt of a year (raw KRW); null when no borrowing class was stored for it. */
export function totalDebt(y: YearCreditFacts): number | null {
  const parts = Object.values(y.debtByClass).filter((v): v is number => typeof v === "number");
  return parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0);
}

/** The company-form words and spaces removed, NFKC: the form the sector rule compares against. */
function nameKey(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\(\s*주\s*\)|주식회사/g, "")
    .replace(/\s+/g, "");
}

/** Financial-sector detection from the company name (md_company has no industry code). */
export function isFinancialSectorName(
  nameKo: string | null,
  rule: Pick<SyntheticRegistry, "financialNameKeywords" | "financialNameSuffixes">,
): boolean {
  if (!nameKo) return false;
  const key = nameKey(nameKo);
  if (key === "") return false;
  return (
    rule.financialNameKeywords.some((k) => k !== "" && key.includes(nameKey(k))) ||
    rule.financialNameSuffixes.some((k) => k !== "" && key.endsWith(nameKey(k)))
  );
}
