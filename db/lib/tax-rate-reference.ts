// @version 1.0.0
/**
 * Statutory marginal corporate tax rate reference (ADR-0207 addendum, design
 * 2026-11-26-wacc-erp-published-reference "Statutory marginal tax rate").
 * READ-ONLY: the rate tables live in `region-profiles/KR.yaml`
 * (`corporate_tax_rates`, validated by region-profiles/_validate.ts). A
 * suggestion built here is a PROPOSAL for the WACC session - the confirmed
 * `wacc.tax_rate` row stays kind='user'; nothing here writes assumptions.
 *
 * The bracket is an ESTIMATE: the latest DART income figure stands in for
 * taxable income (accounting income is not taxable income, and the local
 * income tax may be adjusted +/-50% by municipal ordinance). Fails soft: a
 * missing registry yields an explicit null suggestion with a reason code;
 * missing/non-positive income falls back to the top bracket and says so.
 *
 * Money over the API is integer KRW millions (ADR-0061); the registry and the
 * bracket arithmetic stay in raw KRW (the statute's unit, and fact_financial's).
 */
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import * as yaml from "js-yaml";
import { registryPath } from "./erp-reference.ts";

export type TaxRateBasis = "bracket_estimate" | "top_bracket_fallback";
export type TaxFallbackReasonCode = "tax_income_no_company" | "tax_income_no_financials" | "tax_income_not_positive";
export type TaxNullReasonCode = "tax_rate_market_not_kr" | "tax_rate_no_registry" | "tax_rate_registry_error";

export interface TaxBracket {
  lower_krw: number;
  /** Inclusive upper bound; null for the open top bracket. */
  upper_krw: number | null;
  national_rate_pct: number;
  local_rate_pct: number;
  combined_rate_pct: number;
}

export interface TaxSchedule {
  id: string;
  description: string | null;
  statute_ref: string;
  local_statute_ref: string;
  url: string;
  brackets: TaxBracket[];
}

export interface TaxRegistry {
  source: string;
  verified_on: string;
  maintainer: string;
  effective_from: string;
  default_schedule_id: string;
  local_rate_ratio: number;
  local_adjustment_note: string | null;
  schedules: TaxSchedule[];
}

export type TaxRegistryResult =
  | { ok: true; registry: TaxRegistry }
  | { ok: false; reason_code: "tax_rate_no_registry" | "tax_rate_registry_error"; reason: string };

/** Which DART account supplied the income figure. The pre-tax account is preferred when it is collected. */
export type TaxIncomeAccount = "pretax_income" | "operating_income";

// DART account canonical keys (migration 0083 seeds the operating-income row; the pre-tax row is
// not collected today, so lookups fall through to operating income until it is).
const IFRS_PRETAX_INCOME = "ifrs-full_ProfitLossBeforeTax";
const IFRS_OPERATING_INCOME = "ifrs-full_ProfitLossFromOperatingActivities";

export type TaxIncomeInput =
  | { status: "no_company" }
  | { status: "no_financials" }
  | { status: "found"; value_krw: number; fiscal_year: number; account: TaxIncomeAccount; ifrs_code: string };

export interface TaxBracketView {
  lower_krw_million: number;
  upper_krw_million: number | null;
  national_rate_pct: number;
  local_rate_pct: number;
  combined_rate_pct: number;
}

/** One statutory-rate suggestion as offered to the WACC panel. `value` is the combined rate in percent points (like risk_free). */
export interface TaxRateSuggestion {
  key: "tax_rate";
  value: number;
  as_of: string;
  anchor_ref: string;
  source_label: string;
  note: string;
  basis: TaxRateBasis;
  schedule_id: string;
  bracket_id: string;
  bracket: TaxBracketView;
  statute_ref: string;
  local_statute_ref: string;
  effective_from: string;
  verified_on: string;
  /** Local rate may be adjusted by this many percent of itself by municipal ordinance (statute: +/-50%). */
  local_rate_adjustment_pct: number;
  /** Income figure the bracket was chosen from (bracket_estimate only; also reported for a non-positive fallback). */
  income_account: TaxIncomeAccount | null;
  estimated_income_krw_million: number | null;
  income_period: string | null;
  /** Why the top bracket was used (top_bracket_fallback only). */
  fallback_reason_code: TaxFallbackReasonCode | null;
  fallback_reason: string | null;
}

export interface TaxRateNullSuggestion {
  key: "tax_rate";
  value: null;
  reason: string;
  reason_code: TaxNullReasonCode;
}

/** Statutory local-rate adjustment band (Local Tax Act Art. 103-20(2)): +/-50%. */
export const LOCAL_RATE_ADJUSTMENT_PCT = 50;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseBracket(raw: unknown): TaxBracket | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  const lower = num(b.lower_krw);
  const upper = b.upper_krw === null ? null : num(b.upper_krw);
  const nat = num(b.national_rate_pct);
  const loc = num(b.local_rate_pct);
  const comb = num(b.combined_rate_pct);
  if (lower === null || lower < 0 || nat === null || loc === null || comb === null) return null;
  if (b.upper_krw !== null && (upper === null || upper <= lower)) return null;
  return { lower_krw: lower, upper_krw: upper, national_rate_pct: nat, local_rate_pct: loc, combined_rate_pct: comb };
}

function parseSchedule(raw: unknown): TaxSchedule | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const id = str(s.id);
  const statute = str(s.statute_ref);
  const localStatute = str(s.local_statute_ref);
  const url = str(s.url);
  if (!id || !statute || !localStatute || !url || !Array.isArray(s.brackets) || s.brackets.length === 0) return null;
  const brackets: TaxBracket[] = [];
  let expectedLower = 0;
  for (const rawBracket of s.brackets) {
    const b = parseBracket(rawBracket);
    if (!b || b.lower_krw !== expectedLower) return null; // contiguous from 0
    brackets.push(b);
    if (b.upper_krw === null) {
      if (brackets.length !== s.brackets.length) return null; // open bracket must be last
    } else expectedLower = b.upper_krw;
  }
  if (brackets[brackets.length - 1].upper_krw !== null) return null;
  return { id, description: str(s.description), statute_ref: statute, local_statute_ref: localStatute, url, brackets };
}

/** Parse the `corporate_tax_rates` section of one region profile document. */
export function parseTaxRegistry(doc: unknown): TaxRegistryResult {
  const section = (doc as { corporate_tax_rates?: unknown } | null)?.corporate_tax_rates;
  if (section === undefined) {
    return {
      ok: false,
      reason_code: "tax_rate_no_registry",
      reason: "No corporate_tax_rates section is registered for this region.",
    };
  }
  const sec = section as { source?: unknown; verified_on?: unknown; maintainer?: unknown; data?: unknown } | null;
  const data = sec?.data as Record<string, unknown> | undefined;
  const fail = (reason: string): TaxRegistryResult => ({ ok: false, reason_code: "tax_rate_registry_error", reason });
  if (!data || typeof data !== "object" || !Array.isArray(data.schedules)) {
    return fail("corporate_tax_rates.data.schedules is missing or malformed.");
  }
  const effectiveFrom = str(data.effective_from);
  const ratio = num(data.local_rate_ratio);
  const source = str(sec?.source);
  const verifiedOn = str(sec?.verified_on);
  const maintainer = str(sec?.maintainer);
  if (!effectiveFrom || !ISO_DATE.test(effectiveFrom) || ratio === null || !source || !verifiedOn || !maintainer) {
    return fail("corporate_tax_rates is missing effective_from, local_rate_ratio or provenance.");
  }
  const schedules: TaxSchedule[] = [];
  for (const raw of data.schedules) {
    const s = parseSchedule(raw);
    if (!s) return fail("A corporate_tax_rates schedule is malformed (see region-profiles validator).");
    schedules.push(s);
  }
  const defaultId = str(data.default_schedule_id);
  if (!defaultId || !schedules.some((s) => s.id === defaultId)) {
    return fail("corporate_tax_rates.data.default_schedule_id does not name a schedule.");
  }
  return {
    ok: true,
    registry: {
      source,
      verified_on: verifiedOn,
      maintainer,
      effective_from: effectiveFrom,
      default_schedule_id: defaultId,
      local_rate_ratio: ratio,
      local_adjustment_note: str(data.local_adjustment_note),
      schedules,
    },
  };
}

/** Load the KR registry from region-profiles/KR.yaml. Never throws. */
export function loadKrTaxRegistry(path: string = registryPath()): TaxRegistryResult {
  try {
    if (!existsSync(path)) {
      return { ok: false, reason_code: "tax_rate_no_registry", reason: "Region profile KR.yaml was not found." };
    }
    const doc = yaml.load(readFileSync(path, "utf-8"), { schema: yaml.JSON_SCHEMA });
    return parseTaxRegistry(doc);
  } catch (e) {
    return {
      ok: false,
      reason_code: "tax_rate_registry_error",
      reason: `KR.yaml could not be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * The bracket whose range contains `incomeKrw` (upper bound inclusive: an income equal to a bracket's
 * upper_krw is still in that bracket, as the statute reads "X or less"). Income must be > 0.
 */
export function selectBracket(schedule: TaxSchedule, incomeKrw: number): TaxBracket {
  for (const b of schedule.brackets) {
    if (b.upper_krw === null || incomeKrw <= b.upper_krw) return b;
  }
  return schedule.brackets[schedule.brackets.length - 1];
}

export function topBracket(schedule: TaxSchedule): TaxBracket {
  return schedule.brackets[schedule.brackets.length - 1];
}

/** Stable id of one bracket, usable in a confirmation citation: `<schedule_id>.<lower_krw>`. */
export function taxBracketId(scheduleId: string, bracket: TaxBracket): string {
  return `${scheduleId}.${bracket.lower_krw}`;
}

const REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Shape check for a client-sent tax_reference_bracket_id (the registry lookup is separate). */
export function isValidTaxBracketId(v: unknown): v is string {
  return typeof v === "string" && REFERENCE_ID.test(v);
}

const toMillion = (krw: number): number => Math.round(krw / 1_000_000);

function bracketView(b: TaxBracket): TaxBracketView {
  return {
    lower_krw_million: toMillion(b.lower_krw),
    upper_krw_million: b.upper_krw === null ? null : toMillion(b.upper_krw),
    national_rate_pct: b.national_rate_pct,
    local_rate_pct: b.local_rate_pct,
    combined_rate_pct: b.combined_rate_pct,
  };
}

const LOCAL_CAVEAT =
  "Accounting income is not taxable income, and the local income tax (1/10 of the national rate) may be adjusted by " +
  `+/-${LOCAL_RATE_ADJUSTMENT_PCT}% by municipal ordinance, so the combined rate can vary by locality.`;

const ACCOUNT_LABEL: Record<TaxIncomeAccount, string> = {
  pretax_income: "pre-tax income",
  operating_income: "operating income (pre-tax income is not collected yet)",
};

const FALLBACK_REASON: Record<TaxFallbackReasonCode, string> = {
  tax_income_no_company: "No subject company is bound to this project, so no income figure is available.",
  tax_income_no_financials: "No collected DART pre-tax or operating income for the subject company.",
  tax_income_not_positive: "The latest income figure is zero or negative, so no income-based bracket applies.",
};

/**
 * Latest income figure standing in for taxable income: the newest fiscal year that has either
 * account, preferring pre-tax income within that year. Raw KRW, as filed (fact_financial convention).
 */
export function lookupTaxableIncomeProxy(db: Database, companyId: string | null): TaxIncomeInput {
  if (!companyId) return { status: "no_company" };
  const rows = db
    .query(
      `SELECT a.ifrs_code AS ifrs_code, f.value AS value, per.fiscal_year AS fiscal_year
       FROM fact_financial f
       JOIN md_account a ON a.id = f.account_id
       JOIN md_period per ON per.id = f.period_id
       WHERE f.company_id = ? AND a.ifrs_code IN (?, ?)
         AND f.revision_no = (SELECT MAX(f2.revision_no) FROM fact_financial f2
                              WHERE f2.company_id = f.company_id AND f2.period_id = f.period_id AND f2.account_id = f.account_id)
       ORDER BY per.fiscal_year DESC`,
    )
    .all(companyId, IFRS_PRETAX_INCOME, IFRS_OPERATING_INCOME) as Array<{
    ifrs_code: string;
    value: number;
    fiscal_year: number;
  }>;
  if (rows.length === 0) return { status: "no_financials" };
  const year = rows[0].fiscal_year;
  const inYear = rows.filter((r) => r.fiscal_year === year);
  const pick = inYear.find((r) => r.ifrs_code === IFRS_PRETAX_INCOME) ?? inYear[0];
  return {
    status: "found",
    value_krw: pick.value,
    fiscal_year: year,
    account: pick.ifrs_code === IFRS_PRETAX_INCOME ? "pretax_income" : "operating_income",
    ifrs_code: pick.ifrs_code,
  };
}

/**
 * Build the tax-rate suggestion for a market. Non-KR (or a missing/broken registry) gives a null entry
 * with a reason code. KR with a positive income picks that bracket's combined rate; KR without usable
 * income falls back to the top bracket and says why.
 */
export function buildTaxRateSuggestion(
  market: "KR" | string,
  income: TaxIncomeInput,
  loaded?: TaxRegistryResult,
): TaxRateSuggestion | TaxRateNullSuggestion {
  if (market !== "KR") {
    return {
      key: "tax_rate",
      value: null,
      reason: "Non-KR market - no statutory tax-rate table is registered.",
      reason_code: "tax_rate_market_not_kr",
    };
  }
  const result = loaded ?? loadKrTaxRegistry();
  if (!result.ok) return { key: "tax_rate", value: null, reason: result.reason, reason_code: result.reason_code };
  const { registry } = result;
  const schedule = registry.schedules.find((s) => s.id === registry.default_schedule_id);
  if (!schedule) {
    return {
      key: "tax_rate",
      value: null,
      reason: "Default tax schedule is missing.",
      reason_code: "tax_rate_registry_error",
    };
  }

  let basis: TaxRateBasis = "top_bracket_fallback";
  let bracket = topBracket(schedule);
  let fallbackCode: TaxFallbackReasonCode | null = null;
  let incomeAccount: TaxIncomeAccount | null = null;
  let incomeMillion: number | null = null;
  let incomePeriod: string | null = null;
  if (income.status === "found") {
    incomeAccount = income.account;
    incomeMillion = toMillion(income.value_krw);
    incomePeriod = String(income.fiscal_year);
    if (income.value_krw > 0) {
      basis = "bracket_estimate";
      bracket = selectBracket(schedule, income.value_krw);
    } else {
      fallbackCode = "tax_income_not_positive";
    }
  } else {
    fallbackCode = income.status === "no_company" ? "tax_income_no_company" : "tax_income_no_financials";
  }

  const note =
    basis === "bracket_estimate" && incomeAccount && incomeMillion !== null && incomePeriod
      ? `Bracket estimated from FY${incomePeriod} ${ACCOUNT_LABEL[incomeAccount]} of ${incomeMillion.toLocaleString("en-US")} KRW million. ${LOCAL_CAVEAT}`
      : `Top bracket used (${FALLBACK_REASON[fallbackCode as TaxFallbackReasonCode]}) - a conservative upper bound. ${LOCAL_CAVEAT}`;

  return {
    key: "tax_rate",
    value: bracket.combined_rate_pct,
    as_of: registry.effective_from,
    anchor_ref: schedule.url,
    source_label: `${schedule.statute_ref} + ${schedule.local_statute_ref} (national + local income tax)`,
    note,
    basis,
    schedule_id: schedule.id,
    bracket_id: taxBracketId(schedule.id, bracket),
    bracket: bracketView(bracket),
    statute_ref: schedule.statute_ref,
    local_statute_ref: schedule.local_statute_ref,
    effective_from: registry.effective_from,
    verified_on: registry.verified_on,
    local_rate_adjustment_pct: LOCAL_RATE_ADJUSTMENT_PCT,
    income_account: incomeAccount,
    estimated_income_krw_million: incomeMillion,
    income_period: incomePeriod,
    fallback_reason_code: fallbackCode,
    fallback_reason: fallbackCode ? FALLBACK_REASON[fallbackCode] : null,
  };
}

export interface TaxReferenceAudit {
  bracketId: string;
  scheduleId: string;
  /** Combined rate of the cited bracket, percent points. */
  referenceRatePct: number;
  /** True when the confirmed ratio differs from the cited bracket's combined rate (derived server-side). */
  edited: boolean;
}

/**
 * Server-side truth for the confirmation audit: look the cited bracket id up in the KR registry and
 * derive `edited` by comparing the confirmed ratio with the bracket's combined rate. Returns null
 * when the id does not resolve - the caller rejects it (a citation must resolve).
 */
export function resolveTaxReferenceAudit(
  bracketId: string,
  confirmedRatio: number,
  loaded?: TaxRegistryResult,
): TaxReferenceAudit | null {
  const result = loaded ?? loadKrTaxRegistry();
  if (!result.ok) return null;
  for (const s of result.registry.schedules) {
    for (const b of s.brackets) {
      if (taxBracketId(s.id, b) === bracketId) {
        return {
          bracketId,
          scheduleId: s.id,
          referenceRatePct: b.combined_rate_pct,
          edited: Math.abs(confirmedRatio * 100 - b.combined_rate_pct) > 1e-6,
        };
      }
    }
  }
  return null;
}
