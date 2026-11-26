// @version 1.0.0
/**
 * DART account extraction for the credit-rating inputs (ADR-0208 slice 3, design 2026-11-26-wacc-credit-rating-spread
 * sections 5.2, 7 and 8.3). PURE: no DB, no network. The collector (app/web-next/lib/dart-client.ts `fetchFinancials`)
 * feeds it the `list` of one `fnlttSinglAcntAll` block (one fiscal year, one statement basis) and gets back the extra
 * facts the credit inputs need. The eight original accounts keep their name-keyed path and are not touched here.
 *
 * Two extraction keys, because the data has two shapes (verified 2026-11-26 on live filings):
 *   - id-keyed: pre-tax income, interest expense, finance costs and the two interest-paid rows are keyed by the DART
 *     `account_id`, never by name. Interest paid appears as TWO rows with the SAME name (operating and financing
 *     activities); a name-keyed, first-wins collector would silently keep one, so each id is its own account.
 *   - name-pattern: interest-bearing borrowings are balance-sheet rows that mostly carry no standard code
 *     (`-표준계정코드 미사용-`) and are named differently by each filer. Rows are classified by name into five classes
 *     and summed per class. Balance-sheet rows only (the cash-flow statement repeats the words as flows).
 *
 * Korean literals below are DART parser literals (the same convention as the other db/lib parsers); they are matched
 * against filing text and never shown to a user.
 */

/** Statement section codes of `fnlttSinglAcntAll` (BS balance sheet, IS income statement, CIS comprehensive income, CF cash flow). */
const INCOME_SECTIONS: readonly string[] = ["IS", "CIS"];

export interface DartAccountListRow {
  sj_div?: string;
  account_id?: string;
  account_nm?: string;
  thstrm_amount?: string;
}

/** One extra fact of a fiscal year; `ifrsCode` is the md_account key the fact_financial writer resolves. */
export interface CreditInputItem {
  /** Account name as filed (diagnostics only; the writer resolves by `ifrsCode`). */
  name: string;
  ifrsCode: string;
  /** Raw KRW as filed, the fact_financial convention. */
  value: number;
  unit: "KRW";
}

interface IdRule {
  ifrsCode: string;
  /** Statement sections the row may come from; null = any. */
  sections: readonly string[] | null;
}

/** DART account_id -> md_account ifrs_code (identity: the ids are seeded as the ifrs_code by migration 0201). */
const ID_RULES: readonly IdRule[] = [
  { ifrsCode: "ifrs-full_ProfitLossBeforeTax", sections: INCOME_SECTIONS },
  { ifrsCode: "dart_AdjustmentsForInterestExpenses", sections: null },
  { ifrsCode: "ifrs-full_InterestExpense", sections: null },
  { ifrsCode: "ifrs-full_FinanceCosts", sections: INCOME_SECTIONS },
  { ifrsCode: "ifrs-full_InterestPaidClassifiedAsOperatingActivities", sections: ["CF"] },
  { ifrsCode: "ifrs-full_InterestPaidClassifiedAsFinancingActivities", sections: ["CF"] },
];

/** The id-keyed accounts (ifrs_code == DART account_id). */
export const CREDIT_ID_KEYED_CODES: readonly string[] = ID_RULES.map((r) => r.ifrsCode);

export const BORROWING_CLASS_CODES = {
  shortTerm: "conewbiz_ShortTermBorrowings",
  longTerm: "conewbiz_LongTermBorrowings",
  currentPortionLtd: "conewbiz_CurrentPortionOfLongTermDebt",
  bonds: "conewbiz_BondsIssued",
  leases: "conewbiz_LeaseLiabilities",
} as const;
export type BorrowingClassCode = (typeof BORROWING_CLASS_CODES)[keyof typeof BORROWING_CLASS_CODES];
export const BORROWING_CLASS_LIST: readonly BorrowingClassCode[] = Object.values(BORROWING_CLASS_CODES);

/** Every ifrs_code the credit inputs add to md_account (migration 0201 seeds exactly these). */
export const CREDIT_INPUT_CODES: readonly string[] = [...CREDIT_ID_KEYED_CODES, ...BORROWING_CLASS_LIST];

/** Rows that look like a debt line but are contra, accrued or flow items: never debt balances. */
const NOT_A_DEBT_BALANCE = /차금|할증|미지급|이자|상환|발행비|충당|의발행|의차입|순증/;

/**
 * Class of a balance-sheet row name, or null when it is not an interest-bearing debt line. Order matters: the lease and
 * current-portion rows are tested before the generic borrowing words they contain.
 *   리스부채 (also 유동리스부채, 유동성리스부채, 비유동리스부채)   -> leases
 *   유동성장기부채                                              -> current portion of long-term debt
 *   단기차입금                                                  -> short-term borrowings
 *   사채 (also 유동성사채, 전환사채)                              -> bonds
 *   other ...차입금 (장기차입금, 유동성장기차입금, 차입금, 자산유동화차입금) -> long-term and other borrowings
 */
export function classifyBorrowingName(rawName: string): BorrowingClassCode | null {
  const name = rawName.normalize("NFKC").replace(/\s+/g, "");
  if (name === "" || NOT_A_DEBT_BALANCE.test(name)) return null;
  if (name.includes("리스부채")) return BORROWING_CLASS_CODES.leases;
  if (name.includes("유동성장기부채")) return BORROWING_CLASS_CODES.currentPortionLtd;
  if (name.includes("단기차입금")) return BORROWING_CLASS_CODES.shortTerm;
  if (name.includes("사채")) return BORROWING_CLASS_CODES.bonds;
  if (name.includes("차입금")) return BORROWING_CLASS_CODES.longTerm;
  return null;
}

function amountOf(raw: string | undefined): number | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extra credit-input facts of one `fnlttSinglAcntAll` block.
 *   id-keyed:      the FIRST row of each wanted account_id (the endpoint repeats sections; the first is the primary statement).
 *   borrowings:    every balance-sheet row classified by name, summed per class. Rows are deduplicated by
 *                  (account_id, name, amount) so a repeated identical row is not double counted, while two lines with the
 *                  same name and different amounts (current and non-current lease liabilities) are both counted.
 */
export function extractCreditInputItems(list: readonly DartAccountListRow[]): CreditInputItem[] {
  const out: CreditInputItem[] = [];
  const seenIds = new Set<string>();
  for (const row of list) {
    const id = row.account_id?.trim();
    if (!id || seenIds.has(id)) continue;
    const rule = ID_RULES.find((r) => r.ifrsCode === id);
    if (!rule) continue;
    if (rule.sections !== null && !(row.sj_div !== undefined && rule.sections.includes(row.sj_div))) continue;
    const value = amountOf(row.thstrm_amount);
    if (value === null) continue;
    seenIds.add(id);
    out.push({ name: row.account_nm ?? id, ifrsCode: id, value, unit: "KRW" });
  }

  const sums = new Map<BorrowingClassCode, number>();
  const seenLines = new Set<string>();
  for (const row of list) {
    if (row.sj_div !== "BS") continue;
    const cls = classifyBorrowingName(row.account_nm ?? "");
    if (cls === null) continue;
    const value = amountOf(row.thstrm_amount);
    if (value === null) continue;
    const key = `${row.account_id ?? ""}|${(row.account_nm ?? "").trim()}|${value}`;
    if (seenLines.has(key)) continue;
    seenLines.add(key);
    sums.set(cls, (sums.get(cls) ?? 0) + value);
  }
  for (const code of BORROWING_CLASS_LIST) {
    const v = sums.get(code);
    if (v !== undefined) out.push({ name: code, ifrsCode: code, value: v, unit: "KRW" });
  }
  return out;
}
