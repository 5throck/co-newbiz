// @version 1.0.0
/**
 * Pure helpers behind the WACC panel's "reference data collection" block: one row per collectable source
 * (ECOS rates, DART credit rating) with a status line, a button emphasis rule and the anchor that the
 * credit-spread reason text links to. The panel maps the returned kinds to localized text.
 */
import { type ReferenceSuggestion, financialResyncNeeded } from "./wacc-reference-items.ts";

export type CollectRowKey = "ecos" | "credit" | "financials" | "kofia";

/** DOM id of a collect row; the credit-spread reason text links to the credit row. */
export const COLLECT_BLOCK_ID = "wacc-collect-block";
export function collectRowId(key: CollectRowKey): string {
  return `wacc-collect-row-${key}`;
}

export type CollectEmphasis = "primary" | "secondary";

/** Primary only when the data is missing/required; otherwise the button is a small "collect again". */
export function collectEmphasis(needed: boolean): CollectEmphasis {
  return needed ? "primary" : "secondary";
}

/** ECOS data is required when the risk-free rate is missing, or the credit spread has no ECOS series to map from. */
export function ecosCollectNeeded(suggestions: readonly ReferenceSuggestion[]): boolean {
  const rf = suggestions.find((x) => x.key === "risk_free");
  const credit = suggestions.find((x) => x.key === "credit_spread");
  if (rf && rf.value === null) return true;
  return !!credit && credit.value === null && credit.reason_code === "no_ecos_observations";
}

/** Credit-rating collection is required when the backend hints it or the rating in use is out of date. */
/** Primary emphasis only when the rating has not been collected (or must be re-read). A stale rating from an
 *  already-read filing gets the secondary "re-collect" button: re-reading the same filing cannot freshen it. */
export function creditCollectNeeded(credit: ReferenceSuggestion | undefined): boolean {
  return credit?.key === "credit_spread" && credit.collect_hint === true;
}

/** The credit row has no usable action when the company has no DART code (the collection would answer 400). */
export function creditCollectAvailable(credit: ReferenceSuggestion | undefined): boolean {
  return !!credit && credit.key === "credit_spread" && credit.disclosed_status !== "no_dart_corp_code";
}

/** Should the credit-spread reason text offer the "go to collect area" link? */
export function creditReasonLinksToCollect(credit: ReferenceSuggestion | undefined): boolean {
  if (credit?.key !== "credit_spread") return false;
  if (credit.disclosed_status === "no_dart_corp_code") return false;
  return credit.reason_code === "rating_not_collected" || creditCollectNeeded(credit);
}

export type EcosStatus = { kind: "collected"; asOf: string | null } | { kind: "missing" };

export function ecosRowStatus(suggestions: readonly ReferenceSuggestion[]): EcosStatus {
  const rf = suggestions.find((x) => x.key === "risk_free");
  const credit = suggestions.find((x) => x.key === "credit_spread");
  if (!rf || rf.value === null) return { kind: "missing" };
  return { kind: "collected", asOf: rf.as_of ?? credit?.anchors?.as_of ?? null };
}

export type CreditStatus =
  | { kind: "no_dart_code" }
  | { kind: "not_collected" }
  /** Rating read from the disclosure (or the bureau row when `source` is "bureau"). */
  | {
      kind: "rated";
      source: "disclosed" | "bureau";
      rating: string;
      ratedOn: string | null;
      stale: boolean;
      /** Bureau basis only: the disclosure carried no usable bond rating. */
      bondRatingMissing: boolean;
    }
  /** No disclosed or bureau rating; the rating in use is the interest-coverage (synthetic) estimate. */
  | { kind: "synthetic"; rating: string; coverageX: number | null; fiscalYear: number | null }
  /** Collected, but the disclosure has no rating and nothing else filled in. */
  | { kind: "no_rating"; statusCode: string | null }
  | { kind: "default_basis" };

/** Status of the credit-rating source from the credit_spread suggestion (suggestion fields only). */
export function creditRowStatus(credit: ReferenceSuggestion | undefined): CreditStatus {
  if (!credit) return { kind: "not_collected" };
  const status = credit.disclosed_status ?? null;
  if (status === "no_dart_corp_code") return { kind: "no_dart_code" };
  if (credit.rating && (credit.rating_source === "disclosed" || credit.rating_source === "bureau")) {
    return {
      kind: "rated",
      source: credit.rating_source,
      rating: credit.rating,
      ratedOn: credit.rating_rated_on ?? null,
      stale: credit.rating_stale === true,
      bondRatingMissing: credit.rating_source === "bureau" && status !== null,
    };
  }
  if (credit.rating && credit.rating_source === "synthetic") {
    const syn = credit.synthetic && credit.synthetic.available ? credit.synthetic : null;
    return {
      kind: "synthetic",
      rating: credit.rating,
      coverageX: syn?.coverage_x ?? null,
      fiscalYear: syn?.fiscal_year ?? null,
    };
  }
  if (status === "rating_not_collected") return { kind: "not_collected" };
  if (status !== null) return { kind: "no_rating", statusCode: status };
  return { kind: "default_basis" };
}

/**
 * The company financials row (re-sync hint): offered when the interest, pre-tax and borrowing figures behind the
 * synthetic rung and the cost-of-debt cross-check are not stored because the company's financials were synced before the
 * extended collector. It needs a company (the sync endpoint is per company) and answers 'primary' emphasis only then.
 */
export function financialsCollectNeeded(credit: ReferenceSuggestion | undefined): boolean {
  return financialResyncNeeded(credit);
}

export type FinancialsStatus = { kind: "resync_needed" } | { kind: "synced" };

export function financialsRowStatus(credit: ReferenceSuggestion | undefined): FinancialsStatus {
  return financialResyncNeeded(credit) ? { kind: "resync_needed" } : { kind: "synced" };
}

/**
 * KOFIA grade-yield row (ADR-0208 slice 4). It exists ONLY when the server reports the automated collection switch as on
 * (`data.kofia_collect.enabled`, env CO_NEWBIZ_KOFIA_COLLECT, default off pending KOFIA's written confirmation), and only
 * when there is a credit suggestion to feed. Primary emphasis while nothing was collected; otherwise "collect again".
 */
export function kofiaRowVisible(enabled: boolean | undefined, credit: ReferenceSuggestion | undefined): boolean {
  return enabled === true && !!credit && credit.key === "credit_spread";
}

export function kofiaCollectNeeded(credit: ReferenceSuggestion | undefined): boolean {
  return credit?.key === "credit_spread" && !credit.kofia_latest_date;
}

export type KofiaStatus =
  | { kind: "not_collected" }
  /** Collected up to `date`; `used` is true when the spread in use is built from it. */
  | { kind: "collected"; date: string; used: boolean };

export function kofiaRowStatus(credit: ReferenceSuggestion | undefined): KofiaStatus {
  const date = credit?.kofia_latest_date ?? null;
  if (!date) return { kind: "not_collected" };
  return { kind: "collected", date, used: credit?.spread_basis === "kofia_grade" };
}
